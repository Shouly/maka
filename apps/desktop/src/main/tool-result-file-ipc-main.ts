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

// Shows where a tool result that was too long to show was saved, in the
// system's file manager. It REVEALS and never opens: the folder is in the temp
// directory, where the sandboxed command can write too, and handing a path
// from there to `shell.openPath` would let the system launch whatever that
// file is registered to, outside the sandbox. Main builds the path itself
// (`resolveToolResultFilePath`) and reveals that one.

import { toolResultRoot } from '@maka/runtime/tool-result-file';
import type { ReconnectableReadIpcMain } from './ipc-reconnect-policy.js';
import { resolveToolResultFilePath } from './open-path-guard.js';

export type RevealToolResultFileResult =
  | { ok: true }
  | { ok: false; reason: 'not-allowed' | 'missing' | 'not-a-file' | 'open-failed' };

export interface ToolResultFileIpcDeps {
  readonly ipcMain: Pick<ReconnectableReadIpcMain, 'handle'>;
  /** Electron's `shell`; only `showItemInFolder` is ever called. */
  readonly shell: { showItemInFolder(path: string): void };
  /** False for a Host on another machine, whose files are not on this disk. */
  readonly allowLocalPaths: boolean;
  /** The folder saved results live under; the runtime's own unless a test says. */
  readonly root?: string;
}

export function registerToolResultFileIpc(deps: ToolResultFileIpcDeps): void {
  const root = deps.root ?? toolResultRoot();
  deps.ipcMain.handle(
    'app:revealToolResultFile',
    async (_event, sessionId: unknown, path: unknown): Promise<RevealToolResultFileResult> => {
      if (!deps.allowLocalPaths) return { ok: false, reason: 'not-allowed' };
      if (typeof sessionId !== 'string' || typeof path !== 'string') {
        return { ok: false, reason: 'not-allowed' };
      }
      const resolved = await resolveToolResultFilePath({ root, sessionId, path });
      if (!resolved.ok) return resolved;
      try {
        deps.shell.showItemInFolder(resolved.path);
      } catch {
        return { ok: false, reason: 'open-failed' };
      }
      return { ok: true };
    },
  );
}
