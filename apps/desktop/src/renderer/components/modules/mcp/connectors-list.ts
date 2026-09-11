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

// What the Connectors list SHOWS, decided without a component in sight.
//
// A row is one config entry plus the status the Host last pushed for it, and
// every question the page asks about that pair — does it match the search, is
// it connected, what transport is it actually using, what does its state read
// as — is answered here. The page then only arranges the answers.
//
// Search covers id, endpoint and TOOL NAMES (the pre-rewrite page's rule):
// "the server that has `create_issue`" is how someone looks for a server whose
// id they never chose.

import type {
  McpServerConfig,
  McpServerStatus,
  McpTransportKind,
  McpConfigImportResult,
} from '@maka/core/mcp';
import { isMcpStdioConfig } from '@maka/core/mcp';
import { formatCommandLine } from '../../../lib/ported/mcp-server-command-line.js';
import type { McpCopy } from '../../../locales/mcp-copy.js';
import type { ModulesCopy } from '../../../locales/modules-copy.js';

/** Claude's Connectors page: All · Connected · Not connected. */
export type ConnectorFilter = 'all' | 'connected' | 'not-connected';

export interface ConnectorRow {
  readonly id: string;
  readonly config: McpServerConfig;
  readonly status: McpServerStatus | undefined;
}

/** State → chip tone. `needs-auth` asks for a person, so it is `attention`. */
export const CONNECTOR_STATE_TONE = {
  disabled: 'neutral',
  disconnected: 'neutral',
  connecting: 'active',
  connected: 'success',
  'needs-auth': 'attention',
  error: 'error',
} as const;

export function connectorRows(
  servers: readonly (readonly [string, McpServerConfig])[],
  statuses: ReadonlyMap<string, McpServerStatus>,
): ConnectorRow[] {
  return servers.map(([id, config]) => ({ id, config, status: statuses.get(id) }));
}

/** The command line for a stdio server, the URL for a remote one. */
export function connectorEndpoint(config: McpServerConfig): string {
  return isMcpStdioConfig(config)
    ? formatCommandLine(config.command, config.args ?? [])
    : config.url;
}

/**
 * What the connection IS, not what it asked for: a remote server configured
 * `auto` and negotiated down to SSE reads as SSE once the status says so.
 */
export function connectorTransport(row: ConnectorRow): Exclude<McpTransportKind, 'auto'> | 'auto' {
  if (row.status?.transport) return row.status.transport;
  return isMcpStdioConfig(row.config) ? 'stdio' : (row.config.transport ?? 'auto');
}

export function connectorTransportLabel(row: ConnectorRow, copy: McpCopy): string {
  switch (connectorTransport(row)) {
    case 'stdio':
      return copy.page.localStdio;
    case 'streamable-http':
      return copy.editor.transportStreamableHttp;
    case 'sse':
      return copy.editor.transportLegacySse;
    case 'auto':
      return copy.editor.transportAuto;
  }
}

/** The state a row paints: the status', or what the config implies before one arrives. */
export function connectorState(row: ConnectorRow): McpServerStatus['state'] {
  return row.status?.state ?? (row.config.enabled === false ? 'disabled' : 'disconnected');
}

export function connectorStateLabel(
  row: ConnectorRow,
  copy: McpCopy,
  modules: ModulesCopy['mcp'],
): string {
  switch (connectorState(row)) {
    case 'connected':
      return copy.row.connected(row.status?.toolCount ?? 0);
    case 'connecting':
      return copy.row.connecting;
    case 'disabled':
      return copy.row.disabled;
    case 'needs-auth':
      return modules.needsAuth;
    case 'error':
      return copy.row.failed;
    case 'disconnected':
      return copy.row.disconnected;
  }
}

export function connectorIsConnected(row: ConnectorRow): boolean {
  return row.status?.state === 'connected';
}

/** Id, endpoint and tool names, lowercased by the caller's locale rules. */
export function connectorMatches(row: ConnectorRow, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [row.id, connectorEndpoint(row.config), ...(row.status?.tools ?? []).map((t) => t.name)]
    .join('\n')
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export function normalizeConnectorQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function filterConnectorRows(
  rows: readonly ConnectorRow[],
  input: { query: string; filter: ConnectorFilter },
): ConnectorRow[] {
  const normalized = normalizeConnectorQuery(input.query);
  return rows.filter((row) => {
    if (!connectorMatches(row, normalized)) return false;
    if (input.filter === 'connected') return connectorIsConnected(row);
    if (input.filter === 'not-connected') return !connectorIsConnected(row);
    return true;
  });
}

/**
 * Pill counts. They count what the SEARCH left, not the whole list: a count
 * that ignores the query sends the user to a pill that then shows nothing.
 */
export function connectorFilterCounts(
  rows: readonly ConnectorRow[],
  query = '',
): Record<ConnectorFilter, number> {
  const normalized = normalizeConnectorQuery(query);
  const matched = rows.filter((row) => connectorMatches(row, normalized));
  const connected = matched.filter(connectorIsConnected).length;
  return { all: matched.length, connected, 'not-connected': matched.length - connected };
}

/** Why an `mcp.json` was refused, in the user's words. Ported from upstream. */
export function mcpImportFailureMessage(
  result: Extract<McpConfigImportResult, { status: 'invalid' }>,
  copy: McpCopy,
): string {
  switch (result.reason) {
    case 'invalid-json':
      return copy.errors.importJson;
    case 'not-object':
      return copy.errors.importObject;
    case 'unsupported-version':
      return copy.errors.importVersion(result.version ?? '?');
    case 'missing-servers':
      return copy.errors.importServersObject;
    case 'protocol-version':
      return copy.errors.importProtocolVersion;
  }
}

/**
 * How an import landed: what the file ADDED versus what it replaced. The Host
 * reports one count; the page knows which ids it had a moment ago, and the
 * difference is the only part a person can act on ("it overwrote my edit").
 */
export function connectorImportSummary(input: {
  before: readonly string[];
  after: readonly string[];
  importedCount: number;
}): { added: number; replaced: number } {
  const before = new Set(input.before);
  const added = input.after.filter((id) => !before.has(id)).length;
  return { added, replaced: Math.max(input.importedCount - added, 0) };
}
