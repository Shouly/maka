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

import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { toolResultSessionFolder } from '@maka/runtime/tool-result-file';

export type OpenPathKey = 'workspace' | 'skills' | 'memory' | 'project';

export type OpenPathResult =
  | { ok: true; opened: OpenPathKey }
  | { ok: false; reason: OpenPathFailureReason };

export type OpenPathFailureReason =
  | 'unknown-key'
  | 'not-allowed'
  | 'missing'
  | 'not-a-directory'
  /** The path resolved to something that is not a regular file. */
  | 'not-a-file'
  | 'open-failed';

export interface ResolveOpenPathInput {
  key: string;
  workspaceRoot: string;
  projectRoot?: string;
}

const OPEN_PATHS: Record<Exclude<OpenPathKey, 'project'>, (workspaceRoot: string) => string> = {
  workspace: (workspaceRoot) => workspaceRoot,
  skills: (workspaceRoot) => join(workspaceRoot, 'skills'),
  memory: (workspaceRoot) => join(workspaceRoot, 'memory'),
};

export async function resolveOpenPath(input: ResolveOpenPathInput): Promise<
  | { ok: true; key: OpenPathKey; path: string }
  | { ok: false; reason: OpenPathFailureReason }
> {
  if (!isOpenPathKey(input.key)) return { ok: false, reason: 'unknown-key' };

  if (input.key === 'project' && !input.projectRoot) return { ok: false, reason: 'missing' };
  const candidate = input.key === 'project'
    ? resolve(input.projectRoot!)
    : OPEN_PATHS[input.key](input.workspaceRoot);
  let root: string | undefined;
  let target: string;
  try {
    if (input.key === 'project') {
      target = await realpath(candidate);
    } else {
      [root, target] = await Promise.all([
        realpath(input.workspaceRoot),
        realpath(candidate),
      ]);
    }
  } catch {
    return { ok: false, reason: 'missing' };
  }

  if (root && !isInsideOrSamePath(root, target)) return { ok: false, reason: 'not-allowed' };

  const targetStat = await stat(target).catch(() => null);
  if (!targetStat) return { ok: false, reason: 'missing' };
  if (!targetStat.isDirectory()) return { ok: false, reason: 'not-a-directory' };

  return { ok: true, key: input.key, path: target };
}

function isOpenPathKey(value: string): value is OpenPathKey {
  return value === 'workspace' || value === 'skills' || value === 'memory' || value === 'project';
}

function isInsideOrSamePath(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && rel !== '..' && !rel.includes(`..${sep}`) && !rel.startsWith(sep);
}

/**
 * A FILE inside one session's workspace, for the delivered-file card.
 *
 * The renderer names the path here rather than an id, which the directory
 * guard above deliberately does not allow — and the safety is the same for the
 * same reason: main resolves the session's own root itself and re-checks that
 * the realpath lands inside it. A symlink pointing out, a `..` climb, or a path
 * from another session's workspace is refused before the shell sees it.
 *
 * A delivered file may legitimately sit outside the workspace — the tool
 * admits any path the session permissions allow — and that one is refused
 * rather than opened: this guard's promise is what it can vouch for.
 */
export async function resolveSessionFilePath(input: { root: string; path: string }): Promise<
  { ok: true; path: string } | { ok: false; reason: OpenPathFailureReason }
> {
  if (!input.root || !input.path) return { ok: false, reason: 'missing' };
  const candidate = resolve(input.root, input.path);
  let root: string;
  let target: string;
  try {
    [root, target] = await Promise.all([realpath(input.root), realpath(candidate)]);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!isInsideOrSamePath(root, target)) return { ok: false, reason: 'not-allowed' };
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat) return { ok: false, reason: 'missing' };
  if (!targetStat.isFile()) return { ok: false, reason: 'not-a-file' };
  return { ok: true, path: target };
}

/** A saved tool result's file name: the runtime's own `<id>.txt`, nothing else. */
const TOOL_RESULT_FILE_NAME = /^[A-Za-z0-9_-]{1,128}\.txt$/u;

/**
 * A tool result saved to a file because it was too long to show, for the
 * output block's reveal action.
 *
 * The sandboxed command can write anywhere under the temp folder and is told
 * the path, so nothing here trusts what is on disk to be what the runtime
 * wrote. Main builds the path itself, from the root, the Session's own folder
 * and the file name, and the renderer's path must be exactly that one. Then,
 * without following a link: the Session folder is a real directory where it
 * should be, and the file is a regular file. A symlink in either place is
 * refused, even one pointing inside. The caller reveals the path built here,
 * never opens it, so a file swapped after these checks is shown, not run.
 */
export async function resolveToolResultFilePath(input: {
  root: string;
  sessionId: string;
  path: string;
}): Promise<
  { ok: true; path: string } | { ok: false; reason: 'not-allowed' | 'missing' | 'not-a-file' }
> {
  let folder: string;
  try {
    folder = toolResultSessionFolder(input.root, input.sessionId);
  } catch {
    return { ok: false, reason: 'not-allowed' };
  }
  if (!input.path || !isAbsolute(input.path)) return { ok: false, reason: 'not-allowed' };
  const name = basename(input.path);
  if (!TOOL_RESULT_FILE_NAME.test(name)) return { ok: false, reason: 'not-allowed' };
  const expected = resolve(folder, name);
  if (resolve(input.path) !== expected) return { ok: false, reason: 'not-allowed' };

  const folderStat = await lstat(folder).catch(() => null);
  if (!folderStat) return { ok: false, reason: 'missing' };
  if (!folderStat.isDirectory()) return { ok: false, reason: 'not-allowed' };
  let realRoot: string;
  let realFolder: string;
  try {
    [realRoot, realFolder] = await Promise.all([realpath(input.root), realpath(folder)]);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (realFolder !== join(realRoot, input.sessionId)) return { ok: false, reason: 'not-allowed' };

  const fileStat = await lstat(expected).catch(() => null);
  if (!fileStat) return { ok: false, reason: 'missing' };
  if (fileStat.isSymbolicLink()) return { ok: false, reason: 'not-allowed' };
  if (!fileStat.isFile()) return { ok: false, reason: 'not-a-file' };
  return { ok: true, path: expected };
}
