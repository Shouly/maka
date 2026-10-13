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

import { parseAttachmentResourceRef } from '@maka/core/attachments';
import { isCanonicalArtifactEntityId } from '@maka/core/artifacts';
import type { ReconnectableReadIpcMain } from './ipc-reconnect-policy.js';

export type RevealToolResultFileResult =
  | { ok: true }
  | { ok: false; reason: 'not-allowed' | 'missing' | 'not-a-file' | 'open-failed' };

export interface ToolResultFileIpcDeps {
  readonly ipcMain: Pick<ReconnectableReadIpcMain, 'handle'>;
  readonly revealArtifact: (sessionId: string, artifactId: string) => Promise<RevealToolResultFileResult>;
}

/** Always ask the owning Host, including local Hosts. Renderer strings are never OS paths. */
export function registerToolResultFileIpc(deps: ToolResultFileIpcDeps): void {
  deps.ipcMain.handle('app:revealToolResultFile', async (_event, sessionId: unknown, ref: unknown): Promise<RevealToolResultFileResult> => {
    if (!isCanonicalArtifactEntityId(sessionId) || typeof ref !== 'string') return { ok: false, reason: 'not-allowed' };
    const resource = parseAttachmentResourceRef(ref);
    if (!resource) return { ok: false, reason: 'not-allowed' };
    return deps.revealArtifact(sessionId, resource.artifactId);
  });
}
