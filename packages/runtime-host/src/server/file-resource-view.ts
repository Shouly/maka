/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, rename, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { isCanonicalArtifactEntityId } from '@maka/core/artifacts';

export const FILE_RESOURCE_VIEWS_DIRECTORY = 'file-views';

/** A rebuildable execution copy failed; this says nothing about storage integrity. */
export class FileViewUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileViewUnavailableError';
  }
}

const VIEW_UNAVAILABLE_CODES = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'ELOOP',
  'ENOSPC',
  'EDQUOT',
  'EROFS',
  'EMFILE',
  'ENFILE',
  'ENAMETOOLONG',
  'EBUSY',
]);

async function prepareView<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (VIEW_UNAVAILABLE_CODES.has((error as NodeJS.ErrnoException | null | undefined)?.code ?? ''))
      throw new FileViewUnavailableError('Execution file preparation is unavailable', {
        cause: error,
      });
    // In particular, do not disguise invalid Blob files, changed source bytes,
    // I/O corruption or programming errors as an ordinary cache failure.
    throw error;
  }
}
export type FileViewIdentity = {
  sessionId: string;
  kind: 'files' | 'task-outputs';
  id: string;
  name: string;
};

/** Keep actual filesystem names portable without changing the resource's display name. */
export function fileResourceViewName(displayName: string, mimeType?: string): string {
  // JSON can contain unpaired surrogates; filesystem APIs encode them as
  // U+FFFD. Publish the actual, well-formed spelling.
  let clean = Buffer.from(displayName, 'utf8')
    .toString('utf8')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/[. ]+$/u, '');
  // Choose a usable execution filename at the resource boundary. Read does
  // not consult Artifact MIME metadata to reinterpret a .bin or wrong suffix.
  const mediaExtensions: Record<string, readonly string[]> = {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'image/svg+xml': ['.svg'],
    'application/pdf': ['.pdf'],
  };
  const extensions = mediaExtensions[mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''];
  if (extensions && !extensions.includes(extname(clean).toLowerCase()))
    clean = `${clean.slice(0, clean.length - extname(clean).length)}${extensions[0]}`;
  const extension = extname(clean);
  const suffix = Buffer.byteLength(extension) <= 32 ? extension : '';
  const stem = suffix ? clean.slice(0, -suffix.length) : clean;
  // Prefix Windows device basenames, and bound UTF-8 bytes, not UTF-16 units:
  // 120 Chinese characters fit the metadata limit but exceed NAME_MAX on POSIX.
  let name = 'file-';
  let bytes = Buffer.byteLength(name) + Buffer.byteLength(suffix);
  for (const char of stem) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 200) break;
    name += char;
    bytes += size;
  }
  return `${name}${suffix}`.replace(/[. ]+$/u, '');
}

/** Rebuildable execution files. Never hard-link or symlink a model path to a Blob. */
export function createFileResourceView(stateRoot: string) {
  const root = join(resolve(stateRoot), FILE_RESOURCE_VIEWS_DIRECTORY);
  const cached = new Map<string, { source: string; target: string }>();
  const queues = new Map<string, Promise<unknown>>();
  const identityPath = (identity: FileViewIdentity) => {
    if (identity.kind !== 'files' && identity.kind !== 'task-outputs')
      throw new Error('Invalid file view kind');
    if (
      !isCanonicalArtifactEntityId(identity.sessionId) ||
      !isCanonicalArtifactEntityId(identity.id)
    )
      throw new Error('Invalid file view identity');
    if (
      !identity.name ||
      identity.name === '.' ||
      identity.name === '..' ||
      /[\\/\0]/u.test(identity.name)
    )
      throw new Error('Invalid file view name');
    return join(root, identity.sessionId, identity.kind, identity.id, identity.name);
  };
  return {
    root,
    forgetSession(sessionId: string): void {
      const prefix = `${join(root, sessionId)}${sep}`;
      for (const key of cached.keys()) if (key.startsWith(prefix)) cached.delete(key);
    },
    async materialize(
      inputIdentity: FileViewIdentity,
      withFile: <T>(read: (source: string) => Promise<T>) => Promise<T>,
    ): Promise<string> {
      const identity = { ...inputIdentity };
      const target = identityPath(identity);
      const previous = queues.get(target) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() =>
          withFile((source) =>
            prepareView(async () => {
              // Validate before each descendant is created: a planted directory link
              // must not redirect even a temporary write outside the managed view.
              let parent = resolve(stateRoot);
              for (const segment of [
                FILE_RESOURCE_VIEWS_DIRECTORY,
                identity.sessionId,
                identity.kind,
                identity.id,
              ]) {
                parent = join(parent, segment);
                await mkdir(parent, { mode: 0o700 }).catch((error) => {
                  if (error.code !== 'EEXIST') throw error;
                });
                const entry = await lstat(parent);
                if (!entry.isDirectory() || entry.isSymbolicLink())
                  throw new FileViewUnavailableError(
                    'File view directory must be a real directory',
                  );
              }
              const sourceStat = await lstat(source, { bigint: true });
              if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
                throw new Error('File resource must be a regular file');
              const sourceKey = signature(sourceStat);
              const existing = await lstat(target, { bigint: true }).catch((error) => {
                if (error.code === 'ENOENT') return undefined;
                throw error;
              });
              if (existing && (!existing.isFile() || existing.isSymbolicLink()))
                throw new FileViewUnavailableError('File view must be a regular file');
              const known = cached.get(target);
              if (known?.source === sourceKey && existing && known.target === signature(existing))
                return target;
              const temporary = join(parent, `.${randomUUID()}.tmp`);
              try {
                // FICLONE is a copy-on-write optimization, not a hard link. Where not
                // supported Node falls back to copying; editing a view cannot edit storage.
                await copyFile(
                  source,
                  temporary,
                  constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
                );
                await chmod(temporary, process.platform === 'win32' ? 0o600 : 0o400);
                const after = await lstat(source, { bigint: true });
                if (signature(after) !== sourceKey)
                  throw new Error('File resource changed during materialization');
                await rename(temporary, target);
                cached.set(target, {
                  source: sourceKey,
                  target: signature(await lstat(target, { bigint: true })),
                });
                // This is only a performance cache, not ownership metadata. Bound it
                // even when many Sessions are opened and retired in one Host lifetime.
                if (cached.size > 4096) cached.delete(cached.keys().next().value!);
                return target;
              } finally {
                await rm(temporary, { force: true });
              }
            }),
          ),
        );
      queues.set(target, next);
      try {
        return await next;
      } finally {
        if (queues.get(target) === next) queues.delete(target);
      }
    },
  };
}

/** Remove only this Session's rebuildable execution copies, never shared content. */
export async function purgeFileResourceViews(stateRoot: string, sessionId: string): Promise<void> {
  if (!isCanonicalArtifactEntityId(sessionId)) throw new Error('Invalid file view Session');
  const root = join(stateRoot, FILE_RESOURCE_VIEWS_DIRECTORY);
  const entry = await lstat(root).catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!entry) return;
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error('File view root must be a real directory');
  await rm(join(root, sessionId), { recursive: true, force: true });
}

function signature(stat: import('node:fs').BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}`;
}
