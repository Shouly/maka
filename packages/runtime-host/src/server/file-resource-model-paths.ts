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

import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import type { InjectionContext } from '@maka/runtime/injection';
import { projectFileResourcePaths } from '@maka/runtime/file-resource-projection';
import { tmpdir } from 'node:os';
import { canReadPath, canWritePath } from '@maka/core/permission-profile';
import {
  assessSandboxBoundaryExpansion,
  type ExecutionBoundary,
} from '@maka/core/sandbox-boundary';
import type { ModelFilePathResolver, PreparedFile } from '@maka/runtime/file-resource-projection';

/** The Host can promise paths only for execution environments it actually owns. */
export function createHostModelFilePathResolver(input: {
  sessionId: string;
  cwd: string;
  readBoundary(): Promise<ExecutionBoundary>;
  materialize(sessionId: string, ref: string): Promise<PreparedFile | undefined>;
}): ModelFilePathResolver {
  let roots: Promise<{ workspaceRoots: string[]; tmpdir: string; slashTmp?: string }> | undefined;
  return async (ref) => {
    try {
      const boundary = await input.readBoundary();
      if (boundary.kind === 'external')
        return {
          ok: false,
          reason:
            'This external executor does not provide file materialization; no Host path is exposed.',
        };
      const file = await input.materialize(input.sessionId, ref);
      if (!file) return { ok: false, reason: 'The file is not available in this Session.' };
      let readOnly = false;
      if (boundary.kind === 'managed') {
        roots ??= Promise.all([canonical(input.cwd), canonical(tmpdir()), canonical('/tmp')]).then(
          ([cwd, temp, slashTmp]) => ({
            workspaceRoots: [cwd!],
            tmpdir: temp!,
            ...(process.platform === 'win32' ? {} : { slashTmp }),
          }),
        );
        if (!canReadPath(boundary.profile, file.path, await roots))
          return {
            ok: false,
            reason:
              'The current sandbox policy does not allow reading the saved-file view. Its boundary was not widened.',
          };
        readOnly = !canWritePath(boundary.profile, file.path, await roots);
      }
      return { ok: true, file, readOnly };
    } catch {
      // The tool/notification may already be durable. Presentation failure
      // must not re-run it, fabricate a path, or shut down the Host.
      return {
        ok: false,
        reason: 'The saved file could not be materialized in this execution environment.',
      };
    }
  };
}

/** An ordinary environment-change injection. Same Session/root (including
 * compaction and restart) adds no model file listing. Host startup restores the
 * namespace separately. A copied ledger retains the stamp of its old location,
 * so branch/import gets one new-location notice.
 */
export function createHostFileEnvironmentPreparation(input: {
  viewRoot: string;
  resolve: ModelFilePathResolver;
  transferredFileRefs(): Promise<readonly string[]>;
  restoreSessionFiles(): Promise<void>;
  readBoundary(): Promise<ExecutionBoundary>;
}): (events: readonly RuntimeEvent[]) => Promise<InjectionContext | undefined> {
  const name = 'file_execution_environment';
  return async (events) => {
    const external = (await input.readBoundary()).kind === 'external';
    const revision = createHash('sha256')
      .update(`${external ? 'external' : 'host'}:${input.viewRoot}`)
      .digest('hex');
    if (!external) await input.restoreSessionFiles();
    const previous = [...events]
      .reverse()
      .find(
        (event) =>
          !event.partial &&
          (event.author === 'host' || event.author === 'system') &&
          event.content?.kind === 'injection' &&
          event.content.name === name,
      )?.content;
    if (previous?.kind === 'injection' && previous.data?.revision === revision) return undefined;
    let text = external
      ? 'This external executor has no file materialization adapter. Host file paths are not available here.'
      : 'System-provided files use ordinary filesystem paths. Context compaction does not move them.';
    if (previous?.kind === 'injection') {
      const refs = await input.transferredFileRefs();
      const projected = await projectFileResourcePaths(
        {
          type: 'text',
          value:
            'This Session has moved to a different file execution environment. Use the following current paths for transferred files; paths in copied history are unchanged and are not redirected.',
        },
        refs.map((ref) => ({ ref })),
        input.resolve,
      );
      if (projected.type === 'text') text = projected.value;
    }
    return { name, revision, text, position: 'after' };
  };
}

/** WorkHub has file inputs, not general host filesystem authority. The same
 * effective boundary is used by request preparation and every available tool. */
export async function restrictWorkHubFileBoundary(
  base: ExecutionBoundary,
  viewRoot: string | undefined,
  cwd: string,
): Promise<ExecutionBoundary> {
  if (base.kind === 'external') return base;
  const roots = {
    workspaceRoots: [await canonical(cwd)],
    tmpdir: await canonical(tmpdir()),
    ...(process.platform === 'win32' ? {} : { slashTmp: await canonical('/tmp') }),
  };
  const allowed =
    viewRoot &&
    (base.kind === 'bypass' ||
      assessSandboxBoundaryExpansion(
        base.profile,
        {
          filesystem: { entries: [{ path: viewRoot, access: 'read', scope: 'subtree' }] },
        },
        roots,
      ).outcome === 'noop');
  return {
    kind: 'managed',
    revision: base.revision,
    profile: {
      type: 'managed',
      name: 'workhub-file-inputs',
      fileSystem: {
        kind: 'restricted',
        entries: [
          ...(allowed
            ? [
                {
                  kind: 'path' as const,
                  path: viewRoot,
                  match: 'subtree' as const,
                  access: 'read' as const,
                },
              ]
            : []),
          ...(base.kind === 'managed'
            ? base.profile.fileSystem.entries.filter((entry) => entry.access === 'deny')
            : []),
        ],
      },
      network: { kind: 'restricted' },
    },
  };
}

async function canonical(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}
