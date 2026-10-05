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

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { REQUEST_COMPOSITION_MAX_TOOL_DESCRIPTION_LENGTH } from '@maka/core/run-composition';
import { createManagedExecutionBoundary } from '@maka/core/sandbox-boundary';
import { createWorkspaceWritePermissionProfile } from '@maka/core/permission-profile';
import type {
  McpBoundTool,
  McpCallResult,
  McpToolBinding,
  McpToolDescriptor,
} from '@maka/core/mcp';
import {
  buildMcpTools,
  buildMcpToolsWithIdentities,
  mcpProxyToolName,
  type McpToolProvider,
} from '../mcp-tools.js';
import { selectCollaborationTools } from '../plan-mode.js';
import { readFileLineWindow } from '../text-line-window.js';
import { formatSyntheticToolErrorText, TOOL_ERROR_RESULT_MAX_CHARS } from '../tool-runtime.js';

test('buildMcpTools projects discovery, abort, and rich model output', async () => {
  const readBinding = binding('internal-read-binding');
  const writeBinding = binding('internal-write-binding');
  let invocation:
    | {
        binding: McpToolBinding;
        args: Record<string, unknown>;
        signal?: AbortSignal;
      }
    | undefined;
  const provider = fakeProvider(
    [
      boundTool(descriptor('read server', 'read.item', true), readBinding),
      boundTool(descriptor('write', 'mutate-item', undefined), writeBinding),
    ],
    async (toolBinding, args, options) => {
      invocation = { binding: toolBinding, args, signal: options?.signal };
      return {
        content: [
          { type: 'text', text: 'ok' },
          { type: 'image', data: 'aW1n', mimeType: 'image/png' },
          { type: 'audio', data: 'YQ==', mimeType: 'audio/wav' },
        ],
        structuredContent: { id: 1 },
      };
    },
  );
  const tools = buildMcpTools(provider);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['mcp__read_server__read_item', 'mcp__write__mutate-item'],
  );
  assert.equal(tools[0]?.categoryHint, 'network_send');
  assert.equal(tools[1]?.categoryHint, 'network_send');
  assert.equal(tools[0]?.description, 'read.item description');
  assert.equal(tools[0]?.displayName, 'read.item');
  const controller = new AbortController();
  const result = await tools[0]?.impl(
    { value: 'x' },
    {
      sessionId: 's',
      turnId: 't',
      cwd: '/tmp',
      toolCallId: 'call',
      abortSignal: controller.signal,
      emitOutput() {},
    },
  );
  assert.deepEqual(invocation, {
    binding: readBinding,
    args: { value: 'x' },
    signal: controller.signal,
  });
  const model = await tools[0]?.toModelOutput?.({ toolCallId: 'call', input: {}, output: result });
  assert.equal(model?.type, 'content');
  if (model?.type !== 'content') throw new Error('expected content tool output');
  assert.deepEqual(model?.value.slice(0, 2), [
    { type: 'text', text: 'ok' },
    {
      type: 'file',
      data: { type: 'data', data: 'aW1n' },
      mediaType: 'image/png',
    },
  ]);
  assert.match(model?.value[2]?.type === 'text' ? model.value[2].text : '', /structuredContent/u);
});

test('buildMcpTools leaves MCP JSON Schema validation to the server', async () => {
  const inputSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      values: {
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: { type: 'number' },
      },
    },
    required: ['values'],
  };
  let invocationArgs: unknown;
  const [tool] = buildMcpTools(
    fakeProvider(
      [
        boundTool(
          {
            ...descriptor('server', 'validated'),
            inputSchema,
          },
          binding('validated-binding'),
        ),
      ],
      async (_binding, args) => {
        invocationArgs = args;
        return { content: [] };
      },
    ),
  );
  const parameters = tool?.parameters as {
    jsonSchema?: unknown;
    validate?: unknown;
  };
  // A valid 2020-12 schema reaches the model as written, less its `$schema`.
  const { $schema: _dialect, ...modelFacing } = inputSchema;
  assert.deepEqual(parameters.jsonSchema, modelFacing);
  assert.equal(parameters.validate, undefined);
  if (!tool) throw new Error('expected MCP tool');
  assert.deepEqual(
    await tool.impl(
      { values: ['head', 42] },
      {
        sessionId: 'session',
        turnId: 'turn',
        cwd: '/workspace',
        toolCallId: 'tool-call',
        abortSignal: new AbortController().signal,
        emitOutput() {},
      },
    ),
    { content: [] },
  );
  assert.deepEqual(invocationArgs, { values: ['head', 42] });
});

test('buildMcpTools carries the Runtime-owned form callback to the provider', async () => {
  const cancellation = new AbortController();
  const provider = fakeProvider(
    [boundTool(descriptor('client', 'deploy'), binding('nested-form-binding'))],
    async (_binding, _args, options) => {
      assert.ok(options.requestInteraction);
      const answer = await options.requestInteraction(
        {
          message: 'Choose a target',
          requester: { name: 'deploy' },
          fields: [
            { kind: 'string', name: 'target', label: 'Target', required: true, maxLength: 256 },
          ],
        },
        { cancellationSignal: cancellation.signal },
      );
      assert.deepEqual(answer, { action: 'accept', values: { target: 'staging' } });
      return { content: [] };
    },
  );
  const [tool] = buildMcpTools(provider);

  await tool?.impl(
    {},
    {
      sessionId: 'session',
      turnId: 'turn',
      cwd: '/workspace',
      toolCallId: 'tool-call',
      abortSignal: new AbortController().signal,
      emitOutput() {},
      requestUserForm: async (form, options) => {
        assert.equal(form.message, 'Choose a target');
        assert.equal(options?.cancellationSignal, cancellation.signal);
        return { action: 'accept', values: { target: 'staging' } };
      },
    },
  );
});

test('prepared MCP execution receives the Runtime-owned form callback after admission', async () => {
  const toolBinding = binding('prepared-form-binding');
  const provider: McpToolProvider = {
    toolSnapshot: () => ({
      revision: 1,
      tools: [boundTool(descriptor('client', 'deploy'), toolBinding)],
    }),
    prepareTool: async () => ({
      execute: async (options) => {
        assert.ok(options?.requestInteraction);
        const answer = await options.requestInteraction({
          message: 'Choose a target',
          requester: { name: 'deploy' },
          fields: [
            { kind: 'string', name: 'target', label: 'Target', required: true, maxLength: 256 },
          ],
        });
        assert.deepEqual(answer, { action: 'accept', values: { target: 'staging' } });
        return { content: [] };
      },
      cancel: () => undefined,
    }),
    callTool: async () => assert.fail('Prepared provider must not use direct callTool'),
  };
  const [tool] = buildMcpTools(provider);
  assert.ok(tool?.prepareExecution);
  const controller = new AbortController();
  const prepared = await tool.prepareExecution(
    {},
    {
      sessionId: 'session',
      turnId: 'turn',
      cwd: '/workspace',
      toolCallId: 'tool-call',
      abortSignal: controller.signal,
    },
  );
  await prepared.execute({
    sessionId: 'session',
    turnId: 'turn',
    cwd: '/workspace',
    toolCallId: 'tool-call',
    abortSignal: controller.signal,
    emitOutput: () => undefined,
    requestUserForm: async () => ({ action: 'accept', values: { target: 'staging' } }),
  });
});

test('Direct-mode MCP calls request managed network expansion before provider dispatch', async () => {
  const sequence: string[] = [];
  // Manual opens the network; the expansion under test needs it closed.
  const boundary = createManagedExecutionBoundary(
    { ...createWorkspaceWritePermissionProfile(), network: { kind: 'restricted' } },
    0,
  );
  const [tool] = buildMcpTools(
    fakeProvider(
      [boundTool(descriptor('server', 'mutate'), binding('managed-network-binding'))],
      async () => {
        sequence.push('provider');
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    ),
  );

  await tool?.impl(
    {},
    {
      sessionId: 'session',
      turnId: 'turn',
      cwd: '/workspace',
      toolCallId: 'direct-call',
      abortSignal: new AbortController().signal,
      emitOutput() {},
      executionBoundary: boundary,
      requestSandboxBoundary: async (expansion, justification) => {
        sequence.push('boundary');
        assert.deepEqual(expansion, { network: { enabled: true } });
        assert.equal(
          justification,
          'Call MCP tool server/mutate. Approving opens the network for this whole session, Bash commands included.',
        );
        return {
          request: {
            sessionId: 'session',
            requestId: 'request-1',
            status: 'approved',
            baseRevision: 0,
            expansion,
            justification,
            createdAt: 1,
          },
          boundary,
          changed: true,
        };
      },
    },
  );

  assert.deepEqual(sequence, ['boundary', 'provider']);
});

test('MCP annotations cannot lower permissions and model output has aggregate bounds', async () => {
  const provider = fakeProvider(
    [boundTool(descriptor('untrusted', 'claims-read-only', true), binding('untrusted-binding'))],
    async () => ({
      content: [
        { type: 'text', text: 'a'.repeat(150_000) },
        { type: 'text', text: 'b'.repeat(150_000) },
        ...Array.from({ length: 6 }, (_, index) => ({
          type: 'image' as const,
          data: `aW1n${index}`,
          mimeType: 'image/png',
        })),
        { type: 'unknown', value: { secretBlob: 'x'.repeat(250_000) } },
      ],
      structuredContent: { oversized: 'y'.repeat(250_000) },
    }),
  );
  const [tool] = buildMcpTools(provider);
  assert.equal(tool?.categoryHint, 'network_send');
  const output = await tool?.impl(
    {},
    {
      sessionId: 's',
      turnId: 't',
      cwd: '/tmp',
      toolCallId: 'call',
      abortSignal: new AbortController().signal,
      emitOutput() {},
    },
  );
  const model = await tool?.toModelOutput?.({ toolCallId: 'call', input: {}, output });
  assert.equal(model?.type, 'content');
  if (model?.type !== 'content') throw new Error('expected content tool output');
  const text =
    model?.value
      .filter((item) => item.type === 'text')
      .map((item) => (item.type === 'text' ? item.text : ''))
      .join('') ?? '';
  const images = model?.value.filter((item) => item.type === 'file') ?? [];
  assert.ok(text.length <= 200_000);
  assert.equal(images.length, 4);
  assert.doesNotMatch(text, /secretBlob/u);
});

test('MCP text clipping never leaves an unpaired surrogate at the boundary', async () => {
  const provider = fakeProvider(
    [boundTool(descriptor('untrusted', 'claims-read-only', true), binding('surrogate-binding'))],
    async () => ({
      // Every code point is astral, so a clip boundary inside any pair would
      // surface as an unpaired surrogate ahead of the truncation marker.
      content: [{ type: 'text', text: '🦊'.repeat(120_000) }],
    }),
  );
  const [tool] = buildMcpTools(provider);
  const output = await tool?.impl(
    {},
    {
      sessionId: 's',
      turnId: 't',
      cwd: '/tmp',
      toolCallId: 'call',
      abortSignal: new AbortController().signal,
      emitOutput() {},
    },
  );
  const model = await tool?.toModelOutput?.({ toolCallId: 'call', input: {}, output });
  assert.equal(model?.type, 'content');
  if (model?.type !== 'content') throw new Error('expected content tool output');
  const text = model.value
    .filter((item) => item.type === 'text')
    .map((item) => (item.type === 'text' ? item.text : ''))
    .join('');
  assert.ok(text.length <= 200_000);
  assert.match(text, /…\[truncated by Copilot\]/u);
  assert.doesNotMatch(
    text,
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
  );
});

test('MCP tools stay network sends and are excluded from Plan mode', () => {
  const tools = buildMcpTools(
    fakeProvider(
      [boundTool(descriptor('untrusted', 'claims-read-only', true), binding('plan-binding'))],
      async () => ({ content: [{ type: 'text', text: 'unused' }] }),
    ),
  );

  assert.equal(tools[0]?.categoryHint, 'network_send');
  assert.deepEqual(
    selectCollaborationTools({ mode: 'plan', tools, hasActiveExecution: false }),
    [],
  );
});

test('a trusted composition can apply the Client Capability permission floor and context', async () => {
  let invocationContext:
    | {
        sessionId: string;
        turnId: string;
        toolCallId: string;
        cwd: string;
      }
    | undefined;
  const [tool] = buildMcpTools(
    fakeProvider(
      [boundTool(descriptor('client', 'inspect', true), binding('client-inspect-binding'))],
      async (_binding, _args, options) => {
        invocationContext = options.context;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    ),
    { categoryHint: 'client_capability', recoveryMode: 'outcome_unknown' },
  );
  assert.equal(tool?.categoryHint, 'client_capability');
  assert.equal(tool?.recoveryMode, 'outcome_unknown');
  await tool?.impl(
    {},
    {
      sessionId: 'session',
      turnId: 'turn',
      cwd: '/workspace',
      toolCallId: 'tool-call',
      abortSignal: new AbortController().signal,
      emitOutput() {},
    },
  );
  assert.deepEqual(invocationContext, {
    sessionId: 'session',
    turnId: 'turn',
    cwd: '/workspace',
    toolCallId: 'tool-call',
  });
});

test('a trusted composition can preserve provider-owned activity semantics', () => {
  const [tool] = buildMcpTools(
    fakeProvider(
      [
        boundTool(
          descriptor('desktop_computer_use', 'Computer'),
          binding('desktop-computer-binding'),
        ),
      ],
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    ),
    { activityKindForDescriptor: () => 'computer' },
  );
  assert.equal(tool?.activityKind, 'computer');
});

test('mcpProxyToolName is stable, provider-safe, and bounded to 64 chars', () => {
  const first = mcpProxyToolName('服 务/'.repeat(20), 'tool.with punctuation '.repeat(20));
  const second = mcpProxyToolName('服 务/'.repeat(20), 'tool.with punctuation '.repeat(20));
  assert.equal(first, second);
  assert.ok(first.length <= 64);
  assert.match(first, /^[A-Za-z0-9_-]+$/u);
  assert.notEqual(
    first,
    mcpProxyToolName('服 务/'.repeat(20), 'tool.with punctuation '.repeat(20) + 'different'),
  );
});

test('buildMcpToolsWithIdentities pairs each proxy tool with its source identity', () => {
  const provider = fakeProvider(
    [
      boundTool(descriptor('read server', 'read.item', true), binding('read-binding')),
      boundTool(descriptor('write', 'mutate-item', undefined), binding('write-binding')),
    ],
    async () => ({ content: [] }),
  );
  const identified = buildMcpToolsWithIdentities(provider);
  assert.deepEqual(
    identified.map(({ tool, serverId, toolName }) => [tool.name, serverId, toolName]),
    [
      ['mcp__read_server__read_item', 'read server', 'read.item'],
      ['mcp__write__mutate-item', 'write', 'mutate-item'],
    ],
  );
  assert.deepEqual(
    buildMcpTools(provider).map((tool) => tool.name),
    identified.map(({ tool }) => tool.name),
  );
});

function descriptor(serverId: string, name: string, readOnlyHint?: boolean): McpToolDescriptor {
  return {
    serverId,
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    annotations: { title: name, readOnlyHint },
  };
}

function binding(value: string): McpToolBinding {
  return value as McpToolBinding;
}

function boundTool(toolDescriptor: McpToolDescriptor, toolBinding: McpToolBinding): McpBoundTool {
  return { descriptor: toolDescriptor, binding: toolBinding };
}

function fakeProvider(tools: McpBoundTool[], call: McpToolProvider['callTool']): McpToolProvider {
  return {
    toolSnapshot: () => ({ revision: 1, tools }),
    callTool: call,
  };
}

test('MCP descriptions are normalized to the Request Composition bound', () => {
  const oversized = 'x'.repeat(REQUEST_COMPOSITION_MAX_TOOL_DESCRIPTION_LENGTH + 1);
  const [tool] = buildMcpTools(
    fakeProvider(
      [boundTool({ ...descriptor('server', 'large'), description: oversized }, binding('large'))],
      async () => ({ content: [{ type: 'text', text: 'unused' }] }),
    ),
  );

  assert.equal(
    tool?.description,
    oversized.slice(0, REQUEST_COMPOSITION_MAX_TOOL_DESCRIPTION_LENGTH),
  );
});

const savedResultRoots: string[] = [];
after(async () => {
  await Promise.all(savedResultRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function toolResultRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'maka-mcp-results-'));
  savedResultRoots.push(root);
  return root;
}

/** The one file saved under `root` for Session `s`. */
async function savedFile(root: string): Promise<{ path: string; text: string }> {
  const names = await readdir(join(root, 's'));
  assert.equal(names.length, 1);
  assert.match(names[0]!, /^[0-9a-f-]{36}\.txt$/u);
  const path = join(root, 's', names[0]!);
  return { path, text: await readFile(path, 'utf8') };
}

async function callBounded(
  result: McpCallResult,
  root: string | undefined,
  options: { prepared?: boolean; origin?: 'provider' | 'code_mode' } = {},
): Promise<{ output: unknown; text: string; parts: string[] }> {
  const provider = fakeProvider(
    [boundTool(descriptor('server', 'big'), binding('big-binding'))],
    async () => result,
  );
  const [tool] = buildMcpTools(
    options.prepared
      ? {
          ...provider,
          prepareTool: async () => ({ execute: async () => result, cancel: () => undefined }),
        }
      : provider,
    root === undefined ? {} : { toolResultRoot: root },
  );
  if (!tool) throw new Error('tool missing');
  const context = {
    sessionId: 's',
    turnId: 't',
    cwd: '/tmp',
    toolCallId: 'call',
    abortSignal: new AbortController().signal,
    emitOutput() {},
    ...(options.origin ? { origin: options.origin } : {}),
  };
  const output = options.prepared
    ? await (await tool.prepareExecution!({}, context)).execute(context)
    : await tool.impl({}, context);
  const model = await tool.toModelOutput?.({ toolCallId: 'call', input: {}, output });
  if (model?.type !== 'content') throw new Error('expected content tool output');
  const parts = model.value.map((part) => part.type);
  const text = model.value.map((part) => (part.type === 'text' ? part.text : '')).join('');
  return { output, text, parts };
}

test('a text-only MCP result past 50,000 characters is saved and named by its path', async () => {
  const root = await toolResultRoot();
  const { output, text } = await callBounded(
    { content: [{ type: 'text', text: 'r'.repeat(50_001) }] },
    root,
  );
  const saved = await savedFile(root);
  // The file is the block under the line that names it.
  assert.equal(saved.text, `--- text ---\n${'r'.repeat(50_001)}`);
  const notice = `Output too long to show (50,014 characters). The full output is saved to ${saved.path}; read it with Read or search it with Grep.`;
  assert.deepEqual(output, { content: [{ type: 'text', text: notice }] });
  assert.equal(text, notice);
});

test('two MCP results with the same call id are saved to two files', async () => {
  const root = await toolResultRoot();
  await callBounded({ content: [{ type: 'text', text: 'a'.repeat(60_000) }] }, root);
  await callBounded({ content: [{ type: 'text', text: 'b'.repeat(60_000) }] }, root);
  const names = await readdir(join(root, 's'));
  assert.equal(names.length, 2);
  const texts = await Promise.all(names.map((name) => readFile(join(root, 's', name), 'utf8')));
  assert.deepEqual(texts.map((text) => text.split('\n')[1]![0]).sort(), ['a', 'b']);
});

test('a call from a Code Mode cell gets its whole result, unsaved', async () => {
  const root = await toolResultRoot();
  const items = Array.from({ length: 6_000 }, (_, index) => ({ id: index, name: `item-${index}` }));
  const result: McpCallResult = {
    content: [{ type: 'text', text: JSON.stringify({ items }) }],
    structuredContent: { items },
  };
  const direct = await callBounded(result, root, { origin: 'code_mode' });
  assert.equal(direct.output, result);
  const prepared = await callBounded(result, root, { origin: 'code_mode', prepared: true });
  assert.equal(prepared.output, result);
  assert.deepEqual(await readdir(root), []);
});

test('a text-only MCP result of 50,000 characters stays inline', async () => {
  const root = await toolResultRoot();
  const result = { content: [{ type: 'text' as const, text: 'r'.repeat(50_000) }] };
  const { output, text } = await callBounded(result, root);
  assert.equal(output, result);
  assert.equal(text, 'r'.repeat(50_000));
  assert.deepEqual(await readdir(root), []);
});

test('a text-only MCP result over 25,000 estimated tokens is saved under 50,000 characters', async () => {
  const root = await toolResultRoot();
  // Three UTF-8 bytes a character: 33,333 is 99,999 bytes (25,000 tokens),
  // 33,334 is 100,002 (25,001 tokens).
  const under = await callBounded({ content: [{ type: 'text', text: '漢'.repeat(33_333) }] }, root);
  assert.equal(under.text, '漢'.repeat(33_333));
  const over = await callBounded({ content: [{ type: 'text', text: '漢'.repeat(33_334) }] }, root);
  assert.match(
    over.text,
    /^Output too long to show \(33,347 characters\)\. The full output is saved to /u,
  );
  assert.equal((await savedFile(root)).text, `--- text ---\n${'漢'.repeat(33_334)}`);
});

test('a long structured MCP result is saved laid out a field to a line, for Read to page', async () => {
  const root = await toolResultRoot();
  const structuredContent = { rows: Array.from({ length: 6_000 }, (_, index) => `row-${index}`) };
  const { text } = await callBounded({ content: [], structuredContent }, root);
  assert.match(text, /^Output too long to show/u);
  assert.equal(
    (await savedFile(root)).text,
    `--- structuredContent ---\n${JSON.stringify(structuredContent, undefined, 2)}`,
  );
});

test('JSON text in a long MCP result is saved laid out, its numbers exactly as written', async () => {
  const root = await toolResultRoot();
  const rows = Array.from(
    { length: 3_000 },
    (_, index) =>
      `{"id":12345678901234567890${index},"name":"row \\"${index}\\"","tags":[],"meta":{}}`,
  );
  const json = `{"rows":[${rows.join(',')}],"total":1.50}`;
  const { text } = await callBounded(
    {
      content: [
        { type: 'text', text: json },
        { type: 'text', text: 'not json {' },
      ],
    },
    root,
  );
  assert.match(text, /^Output too long to show/u);
  const saved = (await savedFile(root)).text;
  assert.ok(
    saved.startsWith(
      '--- text ---\n{\n  "rows": [\n    {\n      "id": 123456789012345678900,\n      "name": "row \\"0\\"",\n      "tags": [],\n      "meta": {}\n    },\n',
    ),
  );
  assert.ok(saved.endsWith('\n  ],\n  "total": 1.50\n}\n--- text ---\nnot json {'));
  assert.deepEqual(
    JSON.parse(saved.slice('--- text ---\n'.length, saved.lastIndexOf('\n--- text ---\n'))),
    JSON.parse(json),
  );
});

test('a saved MCP file keeps every line break, so Read can page it', async () => {
  const root = await toolResultRoot();
  const markdown = 'some markdown line\n'.repeat(8_000);
  const { text } = await callBounded(
    {
      content: [
        { type: 'text', text: 'plain\nlines' },
        { type: 'text', text: JSON.stringify({ markdown, path: 'C:\\new' }) },
        { type: 'resource', uri: 'file:///a.md', mimeType: 'text/markdown', text: markdown },
      ],
      structuredContent: { markdown, crlf: 'one\r\ntwo' },
    },
    root,
  );
  assert.match(
    text,
    /^Output too long to show \([\d,]+ characters\)\. The full output is saved to /u,
  );
  const saved = await savedFile(root);
  const lines = saved.text.split('\n');
  assert.ok(Math.max(...lines.map((line) => line.length)) < 100, 'no line runs on');
  // Each block under the line that names it, in order, then structuredContent.
  assert.deepEqual(
    lines.filter((line) => line.startsWith('--- ')),
    [
      '--- text ---',
      '--- text ---',
      '--- resource file:///a.md (text/markdown) ---',
      '--- structuredContent ---',
    ],
  );
  assert.ok(
    saved.text.startsWith(
      `--- text ---\nplain\nlines\n--- text ---\n{\n  "markdown": "some markdown line\nsome markdown line\n`,
    ),
  );
  // A line break in a JSON string is written as one; every other escape stays,
  // an escaped backslash before an `n` among them.
  assert.ok(saved.text.includes('\n  "path": "C:\\\\new"\n}\n'));
  assert.ok(saved.text.includes(`--- resource file:///a.md (text/markdown) ---\n${markdown}`));
  assert.ok(saved.text.endsWith('\n  "crlf": "one\r\ntwo"\n}'));

  const whole = await readFileLineWindow(saved.path);
  assert.equal(whole.partial, true, 'a first page, not a refusal');
  const page = await readFileLineWindow(saved.path, 8_010, 5);
  assert.equal(page.content.split('\n').length, 5);
  assert.equal(page.totalLines, lines.length);
});

test('a saved MCP file holds every block, past the 100 the model is shown a summary of', async () => {
  const root = await toolResultRoot();
  const content = Array.from({ length: 150 }, (_, index) => ({
    type: 'resource' as const,
    uri: `file:///${index}`,
    text: `resource ${index} ${'x'.repeat(1_000)}`,
  }));
  const { text } = await callBounded({ content }, root);
  assert.match(text, /The full output is saved to /u);
  const saved = (await savedFile(root)).text;
  for (let index = 0; index < 150; index++) {
    assert.ok(
      saved.includes(`--- resource file:///${index} ---\nresource ${index} x`),
      `block ${index}`,
    );
  }
  assert.ok(!saved.includes('omittedContentBlocks'));
});

test('many small MCP blocks are counted whole when deciding to save', async () => {
  const root = await toolResultRoot();
  // 150 blocks of 400 characters: the 100 the model is shown a summary of
  // stay under 50,000 characters, all 150 do not.
  const content = Array.from({ length: 150 }, (_, index) => ({
    type: 'resource' as const,
    uri: `file:///${index}`,
    text: `${index} ${'y'.repeat(400)}`,
  }));
  const { text } = await callBounded({ content }, root);
  assert.match(text, /^Output too long to show/u);
  assert.ok((await savedFile(root)).text.includes('--- resource file:///149 ---'));
});

test('binary data in a saved MCP file is described on one line, not written', async () => {
  const root = await toolResultRoot();
  await callBounded(
    {
      content: [
        { type: 'text', text: 't'.repeat(60_000) },
        {
          type: 'resource',
          uri: 'file:///b.bin',
          mimeType: 'application/octet-stream',
          blob: 'AAAA'.repeat(1_000),
        },
        { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' },
        { type: 'resource_link', uri: 'file:///c.txt', name: 'c' },
        { type: 'unknown', value: { kind: 'other', note: 'a\nb' } },
      ],
    },
    root,
  );
  const saved = (await savedFile(root)).text;
  assert.ok(
    saved.endsWith(
      [
        '--- resource file:///b.bin (application/octet-stream): binary, 4,000 base64 characters, not written ---',
        '--- audio (audio/wav): binary, 4 base64 characters, not written ---',
        '--- resource link file:///c.txt ---',
        '{\n  "uri": "file:///c.txt",\n  "name": "c"\n}',
        '--- block of an unknown type ---',
        '{\n  "kind": "other",\n  "note": "a\nb"\n}',
      ].join('\n'),
    ),
  );
  assert.ok(!saved.includes('AAAA'));
});

test('a part of an MCP result that cannot be written makes the notice say the file is partial', async () => {
  const root = await toolResultRoot();
  const { text } = await callBounded(
    {
      content: [{ type: 'text', text: 'w'.repeat(60_000) }],
      structuredContent: { count: 1n },
    },
    root,
  );
  const saved = await savedFile(root);
  assert.equal(
    text,
    `Output too long to show, and not all of it could be saved: ${saved.path} holds ${saved.text.length.toLocaleString('en-US')} characters of it, and a line in the file marks what was left out. Read it with Read or search it with Grep.`,
  );
  assert.ok(saved.text.endsWith('\n--- structuredContent ---\n[This part could not be written.]'));
});

test('a prepared MCP call is bounded the same way', async () => {
  const root = await toolResultRoot();
  const { text } = await callBounded(
    { content: [{ type: 'text', text: 'p'.repeat(60_000) }] },
    root,
    { prepared: true },
  );
  assert.match(text, /^Output too long to show \(60,013 characters\)/u);
});

test('an MCP result with an image stays inline, its text cut at 25,000 tokens', async () => {
  const root = await toolResultRoot();
  const result: McpCallResult = {
    content: [
      { type: 'text', text: 'i'.repeat(120_000) },
      { type: 'image', data: 'aW1n', mimeType: 'image/png' },
    ],
  };
  const { output, text, parts } = await callBounded(result, root);
  assert.equal(output, result);
  assert.deepEqual(parts, ['text', 'file']);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 100_000);
  assert.match(text, /^i+\n…\[truncated by Copilot\]$/u);
  assert.deepEqual(await readdir(root), []);
});

test('with nowhere to save, a long MCP result is cut at 25,000 tokens', async () => {
  const { text } = await callBounded(
    { content: [{ type: 'text', text: 'n'.repeat(120_000) }] },
    undefined,
  );
  assert.equal(Buffer.byteLength(text, 'utf8'), 100_000);
  assert.match(text, /…\[truncated by Copilot\]$/u);
});

test('an MCP error is never saved; its text reaches the model capped far under the token limit', async () => {
  const root = await toolResultRoot();
  const failure = new Error('z'.repeat(60_000));
  const provider = fakeProvider(
    [boundTool(descriptor('server', 'failing'), binding('failing-binding'))],
    async () => {
      throw failure;
    },
  );
  const [tool] = buildMcpTools(provider, { toolResultRoot: root });
  await assert.rejects(
    Promise.resolve(
      tool?.impl(
        {},
        {
          sessionId: 's',
          turnId: 't',
          cwd: '/tmp',
          toolCallId: 'call',
          abortSignal: new AbortController().signal,
          emitOutput() {},
        },
      ),
    ),
    failure,
  );
  assert.deepEqual(await readdir(root), []);
  assert.equal(formatSyntheticToolErrorText(failure).length, TOOL_ERROR_RESULT_MAX_CHARS);
});
