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

// The MCP add/edit form's data model, ported from the pre-rewrite
// `renderer/mcp-page-model.ts` and `renderer/mcp-editor-validation.ts`.
//
// The draft is flat strings because that is what the form holds; the config is
// the protocol shape. Keeping the two conversions here (rather than inside the
// dialog) is what lets the dialog be a form and nothing else, and it is what
// makes the round trip testable without rendering anything.
//
// Two invariants are load-bearing:
//
//   - `oauth` is carried opaquely. The editor has no OAuth fields, but an
//     edit → save of an OAuth-configured server must not delete the block: the
//     masked clientSecret sentinel is what restores it from disk in main.
//   - an omitted `protocol` is the LEGACY posture for a stored entry and the
//     authoring default for a new remote one. `resolveMcpProtocolPreference`
//     owns that reading; this file only decides what a NEW draft starts as.

import type { McpOAuthConfig, McpProtocolPreference, McpServerConfig } from '@maka/core/mcp';
import { isMcpStdioConfig, resolveMcpProtocolPreference } from '@maka/core/mcp';
import { formatCommandLine, parseCommandLine } from './mcp-server-command-line.js';

export type McpServerDraft = {
  id: string;
  kind: 'stdio' | 'remote';
  enabled: boolean;
  commandLine: string;
  cwd: string;
  env: string;
  url: string;
  transport: 'auto' | 'streamable-http' | 'sse';
  /** Undefined means the authoring default for the current kind. */
  protocol?: McpProtocolPreference;
  headers: string;
  oauth?: McpOAuthConfig;
};

export type McpDraftField = 'id' | 'commandLine' | 'url' | 'env' | 'headers';
export type McpDraftIssue =
  | 'required'
  | 'invalid-url'
  | 'unbalanced-quote'
  | 'invalid-map'
  | 'duplicate-id';
/**
 * `line` is the 1-based offending line of a `KEY=value` block. It is part of
 * the error rather than left to the dialog to recompute: "line 3 must use
 * KEY=value" is a fixable message and "the environment is invalid" is not.
 */
export type McpDraftError = { issue: McpDraftIssue; line?: number };
export type McpDraftErrors = Partial<Record<McpDraftField, McpDraftError>>;

export function createEmptyMcpDraft(): McpServerDraft {
  return {
    id: '',
    kind: 'stdio',
    enabled: true,
    commandLine: '',
    cwd: '',
    env: '',
    url: '',
    transport: 'auto',
    headers: '',
  };
}

export function mcpDraftFromConfig(id: string, config: McpServerConfig): McpServerDraft {
  if (isMcpStdioConfig(config)) {
    return {
      ...createEmptyMcpDraft(),
      id,
      enabled: config.enabled !== false,
      commandLine: formatCommandLine(config.command, config.args ?? []),
      cwd: config.cwd ?? '',
      env: formatMap(config.env),
      protocol: resolveMcpProtocolPreference(config),
    };
  }
  return {
    ...createEmptyMcpDraft(),
    id,
    kind: 'remote',
    enabled: config.enabled !== false,
    url: config.url,
    transport: config.transport ?? 'auto',
    protocol: resolveMcpProtocolPreference(config),
    headers: formatMap(config.headers),
    ...(config.oauth ? { oauth: config.oauth } : {}),
  };
}

export function mcpDraftProtocolPreference(draft: McpServerDraft): McpProtocolPreference {
  // Legacy SSE has no modern era to negotiate, so the preference is not the
  // user's to set there.
  if (draft.kind === 'remote' && draft.transport === 'sse') return 'legacy';
  return draft.protocol ?? (draft.kind === 'remote' ? 'auto' : 'legacy');
}

/**
 * Everything wrong with the draft, by field.
 *
 * `takenIds` excludes the id being edited at the call site: renaming a server
 * to its own name is not a collision, and the add path passes every id.
 */
export function validateMcpServerDraft(
  draft: McpServerDraft,
  takenIds: readonly string[] = [],
): McpDraftErrors {
  const errors: McpDraftErrors = {};
  const id = draft.id.trim();
  if (!id) errors.id = { issue: 'required' };
  else if (takenIds.includes(id)) errors.id = { issue: 'duplicate-id' };

  if (draft.kind === 'stdio') {
    const parsed = parseCommandLine(draft.commandLine);
    if (!parsed.ok) errors.commandLine = { issue: 'unbalanced-quote' };
    else if (!parsed.command.trim()) errors.commandLine = { issue: 'required' };
    const envLine = invalidMapLine(draft.env);
    if (envLine !== null) errors.env = { issue: 'invalid-map', line: envLine };
    return errors;
  }

  const value = draft.url.trim();
  if (!value) {
    errors.url = { issue: 'required' };
  } else {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.url = { issue: 'invalid-url' };
      }
    } catch {
      errors.url = { issue: 'invalid-url' };
    }
  }
  const headerLine = invalidMapLine(draft.headers);
  if (headerLine !== null) errors.headers = { issue: 'invalid-map', line: headerLine };
  return errors;
}

/** The 1-based line that is not `KEY=value`, or `null` when every line is. */
function invalidMapLine(value: string): number | null {
  const lines = value.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) continue;
    if (line.indexOf('=') <= 0) return index + 1;
  }
  return null;
}

export function mcpDraftHasErrors(errors: McpDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * The protocol config for a validated draft, or `null` when it is not one.
 *
 * Returning null rather than throwing (the pre-rewrite module threw) keeps the
 * dialog's submit path a single branch: validation already ran, and a throw
 * would have to be caught somewhere to say the same thing.
 */
export function mcpConfigFromDraft(draft: McpServerDraft): McpServerConfig | null {
  if (draft.kind === 'stdio') {
    const parsed = parseCommandLine(draft.commandLine);
    if (!parsed.ok) return null;
    const env = parseMap(draft.env);
    if (env === null) return null;
    return {
      enabled: draft.enabled,
      command: parsed.command,
      args: parsed.args,
      ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
      env,
      protocol: mcpDraftProtocolPreference(draft),
    };
  }
  const headers = parseMap(draft.headers);
  if (headers === null) return null;
  return {
    enabled: draft.enabled,
    url: draft.url.trim(),
    transport: draft.transport,
    protocol: mcpDraftProtocolPreference(draft),
    headers,
    ...(draft.oauth ? { oauth: draft.oauth } : {}),
  };
}

/** `KEY=value` per line. `null` when any non-blank line is not that. */
function parseMap(value: string): Record<string, string> | null {
  const entries: [string, string][] = [];
  for (const line of value.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) return null;
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1)]);
  }
  return Object.fromEntries(entries);
}

function formatMap(value?: Record<string, string>): string {
  return Object.entries(value ?? {})
    .map(([key, item]) => `${key}=${item}`)
    .join('\n');
}
