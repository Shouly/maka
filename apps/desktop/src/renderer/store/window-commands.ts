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

// Native menu commands, routed to shell intents.
//
// The macOS/Windows application menu is main's; it sends `newTask`,
// `openSettings` and `openHelp` through `appWindow.subscribeCommand`. They are
// the same three intents ⌘N / ⌘, / ? raise from the keyboard, so both paths
// land on one dispatcher rather than two copies that can drift.

import { subscribeWindowCommand } from '../bridge/app-window.js';

export type ShellCommandId = 'newTask' | 'openSettings' | 'openHelp';

export interface ShellCommandHandlers {
  newTask(): void;
  openSettings(): void;
  openHelp(): void;
}

/** Dispatch one command id. Unknown ids are ignored, not thrown. */
export function dispatchShellCommand(
  id: string,
  handlers: ShellCommandHandlers,
): boolean {
  if (id === 'newTask' || id === 'openSettings' || id === 'openHelp') {
    handlers[id]();
    return true;
  }
  return false;
}

/** Bind the native menu to the handlers for as long as the shell is mounted. */
export function startWindowCommands(handlers: ShellCommandHandlers): () => void {
  return subscribeWindowCommand((command) => {
    dispatchShellCommand(command.id, handlers);
  });
}
