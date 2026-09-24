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

/** Legacy permission payloads and shared tool-category compatibility types. */

import { TOOL_NAMES } from './tool-names.js';

// ============================================================================
// Mode + Tool categories
// ============================================================================

export const PERMISSION_MODES = ['explore', 'ask', 'bypass'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * A mode that was removed but still appears in records written before the
 * removal. It never had behavior of its own — `execute` compiled to the same
 * profile as `ask`, displayed as `ask`, and produced the same execution
 * boundary — so folding it costs nothing and is not a downgrade.
 */
const RETIRED_PERMISSION_MODES: Readonly<Record<string, PermissionMode>> = {
  execute: 'ask',
};

/**
 * A permission mode read back from a persisted record, or `undefined` when the
 * value is not one.
 *
 * Decoders use this instead of {@link isPermissionMode} so a retired mode
 * stays readable: the record is old, not malformed, and refusing it would make
 * the Session, run or task it belongs to unopenable. New input and wire values
 * use the strict check — nothing should still be *sending* a retired mode.
 */
export function decodePersistedPermissionMode(value: unknown): PermissionMode | undefined {
  if (typeof value !== 'string') return undefined;
  const retired = RETIRED_PERMISSION_MODES[value];
  if (retired !== undefined) return retired;
  return isPermissionMode(value) ? value : undefined;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

/** Canonical category names use Claude SDK terminology. Pi adapter MUST
 *  translate Pi-native tool names into these before they reach the runtime. */
export type ToolCategory =
  | 'read' //              Read, search_files, Grep, Glob, ls
  | 'web_read' //          WebFetch, WebSearch (GET-class)
  | 'file_write' //        Write, Edit, patch (create / append / overwrite)
  | 'fs_destructive' //    rm, rmdir, dd, truncate, shred, mkfs, find -delete, ...
  | 'shell_safe' //        reserved; nothing produces it
  | 'shell_unsafe' //      default Bash bucket
  | 'git_destructive' //   git reset --hard, push --force, branch -D, ...
  | 'network_send' //      POST / PUT / DELETE
  | 'privileged' //        sudo, chmod, chown, kill, systemctl
  | 'browser' //           embedded-browser observe→act on the user's logged-in sessions
  | 'computer_use' //      host-level observation and input on the user's real applications
  | 'client_capability' // client-provided open-world capability with untrusted metadata
  | 'custom_tool' //       our own session-scoped tools without a stricter category hint
  | 'subagent'; //         read-only delegated exploration tools

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  'read',
  'web_read',
  'file_write',
  'fs_destructive',
  'shell_safe',
  'shell_unsafe',
  'git_destructive',
  'network_send',
  'privileged',
  'browser',
  'computer_use',
  'client_capability',
  'custom_tool',
  'subagent',
];

export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === 'string' && (TOOL_CATEGORIES as readonly string[]).includes(value);
}

// ============================================================================
// Tool execution environment facts
// ============================================================================

export type ToolExecutionIsolation = 'none' | 'worktree' | 'container' | 'remote';
export type ToolExecutionWriteBack = 'direct' | 'diff_review';
export type ToolExecutionNetwork = 'host' | 'sandbox' | 'disabled';
export type ToolExecutionSecrets = 'host_env' | 'brokered' | 'none';

export interface ToolExecutionFacts {
  isolation: ToolExecutionIsolation;
  writesAffectHost: boolean;
  writeBack: ToolExecutionWriteBack;
  network: ToolExecutionNetwork;
  secrets: ToolExecutionSecrets;
}

// ============================================================================
// Tool name → category mapping (Claude SDK canonical names)
// ============================================================================

export const BUILTIN_TOOL_CATEGORY: Record<string, ToolCategory> = {
  // read
  [TOOL_NAMES.read]: 'read',
  [TOOL_NAMES.archiveRead]: 'read',
  search_files: 'read',
  [TOOL_NAMES.grep]: 'read',
  [TOOL_NAMES.glob]: 'read',
  // web read
  [TOOL_NAMES.webFetch]: 'web_read',
  [TOOL_NAMES.webSearch]: 'web_read',
  // file write
  [TOOL_NAMES.write]: 'file_write',
  [TOOL_NAMES.edit]: 'file_write',
  [TOOL_NAMES.notebookEdit]: 'file_write',
  [TOOL_NAMES.applyPatch]: 'file_write',
  patch: 'file_write',
  // shell
  [TOOL_NAMES.bash]: 'shell_unsafe',
  [TOOL_NAMES.taskInput]: 'shell_unsafe',
};

/** The category a tool falls in: its own hint, the built-in table, or custom. */
export function classifyToolUse(input: {
  toolName: string;
  categoryHint?: ToolCategory;
}): ToolCategory {
  return input.categoryHint ?? BUILTIN_TOOL_CATEGORY[input.toolName] ?? 'custom_tool';
}
