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
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ArtifactSourceUnavailableError, type ArtifactRecord } from '@maka/core/artifacts';
import { MAX_ATTACHMENT_BYTES } from '@maka/core/attachments';
import { TOOL_RESULT_FILE_MAX_BYTES } from '@maka/runtime/tool-result-file';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { isPathInside } from '@maka/runtime/path-containment';
import { type ToolArtifactRecorderInput } from '@maka/runtime/tool-artifacts';
import {
  createReadImageSnapshotPlanner,
  type InteractiveArtifactStoreWriter,
} from '@maka/storage/artifact-stores';
import type { BuildBuiltinToolsOptions } from '@maka/runtime/builtin-tools';
import type { SessionManagerDeps } from '@maka/runtime/session-manager';
import type { PreparedFile } from '@maka/runtime/file-resource-projection';
import type { SessionAdmissionGate } from './session-admission-gate.js';
import type { SessionPresenceReader } from './session-presence.js';

export interface HostExecutionArtifactServices {
  snapshotImage?: NonNullable<BuildBuiltinToolsOptions['snapshotImage']>;
  retainChildArtifacts?: NonNullable<SessionManagerDeps['retainChildArtifacts']>;
  materializeFile?: (sessionId: string, ref: string) => Promise<PreparedFile | undefined>;
  fileViewRoot?: (sessionId: string) => string;
  transferredFileRefs?: (sessionId: string) => Promise<readonly string[]>;
  restoreSessionFiles?: (sessionId: string) => Promise<void>;
  /**
   * Explicit SendUserFile delivery publishes the complete batch atomically
   * and returns records in candidate order. Automatically derived artifacts
   * remain best effort: unreadable or oversized candidates are skipped.
   */
  recordToolArtifacts(event: ToolArtifactRecorderInput): Promise<ArtifactRecord[]>;
  publishChildWorkspacePatch: NonNullable<SessionManagerDeps['publishChildWorkspacePatch']>;
}

export function createHostExecutionArtifactServices(input: {
  artifacts: InteractiveArtifactStoreWriter;
  requestDrain: () => void;
  sessionAdmission: SessionAdmissionGate;
  sessions: SessionPresenceReader;
  fileResources?: {
    materialize(sessionId: string, ref: string): Promise<PreparedFile | undefined>;
    sessionViewRoot(sessionId: string): string;
    transferredFileRefs(sessionId: string): Promise<readonly string[]>;
    restoreSessionFiles(sessionId: string): Promise<void>;
  };
}): HostExecutionArtifactServices {
  const runWrite = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      input.requestDrain();
      throw error;
    }
  };

  const publish = (artifact: Parameters<InteractiveArtifactStoreWriter['create']>[0]) =>
    input.sessionAdmission.runOrJoin(artifact.sessionId, async () => {
      if ((await input.sessions.probeSessionRemoval(artifact.sessionId)).kind !== 'present')
        return null;
      return runWrite(() => input.artifacts.create(artifact));
    });

  const planImage = createReadImageSnapshotPlanner({
    create: async (artifact) => {
      const record = await publish(artifact);
      if (!record)
        throw new Error('The Session was removed before the image snapshot could be saved.');
      return record;
    },
  });
  const snapshotImage: NonNullable<HostExecutionArtifactServices['snapshotImage']> = async (
    input,
  ) => {
    const plan = planImage({
      sessionId: input.sessionId,
      turnId: input.turnId ?? `read-image:${input.ownerId}`,
      name: `Read image.${input.mimeType.slice('image/'.length)}`,
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
    await plan.persist();
    return plan.ref;
  };

  const recordToolArtifacts = async (
    event: ToolArtifactRecorderInput,
  ): Promise<ArtifactRecord[]> => {
    if (event.toolName === TOOL_NAMES.sendUserFile) {
      // The delivery tool owns the authorised reads. Do not reopen its paths
      // here under Host authority or silently skip any member of the batch.
      const sourceFailures = new Set<unknown>();
      const batch = event.candidates.map((candidate) => {
        const readContent = candidate.readContent;
        if (
          candidate.source !== 'user_delivery' ||
          (!readContent && !candidate.reuseArtifactId) ||
          (readContent && candidate.reuseArtifactId)
        ) {
          throw new Error('File delivery requires an authorised content reader');
        }
        return {
          sessionId: event.sessionId,
          turnId: event.turnId,
          name: candidate.name,
          kind: candidate.kind,
          source: candidate.source,
          ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
          ...(candidate.summary ? { summary: candidate.summary } : {}),
          ...(candidate.reuseArtifactId
            ? { reuseArtifactId: candidate.reuseArtifactId, maxBytes: MAX_ATTACHMENT_BYTES }
            : {
                readContent: async () => {
                  try {
                    const content = await readContent!();
                    if (contentBytes(content) > MAX_ATTACHMENT_BYTES) {
                      throw new Error(
                        `Attachment "${candidate.name}" exceeds the ${MAX_ATTACHMENT_BYTES}-byte size limit.`,
                      );
                    }
                    return content;
                  } catch (error) {
                    sourceFailures.add(error);
                    throw error;
                  }
                },
              }),
        };
      });
      return input.sessionAdmission.runOrJoin(event.sessionId, async () => {
        if ((await input.sessions.probeSessionRemoval(event.sessionId)).kind !== 'present') {
          throw new Error('The Session was removed before file delivery; no files were delivered.');
        }
        try {
          return await input.artifacts.createBatch(batch);
        } catch (error) {
          // An unreadable/denied source is an ordinary tool failure. Only a
          // storage or rollback failure should drain the Host.
          if (!sourceFailures.has(error) && !(error instanceof ArtifactSourceUnavailableError))
            input.requestDrain();
          throw error;
        }
      });
    }
    if (event.candidates.some((candidate) => candidate.source === 'saved_tool_output')) {
      const batch = event.candidates.map((candidate) => {
        if (
          candidate.source !== 'saved_tool_output' ||
          candidate.content === undefined ||
          contentBytes(candidate.content) > TOOL_RESULT_FILE_MAX_BYTES
        ) {
          throw new Error('Saved output requires bounded producer content');
        }
        const content =
          typeof candidate.content === 'string'
            ? candidate.content
            : new Uint8Array(candidate.content);
        return {
          sessionId: event.sessionId,
          turnId: event.turnId,
          name: candidate.name,
          kind: candidate.kind,
          source: candidate.source,
          mimeType: candidate.mimeType,
          readContent: async () => content,
        };
      });
      return input.sessionAdmission.runOrJoin(event.sessionId, async () => {
        if ((await input.sessions.probeSessionRemoval(event.sessionId)).kind !== 'present')
          throw new Error('Session was removed before output publication');
        return runWrite(() => input.artifacts.createBatch(batch));
      });
    }
    const recorded: ArtifactRecord[] = [];
    for (const candidate of event.candidates) {
      let content = candidate.content;
      if (content === undefined && candidate.sourcePath) {
        content = (await readBoundedSourceFile(event.cwd, candidate.sourcePath)) ?? undefined;
      }
      if (content === undefined || contentBytes(content) > MAX_ATTACHMENT_BYTES) continue;
      const artifact = await publish({
        sessionId: event.sessionId,
        turnId: event.turnId,
        name: candidate.name,
        kind: candidate.kind,
        content,
        ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
        source: candidate.source ?? 'tool_result',
        ...(candidate.summary ? { summary: candidate.summary } : {}),
      });
      if (artifact) recorded.push(artifact);
    }
    return recorded;
  };

  const services: HostExecutionArtifactServices = {
    ...(input.fileResources
      ? {
          materializeFile: input.fileResources.materialize,
          fileViewRoot: input.fileResources.sessionViewRoot,
          transferredFileRefs: input.fileResources.transferredFileRefs,
          restoreSessionFiles: input.fileResources.restoreSessionFiles,
        }
      : {}),
    recordToolArtifacts,
    snapshotImage,
    retainChildArtifacts: (parentSessionId, childSessionId, artifactIds) =>
      input.sessionAdmission.runOrJoin(parentSessionId, async () => {
        if ((await input.sessions.probeSessionRemoval(parentSessionId)).kind !== 'present')
          throw new Error('The parent Session was removed before file hand-back.');
        return runWrite(() =>
          input.artifacts.retainChildArtifacts({
            sourceSessionId: childSessionId,
            targetSessionId: parentSessionId,
            artifactIds,
          }),
        );
      }),
    publishChildWorkspacePatch: async ({ sessionId, turnId, binding, patch }) => {
      const artifact = await publish({
        id: subagentWritebackArtifactId(sessionId, turnId),
        sessionId,
        turnId,
        name: 'workspace.patch',
        kind: 'diff',
        content: patch,
        mimeType: 'text/x-diff; charset=utf-8',
        source: 'subagent_writeback',
        summary: `Workspace changes relative to ${binding.baseCommit}.`,
      });
      if (!artifact)
        throw new Error(`Child Session ${sessionId} was retired before patch publication`);
      return artifact;
    },
  };
  return Object.freeze(services);
}

function subagentWritebackArtifactId(sessionId: string, turnId: string): string {
  const digest = createHash('sha256')
    .update('maka-subagent-writeback-v1\0')
    .update(sessionId)
    .update('\0')
    .update(turnId)
    .digest('hex')
    .slice(0, 32);
  return `subagent_writeback_${digest}`;
}

async function readBoundedSourceFile(cwd: string, sourcePath: string): Promise<Buffer | null> {
  const candidate = isAbsolute(sourcePath) ? sourcePath : resolve(cwd, sourcePath);
  let root: string;
  let target: string;
  try {
    [root, target] = await Promise.all([realpath(cwd), realpath(candidate)]);
  } catch {
    return null;
  }
  if (!isPathInside(root, target)) return null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(target, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_ATTACHMENT_BYTES) return null;
    const currentTarget = await realpath(target);
    if (!isPathInside(root, currentTarget)) return null;
    const current = await stat(currentTarget);
    if (current.dev !== opened.dev || current.ino !== opened.ino) return null;
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    return offset === bytes.byteLength ? bytes : bytes.subarray(0, offset);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function contentBytes(content: string | Uint8Array): number {
  return typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength;
}
