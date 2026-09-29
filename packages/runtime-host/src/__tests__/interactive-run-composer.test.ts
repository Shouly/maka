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
import { test } from 'node:test';
import { createDefaultRuntimePolicy } from '@maka/core/runtime-policy';
import type { SessionTaskToolStore } from '@maka/runtime/session-task-tools';
import type { MakaTool } from '@maka/runtime/tool-runtime';
import { createInteractiveRunComposer } from '../server/interactive-run-composer.js';
import type { HostMemoryCoordinator } from '../server/memory-coordinator.js';
import type { HostSkillCatalogCoordinator } from '../server/skill-catalog-coordinator.js';

test('the interactive tool surface does not expose the retired ExploreAgent tool', () => {
  const composer = createFixtureComposer();

  assert.equal(
    composer.tools.some(({ name }) => name === 'ExploreAgent'),
    false,
  );
});

test('Deep Research keeps standard inspection tools and its durable workspace tools', () => {
  const tool = (name: string): MakaTool => ({
    name,
    description: name,
    parameters: {},
    impl: async () => name,
  });
  const composer = createFixtureComposer({
    hostTools: [tool('WebSearch')],
    deepResearch: { tools: [tool('DeepResearchStatus')] },
  });
  const names = new Set(composer.tools.map(({ name }) => name));

  for (const name of ['Read', 'Glob', 'Grep', 'WebSearch', 'DeepResearchStatus']) {
    assert.equal(names.has(name), true, `expected Deep Research tool ${name}`);
  }
  for (const name of ['Write', 'Edit', 'Bash', 'ExploreAgent']) {
    assert.equal(names.has(name), false, `unexpected Deep Research tool ${name}`);
  }
});

test('the composer resolves scoped Tool additions without rebuilding the backend', () => {
  let additions: readonly MakaTool[] = [];
  const dynamic = tool('dynamic_tool');
  const composer = createFixtureComposer({ resolveAdditionalTools: () => additions });

  assert.equal(
    composer.tools.some(({ name }) => name === dynamic.name),
    false,
  );
  additions = [dynamic];
  assert.equal(
    composer.resolveTools?.().some(({ name }) => name === dynamic.name),
    true,
  );
});

test('the composer keeps Host bindings stable while resampling scoped Tool additions', () => {
  let additions: readonly MakaTool[] = [];
  const composer = createFixtureComposer({ resolveAdditionalTools: () => additions });
  const initialRead = composer.tools.find(({ name }) => name === 'Read');
  assert.ok(initialRead);

  additions = [tool('dynamic_tool')];
  const next = composer.resolveTools?.() ?? [];
  assert.equal(
    next.find(({ name }) => name === 'Read'),
    initialRead,
  );
  assert.equal(
    next.some(({ name }) => name === 'dynamic_tool'),
    true,
  );
});

test('scoped Tool resolution receives the complete stable Host binding', () => {
  let observedHostTools: readonly MakaTool[] = [];
  const composer = createFixtureComposer({
    hostTools: [tool('host_extension')],
    resolveAdditionalTools: (hostTools) => {
      observedHostTools = hostTools;
      return [tool('plugin_extension')];
    },
  });

  assert.equal(
    observedHostTools.some(({ name }) => name === 'Read'),
    true,
  );
  assert.equal(
    observedHostTools.some(({ name }) => name === 'host_extension'),
    true,
  );
  assert.equal(
    composer.tools.some(({ name }) => name === 'plugin_extension'),
    true,
  );
});

test('an explicit tool profile remains an exact ceiling over scoped Tool additions', () => {
  const composer = createFixtureComposer({
    toolProfile: 'headless-coding-v1',
    resolveAdditionalTools: () => [tool('Read'), tool('plugin_only')],
  });

  assert.equal(
    composer.resolveTools?.().some(({ name }) => name === 'plugin_only'),
    false,
  );
  assert.equal(composer.resolveTools?.().filter(({ name }) => name === 'Read').length, 1);
});

test('the composer caches the Host base but reassembles scoped Plugin prompts each step', async () => {
  let pluginText = 'FIRST_PLUGIN_PROMPT';
  let assemblies = 0;
  const composer = createFixtureComposer({
    resolveAdditionalSystemPrompt: async (_context, baseText) => {
      assemblies += 1;
      return {
        text: `${baseText}\n\n${pluginText}`,
        sourceRevisions: [{ id: 'plugin.system-prompt', revision: `revision-${assemblies}` }],
      };
    },
  });
  const context = { sessionId: 'session', turnId: 'turn', cwd: '/workspace' };

  const first = await composer.resolveSystemPrompt(context);
  pluginText = 'SECOND_PLUGIN_PROMPT';
  const second = await composer.resolveSystemPrompt(context);

  assert.match(first.text ?? '', /FIRST_PLUGIN_PROMPT/u);
  assert.match(second.text ?? '', /SECOND_PLUGIN_PROMPT/u);
  assert.equal(assemblies, 2);
  assert.deepEqual(
    second.sourceRevisions.find(({ id }) => id === 'plugin.system-prompt'),
    { id: 'plugin.system-prompt', revision: 'revision-2' },
  );
});

test('the composer preserves scoped dynamic contexts for each model step', async () => {
  const contexts = [{ name: 'plugin:context', text: 'EPHEMERAL_CONTEXT' }];
  const composer = createFixtureComposer({
    resolveAdditionalSystemPrompt: async (_context, baseText) => ({
      text: baseText,
      contexts,
      sourceRevisions: [],
    }),
  });

  const prompt = await composer.resolveSystemPrompt({
    sessionId: 'session',
    turnId: 'turn',
    cwd: '/workspace',
  });

  // The plugin's contexts follow the composer's own.
  assert.deepEqual(
    prompt.contexts?.map((context) => context.name),
    ['environment', 'plugin:context'],
  );
  assert.deepEqual(prompt.contexts?.at(-1), contexts[0]);
});

test('scoped Plugin Skill contributions join the canonical model inventory', async () => {
  const composer = createFixtureComposer({
    skills: {
      readCanonicalModelInventory: async ({ projectRoot }: { projectRoot: string }) => ({
        revision: 'base-revision',
        projectRoot,
        inventory: [],
        diagnostics: [],
        discoveryDiagnostics: [],
      }),
    } as unknown as HostSkillCatalogCoordinator,
    pluginSkills: {
      snapshot: (sessionId: string) => ({
        revision: 4,
        skills: [
          {
            name: 'plugin-probe',
            description: `Scoped skill for ${sessionId}`,
            instructions: 'PLUGIN_SKILL_INSTRUCTIONS',
          },
        ],
      }),
    } as never,
  });

  const prompt = await composer.resolveSystemPrompt({
    sessionId: 'session-skill',
    turnId: 'turn-skill',
    cwd: '/workspace',
  });
  // The skills listing follows the turn's user text as a context, not in the
  // cached prompt.
  const skillsContext = prompt.contexts?.find((context) => context.name === 'skills')?.text ?? '';
  assert.match(skillsContext, /plugin-probe/u);
  assert.match(skillsContext, /Scoped skill for session-skill/u);
  assert.doesNotMatch(prompt.text ?? '', /plugin-probe/u);
});

test('the environment, the agent types, then the skills follow the user text; the prompt is dated to the session start', async () => {
  const composer = createFixtureComposer({
    knowledgeCutoff: '2026-06',
    model: { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' },
    sessionStartedAt: Date.UTC(2026, 8, 28, 12),
    resolveAgentTypes: async () => 'AGENT_TYPES',
    memory: {
      readPromptProjection: async () => ({ revision: 'memory-1', body: 'MEMORY_BODY' }),
    } as unknown as HostMemoryCoordinator,
    skills: {
      readCanonicalModelInventory: async ({ projectRoot }: { projectRoot: string }) => ({
        revision: 'base-revision',
        projectRoot,
        inventory: [],
        diagnostics: [],
        discoveryDiagnostics: [],
      }),
    } as unknown as HostSkillCatalogCoordinator,
    pluginSkills: {
      snapshot: () => ({
        revision: 1,
        skills: [{ name: 'probe', description: 'A probe', instructions: 'PROBE' }],
      }),
    } as never,
  });

  const prompt = await composer.resolveSystemPrompt({
    sessionId: 'session',
    turnId: 'turn',
    cwd: '/workspace',
  });
  assert.deepEqual(
    prompt.contexts?.map((context) => [context.name, context.position]),
    [
      ['user_memory_snapshot', undefined],
      ['environment', 'after'],
      ['agent_types', 'after'],
      ['skills', 'after'],
    ],
  );
  assert.match(
    prompt.text ?? '',
    /a highly informed individual in June 2026 would if talking to someone from Monday, September 28, 2026,/u,
  );
  // The environment is read in the conversation, not in the cached prompt.
  const environment = prompt.contexts?.find((context) => context.name === 'environment')?.text;
  assert.match(
    environment ?? '',
    /^# Environment\nYou have been invoked in the following environment:\n - Primary working directory: \/workspace\n/u,
  );
  assert.match(
    environment ?? '',
    /\n\nYou are powered by the model named Claude Opus 5\.5\. The exact model ID is claude-opus-5-5\. Assistant knowledge cutoff is June 2026\.$/u,
  );
  assert.doesNotMatch(prompt.text ?? '', /Primary working directory|# Environment/u);
  // The prompt names the day the session began, so its first turn needs no date block.
  assert.equal(prompt.dated, true);
});

test("a child agent's prompt is its role card over the shared base, and its listings follow its brief", async () => {
  const composer = createFixtureComposer({
    childInstruction: 'Review the diff.',
    childAgentType: 'Explore',
    sessionStartedAt: Date.UTC(2026, 8, 28, 12),
    userContext: { name: 'Ada', email: 'ada@example.com', preferences: 'Be terse.' },
  });
  const prompt = await composer.resolveSystemPrompt({
    sessionId: 'child',
    turnId: 'turn',
    cwd: '/workspace',
  });
  assert.match(
    prompt.text ?? '',
    /^Review the diff\.\n\nMessages from the agent that launched you/u,
  );
  assert.doesNotMatch(prompt.text ?? '', /# Environment/u);
  assert.deepEqual(
    prompt.contexts?.map((context) => [context.name, context.position]),
    [
      ['subagent_handback', 'after'],
      ['environment', 'after'],
      ['user_info', 'after'],
    ],
  );
  // No preferences: they shape a reply to the user, not a report.
  assert.equal(
    prompt.contexts?.some((context) => context.name === 'user_preferences'),
    false,
  );
  // Nothing in its prompt dates the session, so every turn — the first too — says the date.
  assert.equal(prompt.dated, undefined);
  assert.equal(prompt.childAgent, true);

  // Its tools are a main session's, less what its type goes without, plus the hand-back.
  const names = composer.tools.map(({ name }) => name);
  assert.ok(names.includes('SubagentHandback'));
  for (const excluded of [
    'Agent',
    'SendMessage',
    'ListAgents',
    'AskUserQuestion',
    'Write',
    'Edit',
  ]) {
    assert.equal(names.includes(excluded), false, excluded);
  }
  assert.ok(names.includes('Read'));
  assert.equal(composer.toolAvailability !== undefined, true);
});

function tool(name: string): MakaTool {
  return {
    name,
    description: name,
    parameters: {},
    impl: async () => name,
  };
}
test('WorkHub v2 binds control, tasks, attachment reading and user questions while legacy WorkHub stays tool-free', () => {
  const control = tool('mcp__desktop_workhub__control');
  const tasks = tool('mcp__desktop_workhub__tasks');
  const clientCapabilities = {
    tools: [control, tasks, tool('Bash'), tool('mcp__desktop_browser__navigate')],
    groups: [],
  };
  assert.deepEqual(
    createFixtureComposer({
      toolProfile: 'workhub-coordination-v2',
      clientCapabilities,
      resolveAdditionalTools: () => [tool('plugin_only'), tool('Read')],
    }).tools.map(({ name }) => name),
    [control.name, tasks.name, 'Read', 'AskUserQuestion'],
  );
  assert.deepEqual(
    createFixtureComposer({
      toolProfile: 'workhub-coordination-v1',
      clientCapabilities,
    }).tools,
    [],
  );
  assert.throws(
    () =>
      createFixtureComposer({
        toolProfile: 'workhub-coordination-v2',
        clientCapabilities: { tools: [control], groups: [] },
      }),
    /Hosted tool profile is unavailable: mcp__desktop_workhub__tasks/,
  );
  assert.throws(
    () =>
      createFixtureComposer({
        toolProfile: 'workhub-coordination-v2',
        boundTools: [],
        clientCapabilities,
      }),
    /Hosted tool profile is unavailable/,
  );
});

function createFixtureComposer(
  overrides: Partial<Parameters<typeof createInteractiveRunComposer>[0]> = {},
) {
  return createInteractiveRunComposer({
    runtimePolicy: { revision: 0, policy: createDefaultRuntimePolicy() },
    skills: {
      readCanonicalModelInventory: async () => ({ inventory: [] }),
    } as unknown as HostSkillCatalogCoordinator,
    memory: {
      readPromptProjection: async () => ({ revision: null }),
    } as unknown as HostMemoryCoordinator,
    sessionTask: {} as SessionTaskToolStore,
    builtinTools: {},
    ...overrides,
  });
}
