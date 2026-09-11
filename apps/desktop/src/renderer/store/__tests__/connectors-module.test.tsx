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

// The Connectors page: what the list decides, and what the page paints.
//
// The decisions (search, pills, transport, import summary) are asserted on
// `connectors-list.ts` directly, because they are the part that has to stay
// true no matter how the row is drawn. The painting is asserted on static
// markup, because the contracts the shell and the e2e suite key on —
// `module-main`, `mcp-market-row`, the "Connectors" tab, the "Configured
// servers" section — are markup, and a page that renders without them looks
// finished and is unreachable.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider } from '@maka/ui';
import type { McpServerConfig, McpServerStatus, McpToolDescriptor } from '@maka/core/mcp';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { McpModule } from '../../components/modules/mcp/McpModule.js';
import { McpMarket } from '../../components/modules/mcp/McpMarket.js';
import { McpServerDetails } from '../../components/modules/mcp/McpServerDetails.js';
import {
  connectorFilterCounts,
  connectorImportSummary,
  connectorMatches,
  connectorTransport,
  connectorTransportLabel,
  filterConnectorRows,
  mcpImportFailureMessage,
  type ConnectorRow,
} from '../../components/modules/mcp/connectors-list.js';
import { getMcpCopy } from '../../locales/mcp-copy.js';
import { mcpStore, type McpSnapshot } from '../mcp-store.js';
import type { ResourceState } from '../resource-store.js';

function renderTree(node: Parameters<typeof renderToStaticMarkup>[0]) {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, { children: node }),
    }),
  );
  return parseHTML(html).document;
}

const copy = getMcpCopy('en');

function tool(name: string): McpToolDescriptor {
  return { serverId: 'files', name, inputSchema: {} };
}

function status(patch: Partial<McpServerStatus> & { serverId: string }): McpServerStatus {
  return {
    state: 'connected',
    toolCount: 0,
    tools: [],
    updatedAt: 0,
    ...patch,
  };
}

const filesConfig: McpServerConfig = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/notes'],
};
const searchConfig: McpServerConfig = { url: 'https://example.test/mcp', transport: 'auto' };

const filesRow: ConnectorRow = {
  id: 'files',
  config: filesConfig,
  status: status({
    serverId: 'files',
    transport: 'stdio',
    toolCount: 2,
    tools: [tool('read_file'), tool('write_file')],
    negotiatedProtocol: { era: 'modern', revision: '2026-07-28' },
    stderrTail: ['npm warn exec', 'listening on stdio'],
  }),
};
const searchRow: ConnectorRow = {
  id: 'search',
  config: searchConfig,
  status: status({ serverId: 'search', state: 'error', transport: 'sse', error: 'refused' }),
};
const rows = [filesRow, searchRow];

/* ── what the list decides ─────────────────────────────────────────────── */

test('search covers the id, the endpoint and the tool names', () => {
  assert.equal(connectorMatches(filesRow, 'files'), true);
  // The endpoint: the command line, not just the command.
  assert.equal(connectorMatches(filesRow, 'server-filesystem'), true);
  // A tool name nobody put in the id is how a server is actually looked for.
  assert.equal(connectorMatches(filesRow, 'write_file'), true);
  assert.equal(connectorMatches(searchRow, 'write_file'), false);
  assert.equal(connectorMatches(searchRow, 'example.test'), true);
  // An empty query hides nothing.
  assert.equal(connectorMatches(searchRow, ''), true);
});

test('the pills split what the search left, and count the same rows', () => {
  const all = connectorFilterCounts(rows);
  assert.deepEqual(all, { all: 2, connected: 1, 'not-connected': 1 });
  assert.deepEqual(
    filterConnectorRows(rows, { query: '', filter: 'connected' }).map((row) => row.id),
    ['files'],
  );
  assert.deepEqual(
    filterConnectorRows(rows, { query: '', filter: 'not-connected' }).map((row) => row.id),
    ['search'],
  );
  // Counting the whole list while the search narrows it offers a pill that
  // then shows nothing: the counts are of the MATCHED rows.
  assert.deepEqual(connectorFilterCounts(rows, 'write_file'), {
    all: 1,
    connected: 1,
    'not-connected': 0,
  });
  assert.deepEqual(
    filterConnectorRows(rows, { query: 'EXAMPLE.TEST', filter: 'all' }).map((row) => row.id),
    ['search'],
  );
});

test('the transport shown is the negotiated one, not the requested one', () => {
  // Configured `auto`, negotiated SSE: the row says SSE.
  assert.equal(connectorTransport(searchRow), 'sse');
  assert.equal(connectorTransportLabel(searchRow, copy), copy.editor.transportLegacySse);
  // No status yet: the config's own answer stands in.
  assert.equal(connectorTransport({ id: 'x', config: searchConfig, status: undefined }), 'auto');
  assert.equal(connectorTransport({ id: 'y', config: filesConfig, status: undefined }), 'stdio');
  assert.equal(connectorTransportLabel(filesRow, copy), copy.page.localStdio);
});

test('an import reports what it added and what it replaced', () => {
  assert.deepEqual(
    connectorImportSummary({
      before: ['files'],
      after: ['files', 'search', 'issues'],
      importedCount: 3,
    }),
    { added: 2, replaced: 1 },
  );
  assert.deepEqual(connectorImportSummary({ before: [], after: ['files'], importedCount: 1 }), {
    added: 1,
    replaced: 0,
  });
  // Every refusal reason has a sentence; none may fall through to prose.
  for (const reason of [
    'invalid-json',
    'not-object',
    'unsupported-version',
    'missing-servers',
    'protocol-version',
  ] as const) {
    const message = mcpImportFailureMessage({ status: 'invalid', reason, version: '9' }, copy);
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0, reason);
  }
  assert.ok(
    mcpImportFailureMessage(
      { status: 'invalid', reason: 'unsupported-version', version: '9' },
      copy,
    ).includes('9'),
  );
});

/* ── what the page paints ──────────────────────────────────────────────── */

test('the row detail carries the tool names, the stderr tail and the protocol', () => {
  const document = renderTree(
    createElement(McpServerDetails, { id: 'mcp-details-files', row: filesRow }),
  );
  const panel = document.querySelector('[data-maka-contract="mcp-server-details"]');
  assert.ok(panel);
  assert.equal(panel?.getAttribute('id'), 'mcp-details-files');
  const text = panel?.textContent ?? '';
  assert.ok(text.includes('read_file') && text.includes('write_file'));
  assert.ok(text.includes('2026-07-28'), 'the negotiated protocol is a fact of the connection');
  assert.ok(text.includes('Local stdio'));
  assert.ok(text.includes('server-filesystem'));
  assert.ok(
    text.includes('listening on stdio'),
    'the stderr tail is what a failed stdio server left',
  );
  assert.equal(panel?.querySelectorAll('li').length, 2);
});

test('a remote server shows no stderr, and a connected server with no tools says so', () => {
  const document = renderTree(
    createElement(McpServerDetails, {
      id: 'mcp-details-search',
      // stderr can only be believed for a process this machine started.
      row: { ...searchRow, status: status({ serverId: 'search', stderrTail: ['noise'] }) },
    }),
  );
  const text = document.querySelector('[data-maka-contract="mcp-server-details"]')?.textContent;
  assert.ok(text);
  assert.ok(!text?.includes('noise'));
  assert.ok(text?.includes('Tools appear here once the server connects.'));
});

test('the directory offers Manage for an installed entry and Cancel while one installs', () => {
  const document = renderTree(
    createElement(McpMarket, {
      installedIds: ['notion'],
      installPhases: { figma: 'installing' },
      query: '',
      disabled: false,
      onInstall: () => {},
      onCancelInstall: () => {},
      onManage: () => {},
      onClearSearch: () => {},
    }),
  );
  const cards = document.querySelectorAll('[data-maka-contract="mcp-market-row"]');
  assert.ok(cards.length > 1, 'the shipped directory still renders as cards');
  const installed = document.querySelector('[data-mcp-market-id="notion"]');
  assert.ok(installed?.textContent?.includes('Manage'));
  const installing = document.querySelector('[data-mcp-market-id="figma"]');
  assert.equal(installing?.getAttribute('data-mcp-install-phase'), 'installing');
  assert.ok(installing?.textContent?.includes('Installing…'));
  assert.ok(
    installing?.querySelector('[aria-label^="Cancel installation of"]'),
    'a running install can be withdrawn from the card that started it',
  );
});

test('a directory search that matches nothing offers to clear itself', () => {
  const document = renderTree(
    createElement(McpMarket, {
      installedIds: [],
      installPhases: {},
      query: 'zzzznotathing',
      disabled: false,
      onInstall: () => {},
      onCancelInstall: () => {},
      onManage: () => {},
      onClearSearch: () => {},
    }),
  );
  assert.equal(document.querySelectorAll('[data-maka-contract="mcp-market-row"]').length, 0);
  assert.ok(document.documentElement.textContent?.includes('No matching connectors'));
  assert.ok(document.documentElement.textContent?.includes('Clear search'));
});

/**
 * Put a snapshot on the page.
 *
 * `renderToStaticMarkup` reads zustand's SERVER snapshot — `getInitialState`,
 * the state the store was created with — not `getState`, so a plain
 * `setState` renders the empty page a browser would only see for one frame.
 * Seeding both is what makes the static markup the markup a mounted page has.
 */
function seedMcpStore(data: McpSnapshot): () => void {
  const seeded: ResourceState<McpSnapshot> = {
    data,
    loading: false,
    error: undefined,
    revision: 1,
  };
  const initial = mcpStore.getInitialState;
  mcpStore.setState(seeded);
  mcpStore.getInitialState = () => seeded;
  return () => {
    mcpStore.getInitialState = initial;
    mcpStore.setState({ data: undefined, loading: false, error: undefined, revision: 0 });
  };
}

test('the Connectors page keeps its contracts and adds the search and the pills', () => {
  const restore = seedMcpStore({
    config: { version: 3, mcpServers: { files: filesConfig, search: searchConfig } },
    statuses: [filesRow.status!, searchRow.status!],
  });
  const document = renderTree(createElement(McpModule, {}));

  assert.ok(document.querySelector('[data-maka-contract="module-main"]'));
  assert.ok(document.querySelector('[data-maka-contract="module-actions"]'));
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
  assert.ok(tabs.includes('Connectors'), 'the sidebar and the e2e suite name this tab');

  const section = document.querySelector('#mcp-configured');
  assert.ok(section?.textContent?.includes('Configured connectors'));
  assert.ok(section?.textContent?.includes('2'));

  const pills = document.querySelector('[aria-label="Filter by connection state"]');
  assert.ok(pills, 'Claude’s connectors page filters All / Connected / Not connected');
  const pillText = [...(pills?.querySelectorAll('button') ?? [])].map((pill) => pill.textContent);
  assert.deepEqual(pillText, ['All2', 'Connected1', 'Not connected1']);

  const body = document.documentElement.textContent ?? '';
  // `mcp:importConfig` is the add dialog's second mode (upstream's two-mode
  // editor), reached from the Add button; it is not a toolbar control.
  assert.ok(body.includes(getMcpCopy('en').page.add), 'the add dialog is the way in');
  assert.ok(document.querySelector('[aria-label="Search connectors"]'));
  // The short facts ride the row; the long ones wait behind the disclosure.
  assert.ok(
    body.includes('Local stdio · npx -y @modelcontextprotocol/server-filesystem /tmp/notes'),
  );
  assert.ok(body.includes('Modern · 2026-07-28'));
  assert.ok(document.querySelector('[aria-label="Show details for files"]'));
  assert.equal(document.querySelectorAll('[data-maka-contract="mcp-server-details"]').length, 0);

  restore();
});
