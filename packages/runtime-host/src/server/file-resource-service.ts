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

import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ArtifactSourceUnavailableError,
  isCanonicalArtifactEntityId,
  type ArtifactDescriptor,
} from '@maka/core/artifacts';
import { formatAttachmentResourceRef, parseAttachmentResourceRef } from '@maka/core/attachments';
import { parseTaskOutputResourceRef, taskOutputResourceRef } from '@maka/core/file-resources';
import type { ShellRunStore } from '@maka/core/shell-run';
import type { PreparedFile } from '@maka/runtime/file-resource-projection';
import {
  shellRunOutputFilePath,
  withShellRunOutputFile,
} from '@maka/runtime/shell-run-output-file';
import { readOutputSnapshot } from '@maka/runtime/stored-tool-output';
import type { InteractiveArtifactStoreWriter } from '@maka/storage/artifact-stores';
import {
  createFileResourceView,
  fileResourceViewName,
  FileViewUnavailableError,
} from './file-resource-view.js';

interface FileSource {
  record: ArtifactDescriptor;
  withFile<T>(read: (path: string) => Promise<T>): Promise<T>;
  liveTaskId?: string;
}

/** Owns resource preparation and snapshots. File tools never call this service. */
export function createHostFileResourceService(input: {
  artifacts: InteractiveArtifactStoreWriter;
  shellRuns: Pick<ShellRunStore, 'readShellRun' | 'listSessionShellRuns'>;
  taskOutputRoot: string;
}) {
  const view = createFileResourceView(dirname(input.taskOutputRoot));
  const liveViews = new Set<string>();
  const restoredSessions = new Map<
    string,
    {
      remaining?: Set<string>;
      pending?: Promise<void>;
    }
  >();
  const task = async (sessionId: string, shellRunId: string) => {
    const record = await input.shellRuns.readShellRun(sessionId, shellRunId).catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!record?.outputFile || record.visibility === 'user') return undefined;
    const path = shellRunOutputFilePath(input.taskOutputRoot, sessionId, shellRunId);
    if (record.outputFile !== path)
      throw new Error('Task output locator does not belong to this Session');
    return { record, path };
  };
  const withLiveFile = <T>(path: string, read: (path: string) => Promise<T>): Promise<T> =>
    withShellRunOutputFile(path, async () => {
      for (const directory of [input.taskOutputRoot, dirname(path)]) {
        const entry = await lstat(directory);
        if (!entry.isDirectory() || entry.isSymbolicLink())
          throw new Error('Task output directory must be a real directory');
      }
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error('Task output must be a regular file');
      return read(path);
    });
  const file = async (sessionId: string, artifactId: string): Promise<FileSource | undefined> => {
    const record = await input.artifacts.getRecordInSession(sessionId, artifactId);
    if (!record || record.source === 'session_effect') return undefined;
    return {
      record,
      withFile: (read) => input.artifacts.withReadableFile(sessionId, artifactId, read),
    };
  };
  const source = async (sessionId: string, ref: string): Promise<FileSource | undefined> => {
    const attachment = parseAttachmentResourceRef(ref);
    if (attachment) return file(sessionId, attachment.artifactId);
    const output = parseTaskOutputResourceRef(ref);
    if (!output) return undefined;
    const snapshot = await input.artifacts.readTaskOutputSnapshot(sessionId, output.shellRunId);
    if (snapshot !== undefined) return snapshot === null ? undefined : file(sessionId, snapshot);
    const live = await task(sessionId, output.shellRunId);
    if (!live) return undefined;
    const sizeBytes = await withLiveFile(live.path, async (path) => (await lstat(path)).size).catch(
      (error) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      },
    );
    if (sizeBytes === undefined) return undefined;
    return {
      record: {
        id: output.shellRunId,
        sessionId,
        turnId: live.record.sourceTurnId,
        createdAt: live.record.startedAt,
        name: `${output.shellRunId}.output`,
        kind: 'file',
        source: 'saved_tool_output',
        sizeBytes,
        mimeType: 'text/plain; charset=utf-8',
      },
      withFile: (read) => withLiveFile(live.path, read),
      liveTaskId: output.shellRunId,
    };
  };
  const materialize = async (sessionId: string, ref: string): Promise<PreparedFile | undefined> => {
    // Ownership must have been committed by upload, publication, branch/import,
    // or formal hand-back. Neither a historical owner nor a path is a grant.
    const resource = await source(sessionId, ref);
    if (!resource) return undefined;
    const output = parseTaskOutputResourceRef(ref);
    const path = await view.materialize(
      {
        sessionId,
        kind: output ? 'task-outputs' : 'files',
        id: output?.shellRunId ?? resource.record.id,
        name: fileResourceViewName(resource.record.name, resource.record.mimeType),
      },
      resource.withFile,
    );
    if (resource.liveTaskId) liveViews.add(`${sessionId}:${resource.liveTaskId}`);
    const { name, source: origin, sizeBytes, mimeType, summary } = resource.record;
    return {
      path,
      name,
      source: origin,
      sizeBytes,
      ...(mimeType ? { mimeType } : {}),
      ...(summary ? { summary } : {}),
    };
  };
  const service = {
    /** A permission root, not a path decoder or an ownership grant. */
    sessionViewRoot(sessionId: string): string {
      if (!isCanonicalArtifactEntityId(sessionId)) throw new Error('Invalid file view Session');
      return join(view.root, sessionId);
    },
    materialize,
    /** Internal inventory for namespace restoration or a move; never a file-tool API. */
    async transferredFileRefs(sessionId: string): Promise<readonly string[]> {
      const snapshots = await input.artifacts.readTaskOutputSnapshots(sessionId);
      const snapshotFiles = new Set(snapshots.values());
      const refs = new Set([...snapshots.keys()].map(taskOutputResourceRef));
      for (let afterArtifactId = ''; ; ) {
        const records = await input.artifacts.scanSessionArtifacts(sessionId, {
          afterArtifactId,
          limit: 200,
        });
        for (const record of records) {
          if (record.source === 'session_effect' || snapshotFiles.has(record.id)) continue;
          refs.add(
            formatAttachmentResourceRef({
              kind: 'session_file',
              sessionId,
              relativePath: record.id,
            })!,
          );
        }
        if (records.length < 200) break;
        afterArtifactId = records.at(-1)!.id;
      }
      for (const task of await input.shellRuns.listSessionShellRuns(sessionId)) {
        if (task.visibility !== 'user' && task.outputFile)
          refs.add(taskOutputResourceRef(task.shellRunId));
      }
      return [...refs];
    },
    /** Inventory once per Host lifetime; retry only unavailable files on later
     * requests. No model listing is emitted and file tools do not repair views.
     * New publications prepare files through attachment/result projection. */
    async restoreSessionFiles(sessionId: string): Promise<void> {
      let state = restoredSessions.get(sessionId);
      if (!state) {
        state = {};
        restoredSessions.set(sessionId, state);
      }
      const restoration = state;
      if (restoration.remaining?.size === 0) return;
      const pending = (restoration.pending ??= (async () => {
        restoration.remaining ??= new Set(await service.transferredFileRefs(sessionId));
        for (const ref of restoration.remaining) {
          try {
            await materialize(sessionId, ref);
            restoration.remaining.delete(ref);
          } catch (error) {
            // Fail closed for this file, not for unrelated work. Storage and
            // Blob-integrity errors are deliberately NOT caught here.
            if (
              !(error instanceof ArtifactSourceUnavailableError) &&
              !(error instanceof FileViewUnavailableError) &&
              (error as NodeJS.ErrnoException | null | undefined)?.code !== 'ENOENT'
            )
              throw error;
          }
        }
      })());
      try {
        await pending;
      } finally {
        if (restoration.pending === pending) delete restoration.pending;
      }
    },
    async refreshTaskOutput(sessionId: string, shellRunId: string): Promise<void> {
      const key = `${sessionId}:${shellRunId}`;
      if (liveViews.has(key) && !(await materialize(sessionId, taskOutputResourceRef(shellRunId))))
        liveViews.delete(key);
    },
    forgetSession(sessionId: string): void {
      restoredSessions.delete(sessionId);
      for (const key of liveViews) if (key.startsWith(`${sessionId}:`)) liveViews.delete(key);
      view.forgetSession(sessionId);
    },
    /** Existing frozen views are copied by the store; only live source views need bytes. */
    async freezeTaskOutputs(
      sourceSessionId: string,
      targetSessionId: string,
      shellRunIds: readonly string[],
    ): Promise<void> {
      const frozen = await input.artifacts.readTaskOutputSnapshots(targetSessionId);
      for (const shellRunId of new Set(shellRunIds)) {
        if (frozen.has(shellRunId)) continue;
        const live = await task(sourceSessionId, shellRunId);
        let content: Uint8Array | undefined;
        if (live) {
          content = await withLiveFile(live.path, (path) => readOutputSnapshot(path)).catch(
            (error) => {
              if (error.code === 'ENOENT') return undefined;
              throw error;
            },
          );
        }
        if (content === undefined) {
          await input.artifacts.freezeMissingTaskOutput(targetSessionId, shellRunId);
          continue;
        }
        await input.artifacts.create({
          sessionId: targetSessionId,
          turnId: live!.record.sourceTurnId,
          name: `${shellRunId}.output`,
          kind: 'file',
          source: 'saved_tool_output',
          mimeType: 'text/plain; charset=utf-8',
          content,
          taskOutputSnapshotOf: shellRunId,
        });
      }
    },
  };
  return service;
}
