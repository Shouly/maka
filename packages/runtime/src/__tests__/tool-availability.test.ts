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
import { describe, test } from 'node:test';
import { z } from 'zod';

import {
  TOOL_SEARCH_MAX_SCHEMA_CHARS,
  TOOL_SEARCH_NAME,
  ToolAvailabilityRuntime,
  recoverActivatedToolNames,
  toolAvailabilityHash,
  type ToolSearchResult,
} from '../tool-availability.js';
import { replayToolSearchOutput } from '../ai-sdk-message-projection.js';
import type { ToolResultOutput } from '../model-protocol.js';
import { bindToolActivationIdentity, toolActivationKey } from '../tool-activation-identity.js';
import type { MakaTool, MakaToolContext } from '../tool-runtime.js';

function tool(name: string, description = name): MakaTool {
  return { name, description, parameters: z.object({}), impl: () => ({ ok: true }) };
}

function withCategory(name: string, categoryHint: MakaTool['categoryHint']): MakaTool {
  return {
    name,
    description: name,
    parameters: z.object({}),
    impl: () => ({ ok: true }),
    categoryHint,
  };
}

const invalid: MakaTool = {
  name: 'invalid',
  description: 'invalid',
  parameters: z.object({}),
  impl: () => ({}),
};

const ctx: MakaToolContext = {
  sessionId: 's',
  turnId: 't',
  cwd: '/tmp',
  toolCallId: 'tc',
  abortSignal: new AbortController().signal,
  emitOutput: () => {},
};

test('tool availability hash canonicalizes group members', () => {
  const grouped = toolAvailabilityHash({
    groups: [{ id: 'docs', toolNames: ['docs_read', 'docs_edit', 'docs_read'] }],
  });
  const reordered = toolAvailabilityHash({
    groups: [{ id: 'docs', toolNames: ['docs_edit', 'docs_read'] }],
  });
  assert.equal(grouped, reordered);
});

test('tool availability hash distinguishes full and search-enabled bindings', () => {
  assert.notEqual(toolAvailabilityHash(undefined), toolAvailabilityHash({}));
});

function runtime() {
  return new ToolAvailabilityRuntime(
    [
      tool('Read'),
      tool('Write'),
      tool('BrowserClick', 'Click an element in the browser'),
      tool('docs_edit', 'Edit a document'),
      tool('docs_read', 'Read a document'),
    ],
    {
      groups: [
        { id: 'browser', toolNames: ['BrowserClick'], description: 'Browser automation' },
        { id: 'docs', toolNames: ['docs_edit', 'docs_read'], description: 'Document tools' },
      ],
    },
    invalid,
  );
}

function nativeRuntime(dialect: 'anthropic' | 'openai-responses' = 'anthropic') {
  return new ToolAvailabilityRuntime(
    [
      tool('Read'),
      tool('BrowserClick', 'Click an element in the browser'),
      tool('docs_edit', 'Edit a document'),
    ],
    {
      groups: [
        { id: 'browser', toolNames: ['BrowserClick'] },
        { id: 'docs', toolNames: ['docs_edit'] },
      ],
      nativeDeferral: dialect,
    },
    invalid,
  );
}

function searchTool(plan: ReturnType<ToolAvailabilityRuntime['prepare']>): MakaTool {
  const connector = plan.providerTools.find((candidate) => candidate.name === TOOL_SEARCH_NAME);
  assert.ok(connector);
  return connector;
}

describe('ToolAvailabilityRuntime — search activation', () => {
  test('step 0 exposes direct tools and ToolSearch, but not searchable schemas', () => {
    const plan = runtime().prepare(new Map());
    assert.ok(plan.activeTools.includes('Read'));
    assert.ok(plan.activeTools.includes('Write'));
    assert.ok(plan.activeTools.includes(TOOL_SEARCH_NAME));
    assert.ok(!plan.activeTools.includes('BrowserClick'));
    assert.ok(!plan.activeTools.includes('docs_edit'));
  });

  test('a group cannot defer the fixed direct baseline', () => {
    const plan = new ToolAvailabilityRuntime(
      [tool('Read'), tool('BrowserClick')],
      { groups: [{ id: 'bad-source', toolNames: ['Read', 'BrowserClick'] }] },
      invalid,
    ).prepare(new Map());
    assert.ok(plan.activeTools.includes('Read'));
    assert.ok(!plan.activeTools.includes('BrowserClick'));
    assert.doesNotMatch(searchTool(plan).description, /- Read/);
  });

  test('skill discovery tools stay direct while search is enabled', () => {
    const plan = new ToolAvailabilityRuntime(
      [tool('Skill'), tool('SkillSearch'), tool('custom')],
      {},
      invalid,
    ).prepare(new Map());
    assert.deepEqual(plan.activeTools, ['Skill', 'SkillSearch', TOOL_SEARCH_NAME]);
  });

  test('provider-routed apply_patch inherits direct editing visibility', () => {
    const plan = new ToolAvailabilityRuntime(
      [tool('apply_patch'), tool('custom')],
      {},
      invalid,
    ).prepare(new Map());
    assert.deepEqual(plan.activeTools, ['apply_patch', TOOL_SEARCH_NAME]);
  });

  test('inventory contains group and canonical names without tool descriptions', () => {
    const connector = searchTool(runtime().prepare(new Map()));
    assert.match(connector.description, /browser:\n- BrowserClick/);
    assert.match(connector.description, /docs:\n- docs_edit\n- docs_read/);
    assert.doesNotMatch(connector.description, /Click an element/);
    assert.doesNotMatch(connector.description, /Edit a document/);
  });

  test('search indexes group meaning without exposing it in the initial inventory', async () => {
    const plan = new ToolAvailabilityRuntime(
      [tool('remote_invoke', 'Invoke a provider-defined operation')],
      {
        groups: [
          {
            id: 'calendar_provider',
            label: 'Team calendar',
            description: 'Schedule a calendar meeting and manage events.',
            toolNames: ['remote_invoke'],
          },
        ],
      },
      invalid,
    ).prepare(new Map());
    const connector = searchTool(plan);

    assert.doesNotMatch(connector.description, /Team calendar|Schedule a calendar meeting/);
    assert.deepEqual(await connector.impl({ query: 'schedule calendar meeting' }, ctx), {
      activated: ['remote_invoke'],
    });
  });

  test('a successful search activates bounded matches for the next projection', async () => {
    const active = new Map<string, string>();
    const traces: Record<string, unknown>[] = [];
    const plan = runtime().prepare(active);
    const connector = searchTool(plan);
    const tracedContext: MakaToolContext = {
      ...ctx,
      emitRunTrace: (type, _message, data) => {
        if (type === 'tool_searched') traces.push(data ?? {});
      },
    };

    assert.deepEqual(
      await connector.impl({ query: 'edit document', max_results: 1 }, tracedContext),
      {
        activated: ['docs_edit'],
      },
    );
    assert.ok(active.has('docs_edit'), 'turn-owned activation map changed');
    assert.ok(
      !plan.currentRepairToolNames().includes('docs_edit'),
      'step snapshot stayed immutable',
    );

    const next = plan.projectActiveTools!();
    assert.ok(next.activeTools.includes('docs_edit'));
    assert.ok(!next.activeTools.includes('docs_read'));
    assert.equal(traces[0]?.query, 'edit document');
    assert.deepEqual(traces[0]?.activated, ['docs_edit']);
  });

  test('a same-name replacement does not inherit the retired contribution activation', async () => {
    const first = bindToolActivationIdentity(tool('plugin_weather', 'weather'), {
      kind: 'plugin',
      scopeId: 'profile',
      entryId: 'weather-entry',
      extensionId: 'weather-plugin',
      generation: 1,
      toolName: 'plugin_weather',
    });
    const active = new Map<string, string>();
    const initial = new ToolAvailabilityRuntime(
      [first],
      { groups: [{ id: 'plugins', toolNames: ['plugin_weather'] }] },
      invalid,
    ).prepare(active);
    await searchTool(initial).impl({ query: 'weather' }, ctx);
    assert.equal(active.get('plugin_weather'), toolActivationKey(first));

    const replacement = bindToolActivationIdentity(tool('plugin_weather', 'weather'), {
      kind: 'plugin',
      scopeId: 'profile',
      entryId: 'weather-entry',
      extensionId: 'weather-plugin',
      generation: 2,
      toolName: 'plugin_weather',
    });
    const next = new ToolAvailabilityRuntime(
      [replacement],
      { groups: [{ id: 'plugins', toolNames: ['plugin_weather'] }] },
      invalid,
    ).prepare(active);

    assert.equal(active.has('plugin_weather'), false);
    assert.equal(next.activeTools.includes('plugin_weather'), false);
  });

  test('an equivalent rebuilt Host wrapper keeps its activation', async () => {
    const active = new Map<string, string>();
    const first = tool('NoteRead', 'read the session notes');
    const initial = new ToolAvailabilityRuntime(
      [first],
      { groups: [{ id: 'notes', toolNames: ['NoteRead'] }] },
      invalid,
    ).prepare(active);
    await searchTool(initial).impl({ query: 'read notes' }, ctx);

    const rebuilt = tool('NoteRead', 'read the session notes');
    assert.notEqual(rebuilt, first);
    const next = new ToolAvailabilityRuntime(
      [rebuilt],
      { groups: [{ id: 'notes', toolNames: ['NoteRead'] }] },
      invalid,
    ).prepare(active);

    assert.equal(active.get('NoteRead'), toolActivationKey(rebuilt));
    assert.equal(next.activeTools.includes('NoteRead'), true);
  });

  test('ordinary result is thin and contains no complete schemas', async () => {
    const connector = searchTool(runtime().prepare(new Map()));
    const output = await connector.impl({ query: 'browser click' }, ctx);
    assert.deepEqual(output, { activated: ['BrowserClick'] });
    assert.deepEqual(await connector.toModelOutput?.({ toolCallId: 'tc', input: {}, output }), {
      type: 'json',
      value: { activated: ['BrowserClick'] },
    });
  });

  test('repeated and parallel searches union and deduplicate turn activation', async () => {
    const active = new Map<string, string>();
    const plan = runtime().prepare(active);
    const connector = searchTool(plan);
    await Promise.all([
      connector.impl({ query: 'document read', max_results: 1 }, ctx),
      connector.impl({ query: 'browser click', max_results: 1 }, ctx),
      connector.impl({ query: 'browser click', max_results: 1 }, ctx),
    ]);
    assert.deepEqual([...active.keys()].sort(), ['BrowserClick', 'docs_read']);
  });

  test('already-active matches do not consume a later search limit or schema budget', async () => {
    const active = new Map<string, string>();
    const largeDescription = `Perform a calendar action ${'x'.repeat(40 * 1024)}`;
    const plan = new ToolAvailabilityRuntime(
      [tool('calendar_primary', largeDescription), tool('calendar_secondary', largeDescription)],
      {
        groups: [
          {
            id: 'calendar',
            toolNames: ['calendar_primary', 'calendar_secondary'],
          },
        ],
      },
      invalid,
    ).prepare(active);
    const connector = searchTool(plan);

    const first = (await connector.impl(
      { query: 'calendar action', max_results: 1 },
      ctx,
    )) as ToolSearchResult;
    const second = (await connector.impl(
      { query: 'calendar action', max_results: 2 },
      ctx,
    )) as ToolSearchResult;

    assert.equal(first.activated.length, 1);
    assert.equal(second.activated.length, 1);
    assert.notEqual(second.activated[0], first.activated[0]);
    assert.equal(active.size, 2);
  });

  test('reports and skips an oversized tool without hiding a smaller later match', async () => {
    const active = new Map<string, string>();
    const plan = new ToolAvailabilityRuntime(
      [
        tool('oversized_target', `Oversized target ${'x'.repeat(TOOL_SEARCH_MAX_SCHEMA_CHARS)}`),
        tool('smaller_fallback', 'An oversized target fallback'),
      ],
      {
        groups: [
          {
            id: 'oversized',
            toolNames: ['oversized_target', 'smaller_fallback'],
          },
        ],
      },
      invalid,
    ).prepare(active);

    const connector = searchTool(plan);
    const result = (await connector.impl({ query: 'oversized target' }, ctx)) as ToolSearchResult;

    assert.deepEqual(result.activated, ['smaller_fallback']);
    assert.equal(result.blocked?.name, 'oversized_target');
    assert.equal(result.blocked?.reason, 'schema_too_large');
    assert.ok((result.blocked?.schemaChars ?? 0) > TOOL_SEARCH_MAX_SCHEMA_CHARS);
    assert.equal(active.has('smaller_fallback'), true);
    assert.deepEqual(
      await connector.toModelOutput?.({ toolCallId: 'tc', input: {}, output: result }),
      {
        type: 'json',
        value: { activated: ['smaller_fallback'], blocked: result.blocked },
      },
    );
  });

  test('stops at the schema ceiling instead of silently changing relevance order', async () => {
    const largeDescription = `Budget branch ${'x'.repeat(40 * 1024)}`;
    const active = new Map<string, string>();
    const plan = new ToolAvailabilityRuntime(
      [
        tool('budget_branch_primary', largeDescription),
        tool('budget_branch_secondary', largeDescription),
        tool('lower_ranked_tool', 'A lower ranked budget branch tool'),
      ],
      {
        groups: [
          {
            id: 'budget',
            toolNames: ['budget_branch_primary', 'budget_branch_secondary', 'lower_ranked_tool'],
          },
        ],
      },
      invalid,
    ).prepare(active);

    const result = (await searchTool(plan).impl(
      { query: 'budget branch', max_results: 3 },
      ctx,
    )) as ToolSearchResult;

    assert.equal(result.activated.length, 1);
    assert.equal(result.blocked?.reason, 'schema_budget_exhausted');
    assert.equal(active.size, 1);
    assert.equal(active.has('lower_ranked_tool'), false);
  });

  test('required orchestration tools are visible without changing activation state', () => {
    const active = new Map<string, string>();
    const plan = runtime().prepare(active, new Set(['docs_read']));
    assert.ok(plan.activeTools.includes('docs_read'));
    assert.equal(active.size, 0);
    assert.ok(plan.projectActiveTools!().activeTools.includes('docs_read'));
  });

  test('activation maps isolate overlapping and subsequent turns', async () => {
    const first = new Map<string, string>();
    const firstPlan = runtime().prepare(first);
    await searchTool(firstPlan).impl({ query: 'browser click' }, ctx);
    assert.ok(firstPlan.projectActiveTools!().activeTools.includes('BrowserClick'));

    const secondPlan = runtime().prepare(new Map());
    assert.ok(!secondPlan.activeTools.includes('BrowserClick'));
  });

  test('an ungrouped bound tool is deferred by default', () => {
    const plan = new ToolAvailabilityRuntime(
      [tool('Read'), tool('future_tool')],
      {},
      invalid,
    ).prepare(new Map());
    assert.deepEqual(plan.activeTools, ['Read', TOOL_SEARCH_NAME]);
    assert.match(searchTool(plan).description, /- future_tool/);
    assert.ok(plan.gating?.gatedNames.has('future_tool'));
  });

  test('omitting availability keeps an explicit binding fully visible', () => {
    const plan = new ToolAvailabilityRuntime(
      [tool('Read'), tool('custom')],
      undefined,
      invalid,
    ).prepare(new Map());
    assert.deepEqual(plan.activeTools, ['custom', 'Read']);
    assert.ok(!plan.providerTools.some((candidate) => candidate.name === TOOL_SEARCH_NAME));
    assert.equal(plan.gating, undefined);
  });

  test('buckets ungrouped native tools into capability families by categoryHint', () => {
    const plan = new ToolAvailabilityRuntime(
      [
        withCategory('Agent', 'subagent'),
        withCategory('web_search', 'web_read'),
        withCategory('screen_click', 'computer_use'),
        withCategory('session_tool', 'custom_tool'), // no family mapping -> other
        tool('legacy_tool'), // no categoryHint -> other
      ],
      { groups: [] },
      invalid,
    ).prepare(new Map());

    const bySource = plan.diagnostics([], 0)!.visibleToolNamesBySource!;
    // Distinct permission hints land in distinct browsing families, not one `other`.
    assert.deepEqual(bySource.agents, ['Agent']);
    assert.deepEqual(bySource.web, ['web_search']);
    assert.deepEqual(bySource.computer_use, ['screen_click']);
    // Only hint-less / custom_tool tools fall back to `other`.
    assert.deepEqual(bySource.other, ['legacy_tool', 'session_tool']);
    // A hint present in the exhaustive family map but mapped to `null`
    // (custom_tool) still resolves to `other`, not a family of its own.
    assert.equal(bySource.custom_tool, undefined);

    // Family ids surface in the searchable inventory the model sees.
    const description = searchTool(plan).description;
    assert.match(description, /agents:\n- Agent/);
    assert.match(description, /web:\n- web_search/);
    assert.match(description, /computer_use:\n- screen_click/);
  });

  test('a caller-supplied group keeps precedence over a categoryHint family', () => {
    const plan = new ToolAvailabilityRuntime(
      [withCategory('Agent', 'subagent'), withCategory('ListAgents', 'subagent')],
      { groups: [{ id: 'orchestration', label: 'Orchestration', toolNames: ['Agent'] }] },
      invalid,
    ).prepare(new Map());

    const bySource = plan.diagnostics([], 0)!.visibleToolNamesBySource!;
    // The explicit group claims Agent; only the remaining hinted tool is family-bucketed.
    assert.deepEqual(bySource.orchestration, ['Agent']);
    assert.deepEqual(bySource.agents, ['ListAgents']);
  });
});

describe('ToolSearch — query forms and the renamed limit', () => {
  test('select: activates the named tools exactly, and nothing near them', async () => {
    const active = new Map<string, string>();
    const plan = runtime().prepare(active);

    const result = (await searchTool(plan).impl(
      { query: 'select:docs_edit,BrowserClick' },
      ctx,
    )) as ToolSearchResult;

    assert.deepEqual(result.activated.sort(), ['BrowserClick', 'docs_edit']);
    assert.deepEqual(
      (
        (await searchTool(runtime().prepare(new Map())).impl(
          { query: 'select:docs_EDIT' },
          ctx,
        )) as ToolSearchResult
      ).activated,
      [],
    );
  });

  test('+word requires the term in the tool name', async () => {
    const plan = runtime().prepare(new Map());

    const result = (await searchTool(plan).impl(
      { query: '+docs document' },
      ctx,
    )) as ToolSearchResult;

    assert.deepEqual(result.activated.sort(), ['docs_edit', 'docs_read']);
    assert.deepEqual(
      (
        (await searchTool(runtime().prepare(new Map())).impl(
          { query: '+browser document' },
          ctx,
        )) as ToolSearchResult
      ).activated,
      ['BrowserClick'],
    );
  });

  test('max_results bounds the activation', async () => {
    const plan = runtime().prepare(new Map());
    const parameters = searchTool(plan).parameters as {
      parse(value: unknown): Record<string, unknown>;
    };

    assert.deepEqual(parameters.parse({ query: 'docs', max_results: 2 }), {
      query: 'docs',
      max_results: 2,
    });
    const result = (await searchTool(plan).impl(
      { query: '+docs', max_results: 1 },
      ctx,
    )) as ToolSearchResult;
    assert.equal(result.activated.length, 1);
  });

  test('the inventory names the three query forms', () => {
    const description = searchTool(runtime().prepare(new Map())).description;
    assert.match(description, /Fetches full schema definitions for deferred tools/);
    assert.match(description, /"select:Read,Edit,Grep"/);
    assert.match(description, /"\+slack send"/);
  });
});

describe('ToolAvailabilityRuntime — native deferral', () => {
  test('the wire carries every schema and stops changing when a tool activates', async () => {
    const active = new Map<string, string>();
    const runtime = nativeRuntime();
    const before = runtime.prepare(active);
    // Everything is on the wire from step 0, including what the model may not
    // yet see: that is what keeps the tool block — and the prefix cached behind
    // it — identical across the search.
    assert.ok(before.activeTools.includes('BrowserClick'));
    assert.ok(before.activeTools.includes('docs_edit'));
    assert.deepEqual([...(before.deferredNames ?? [])].sort(), ['BrowserClick', 'docs_edit']);
    // ...while the execute-boundary gate still says no.
    assert.ok(!before.gating?.activeNames().has('BrowserClick'));

    await searchTool(before).impl({ query: 'select:BrowserClick' }, ctx);
    const after = runtime.prepare(active);
    assert.deepEqual(after.activeTools, before.activeTools, 'the request tool block is unmoved');
    assert.ok(after.gating?.activeNames().has('BrowserClick'), 'but the gate has opened');
    assert.ok(!after.gating?.activeNames().has('docs_edit'));
  });

  test('the withholding mode still answers by not sending', async () => {
    const active = new Map<string, string>();
    const plain = runtime();
    const before = plain.prepare(active);
    assert.ok(!before.activeTools.includes('BrowserClick'));
    assert.equal(before.deferredNames, undefined);
    await searchTool(before).impl({ query: 'select:BrowserClick' }, ctx);
    assert.ok(plain.prepare(active).activeTools.includes('BrowserClick'));
  });

  test('Anthropic is handed references, not names', async () => {
    const runtime = nativeRuntime();
    const connector = searchTool(runtime.prepare(new Map()));
    const output = (await connector.impl(
      { query: 'select:BrowserClick' },
      ctx,
    )) as ToolSearchResult;
    const model = connector.toModelOutput?.({ output } as never) as {
      type: string;
      value: readonly Record<string, unknown>[];
    };
    assert.equal(model.type, 'content');
    assert.deepEqual(model.value, [
      {
        type: 'custom',
        providerOptions: { anthropic: { type: 'tool-reference', toolName: 'BrowserClick' } },
      },
    ]);
  });

  test('the inventory promises only the signal this mode can send', () => {
    const withholding = searchTool(runtime().prepare(new Map())).description;
    assert.match(withholding, /A blocked result means/u);
    for (const dialect of ['anthropic', 'openai-responses'] as const) {
      const native = searchTool(nativeRuntime(dialect).prepare(new Map())).description;
      assert.doesNotMatch(native, /A blocked result means/u, dialect);
      assert.match(native, /fewer tools than you/u, dialect);
    }
  });

  test('Anthropic is handed references and nothing else', async () => {
    // The documented result is a list of references; a block beside them is a
    // shape this has never put on a real request, so a budget refusal is
    // reported through the run trace rather than mixed in here.
    const runtime = nativeRuntime();
    const connector = searchTool(runtime.prepare(new Map()));
    const output = {
      activated: ['BrowserClick'],
      blocked: { name: 'docs_edit', reason: 'schema_too_large', schemaChars: 1 },
    };
    const model = connector.toModelOutput?.({ output } as never) as {
      value: readonly Record<string, unknown>[];
    };
    assert.equal(model.value.length, 1);
    assert.equal(model.value[0]?.type, 'custom');
  });

  test('a search that found nothing still says something', async () => {
    const runtime = nativeRuntime();
    const connector = searchTool(runtime.prepare(new Map()));
    const output = (await connector.impl({ query: 'select:NotBound' }, ctx)) as ToolSearchResult;
    const model = connector.toModelOutput?.({ output } as never) as {
      value: readonly Record<string, unknown>[];
    };
    assert.equal(model.value.length, 1);
    assert.equal(model.value[0]?.type, 'text');
  });

  test('OpenAI is handed whole declarations, and declares the connector as its own', async () => {
    const runtime = nativeRuntime('openai-responses');
    const connector = searchTool(runtime.prepare(new Map()));
    // The connector IS OpenAI's search tool on this wire — that is what makes a
    // deferred schema reachable at all.
    assert.equal(connector.providerTool?.kind, 'openai-tool-search');
    assert.ok(connector.providerTool?.description?.includes('BrowserClick'));
    assert.equal(
      (connector.providerTool?.parameters as { type?: string } | undefined)?.type,
      'object',
    );

    const output = (await connector.impl(
      { query: 'select:BrowserClick' },
      ctx,
    )) as ToolSearchResult;
    const model = connector.toModelOutput?.({ output } as never) as {
      type: string;
      value: { tools: readonly Record<string, unknown>[] };
    };
    assert.equal(model.type, 'json');
    assert.equal(model.value.tools.length, 1);
    assert.equal(model.value.tools[0]?.type, 'function');
    assert.equal(model.value.tools[0]?.name, 'BrowserClick');
    assert.ok(model.value.tools[0]?.parameters, 'the definition carries its schema');
  });

  test('OpenAI wraps the search arguments, and the connector sees past it', async () => {
    const runtime = nativeRuntime('openai-responses');
    const connector = searchTool(runtime.prepare(new Map()));
    // What the model actually sends on this wire (observed live): the search
    // arguments nested under `arguments`, beside the call id the SDK already
    // used. Validating the bare shape here failed every search before it ran.
    const parsed = (
      connector.parameters as { safeParse: (value: unknown) => { success: boolean } }
    ).safeParse({
      arguments: { query: 'select:BrowserClick', max_results: 1 },
      call_id: 'call_abc',
    });
    assert.equal(parsed.success, true, 'the envelope must validate');

    const output = (await connector.impl(
      { arguments: { query: 'select:BrowserClick', max_results: 1 }, call_id: 'call_abc' },
      ctx,
    )) as ToolSearchResult;
    assert.deepEqual(output.activated, ['BrowserClick']);
  });

  test('every other wire is still called with the arguments directly', async () => {
    const connector = searchTool(nativeRuntime().prepare(new Map()));
    const output = (await connector.impl(
      { query: 'select:BrowserClick' },
      ctx,
    )) as ToolSearchResult;
    assert.deepEqual(output.activated, ['BrowserClick']);
  });

  test('a ranked query answers with the true ranking, held or not', async () => {
    const active = new Map<string, string>();
    const runtime = nativeRuntime();
    const connector = searchTool(runtime.prepare(active));
    await connector.impl({ query: 'select:BrowserClick' }, ctx);
    // Observed live: skipping the held best match answered a different question
    // than the one asked — a search for the browser's snapshot tool came back
    // with its click and type tools.
    const again = (await connector.impl({ query: 'browser' }, ctx)) as ToolSearchResult;
    assert.ok(again.activated.includes('BrowserClick'));
  });

  test('a tool asked for by name is always answered, loaded or not', async () => {
    // Observed live: a second turn searched a tool the first had already loaded
    // and got `{activated: []}`, which a reader cannot tell from "no such tool"
    // — it read one empty result as a miss and another as a hit.
    for (const dialect of ['anthropic', 'openai-responses'] as const) {
      const active = new Map<string, string>();
      const runtime = nativeRuntime(dialect);
      const connector = searchTool(runtime.prepare(active));
      const call = (query: string) =>
        connector.impl(
          dialect === 'openai-responses' ? { arguments: { query } } : { query },
          ctx,
        ) as Promise<ToolSearchResult> | ToolSearchResult;
      assert.deepEqual((await call('select:BrowserClick')).activated, ['BrowserClick'], dialect);
      assert.deepEqual(
        (await call('select:BrowserClick')).activated,
        ['BrowserClick'],
        `${dialect}: asking twice must answer twice`,
      );
    }
  });

  test('the withholding mode still skips what it has already sent', async () => {
    const active = new Map<string, string>();
    const plain = runtime();
    const connector = searchTool(plain.prepare(active));
    const call = (query: string) => connector.impl({ query }, ctx) as Promise<ToolSearchResult>;
    assert.deepEqual((await call('select:BrowserClick')).activated, ['BrowserClick']);
    // There the schema is already on the wire, and re-admitting it would spend
    // the schema budget on bytes the request is already carrying.
    assert.deepEqual((await call('select:BrowserClick')).activated, []);
    assert.ok(!(await call('browser')).activated.includes('BrowserClick'));
  });

  test('the connector is a plain function tool on every other wire', () => {
    assert.equal(searchTool(nativeRuntime().prepare(new Map())).providerTool, undefined);
    assert.equal(searchTool(runtime().prepare(new Map())).providerTool, undefined);
  });

  test('mode separates the two hashes', () => {
    const groups = [{ id: 'docs', toolNames: ['docs_edit'] }];
    assert.notEqual(
      toolAvailabilityHash({ groups }),
      toolAvailabilityHash({ groups, nativeDeferral: 'anthropic' }),
    );
  });
});

describe('recoverActivatedToolNames', () => {
  test('reads a native turn back out of its references', () => {
    assert.deepEqual(
      recoverActivatedToolNames([
        { role: 'user', content: 'hi' },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: TOOL_SEARCH_NAME,
              output: {
                type: 'content',
                value: [
                  {
                    type: 'custom',
                    providerOptions: { anthropic: { type: 'tool-reference', toolName: 'Grep' } },
                  },
                  { type: 'text', text: 'ignored' },
                ],
              },
            },
          ],
        },
      ]),
      ['Grep'],
    );
  });

  test('reads a withholding turn back out of its json', () => {
    assert.deepEqual(
      recoverActivatedToolNames([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: TOOL_SEARCH_NAME,
              output: { type: 'json', value: { activated: ['Grep', 'Glob'] } },
            },
          ],
        },
      ]),
      ['Grep', 'Glob'],
    );
  });

  test('reads an OpenAI turn back out of its declarations', () => {
    assert.deepEqual(
      recoverActivatedToolNames([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: TOOL_SEARCH_NAME,
              output: {
                type: 'json',
                value: { tools: [{ type: 'function', name: 'Grep', parameters: {} }] },
              },
            },
          ],
        },
      ]),
      ['Grep'],
    );
  });

  test('a result from any other tool says nothing about activation', () => {
    assert.deepEqual(
      recoverActivatedToolNames([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: 'Read',
              output: { type: 'json', value: { activated: ['Grep'] } },
            },
          ],
        },
      ]),
      [],
    );
  });
});

describe('the API contracts the two wires impose', () => {
  test('something is always left non-deferred, as Anthropic requires', () => {
    // "At least one tool must have defer_loading=false" — a 400 otherwise. The
    // connector is never deferrable, so the floor holds even where every bound
    // tool is searchable.
    const everythingSearchable = new ToolAvailabilityRuntime(
      [tool('BrowserClick'), tool('docs_edit')],
      {
        groups: [{ id: 'all', toolNames: ['BrowserClick', 'docs_edit'] }],
        nativeDeferral: 'anthropic',
      },
      invalid,
    );
    const plan = everythingSearchable.prepare(new Map());
    const deferred = plan.deferredNames ?? new Set<string>();
    const nonDeferred = plan.activeTools.filter((name) => !deferred.has(name));
    assert.deepEqual(nonDeferred, [TOOL_SEARCH_NAME]);
    assert.ok(!deferred.has(TOOL_SEARCH_NAME), 'the search tool may never defer itself');
  });

  test('a deferred tool never travels without the search tool beside it', () => {
    // OpenAI answers `Deferred tools require tools.tool_search` with a 400
    // (openai/codex#19486). The pair is declared together or not at all.
    for (const dialect of ['openai-responses', 'anthropic'] as const) {
      const plan = nativeRuntime(dialect).prepare(new Map());
      const deferred = plan.deferredNames ?? new Set<string>();
      if (deferred.size === 0) continue;
      const connector = searchTool(plan);
      assert.ok(plan.activeTools.includes(connector.name), dialect);
      if (dialect === 'openai-responses') {
        assert.equal(connector.providerTool?.kind, 'openai-tool-search', dialect);
      }
    }
  });

  test('a reference only ever names a tool that is on the wire', async () => {
    const runtime = nativeRuntime();
    const plan = runtime.prepare(new Map());
    const connector = searchTool(plan);
    const output = (await connector.impl({ query: 'docs' }, ctx)) as ToolSearchResult;
    // "Tool reference not found in available tools" is a 400, so every name the
    // search hands back has to be one the request also declares.
    for (const name of output.activated) {
      assert.ok(plan.activeTools.includes(name), name);
    }
  });

  test('the diagnostic measures the context, not the wire', async () => {
    const active = new Map<string, string>();
    const runtime = nativeRuntime();
    const before = runtime.prepare(active);
    const idle = before.diagnostics(before.activeTools, 99_999);
    assert.equal(idle?.visibleToolCount, 2, 'Read and the connector');
    assert.ok(
      (idle?.toolSchemaCharReduction ?? 0) > 0,
      'holding two schemas out of context is a saving, whatever rode the wire',
    );
  });
});

describe('seedActivation', () => {
  test('re-admits what the transcript already pointed at, and nothing else', () => {
    const active = new Map<string, string>();
    nativeRuntime().seedActivation(active, ['BrowserClick', 'Read', 'NotBound']);
    // Read is direct — it was never deferred, so it is not an activation; a
    // name this Runtime does not bind is a claim about some other tool set.
    assert.deepEqual([...active.keys()], ['BrowserClick']);
  });

  test('the withholding mode forgets at the turn boundary, by design', () => {
    const active = new Map<string, string>();
    runtime().seedActivation(active, ['BrowserClick']);
    assert.equal(active.size, 0);
  });
});

describe('replayToolSearchOutput', () => {
  const json = (activated: readonly string[]): ToolResultOutput => ({
    type: 'json',
    value: { activated: [...activated] },
  });

  test('replays a past search as the references that hold its tools open', () => {
    assert.deepEqual(
      replayToolSearchOutput(json(['Grep', 'Glob']), (names) => names),
      {
        type: 'content',
        value: [
          {
            type: 'custom',
            providerOptions: { anthropic: { type: 'tool-reference', toolName: 'Grep' } },
          },
          {
            type: 'custom',
            providerOptions: { anthropic: { type: 'tool-reference', toolName: 'Glob' } },
          },
        ],
      },
    );
  });

  test('a tool that is no longer bound is dropped, not replayed into a 400', () => {
    assert.deepEqual(
      replayToolSearchOutput(json(['Grep', 'Gone']), (names) =>
        names.filter((name) => name !== 'Gone'),
      ),
      {
        type: 'content',
        value: [
          {
            type: 'custom',
            providerOptions: { anthropic: { type: 'tool-reference', toolName: 'Grep' } },
          },
        ],
      },
    );
  });

  test('nothing left to point at replays as it was, never as empty content', () => {
    const original = json(['Gone']);
    assert.equal(
      replayToolSearchOutput(original, () => []),
      original,
    );
    assert.equal(
      replayToolSearchOutput(original, () => undefined),
      original,
    );
  });

  test('a wire with no references replays unchanged', () => {
    const original = json(['Grep']);
    assert.equal(replayToolSearchOutput(original, undefined), original);
  });

  test('a result that is not a search payload is left alone', () => {
    const text: ToolResultOutput = { type: 'text', value: 'hello' };
    assert.equal(
      replayToolSearchOutput(text, (names) => names),
      text,
    );
  });
});
