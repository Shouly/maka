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

// Phase 5b state: the decisions Models, Subagents, Memory and the module pages
// make before anything is drawn.
//
// Everything here is a priority order or a translation between a form and a
// wire shape — the two kinds of logic a screenshot cannot check and a render
// test would only check for one input. The pages themselves are exercised by
// the Electron smoke against the real preload.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_PROVIDER_TYPES,
  PROVIDER_REGISTRY,
  type LlmConnection,
} from '@maka/core/llm-connections';
import { UI_LOCALES } from '@maka/core/ui-locale';
import type { SubagentPreset } from '@maka/core/subagent-settings';
import { PROVIDER_DISPLAY_COPY, providerDisplay } from '../../lib/ported/provider-display-copy.js';
import {
  addProviderRequiresBaseUrl,
  addProviderRoute,
  initialOnboardingModelIds,
  orderedOnboardingModelIds,
  validateAddProviderDraft,
  type AddProviderDraft,
} from '../../lib/ported/provider-add-submission.js';
import { connectionChipStatus } from '../../lib/ported/provider-connection-status.js';
import { oauthFailureMessage } from '../../lib/ported/provider-oauth-message.js';
import {
  isSelectableSubagentConnection,
  nextSubagentDraftForName,
  subagentPresetAvailability,
} from '../../lib/ported/subagent-preset-presentation.js';
import { localMemoryPromptBlockedReason } from '../../lib/ported/memory-settings-presentation.js';
import {
  createEmptyMcpDraft,
  mcpConfigFromDraft,
  mcpDraftFromConfig,
  mcpDraftHasErrors,
  validateMcpServerDraft,
} from '../../lib/ported/mcp-server-draft.js';
import { formatCommandLine, parseCommandLine } from '../../lib/ported/mcp-server-command-line.js';
import {
  createScheduledTaskInputFromFields,
  scheduledTaskScheduleFromFields,
  type ScheduledTaskFormFields,
} from '../../lib/ported/scheduled-task-form-payload.js';
import { modelsViewParent } from '../../components/settings/models/models-view.js';
import { createMcpStore } from '../mcp-store.js';
import { createScheduledTasksStore } from '../scheduled-tasks-store.js';

// ── the company gateway ────────────────────────────────────────────────────
//
// The one entry this fork adds to `packages/core`. Each assertion below is a
// property some surface depends on, so a well-meant tidy of the registry entry
// fails here rather than in a screenshot nobody re-takes.

test('the RELX Gateway is registered, offerable, and heads the catalog', () => {
  const gateway = PROVIDER_REGISTRY['relx-gateway'];
  assert.equal(gateway.label, 'RELX Gateway');
  assert.equal(gateway.category, 'custom');
  assert.equal(gateway.catalogGroup, 'recommended');
  assert.equal(gateway.authKind, 'api_key');
  assert.equal(gateway.runtimeAdapter.kind, 'openai-compatible');
  // No shipped endpoint and no template: the setup form has to ask, which is
  // what `addProviderRequiresBaseUrl` reads.
  assert.equal(gateway.baseUrl, '');
  assert.equal(gateway.baseUrlTemplate, undefined);
  // Discovery over the endpoint the user supplies, not a fallback list.
  assert.equal(gateway.modelDiscovery.kind, 'protocol');
  assert.equal(CATALOG_PROVIDER_TYPES[0], 'relx-gateway');
});

test('the gateway has display copy in every locale, and no model generation in it', () => {
  for (const locale of UI_LOCALES) {
    const copy = providerDisplay('relx-gateway', locale);
    assert.equal(copy.name, 'RELX Gateway');
    assert.ok(copy.description.length > 0);
    // The catalog descriptions are deliberately version-agnostic; a model name
    // here goes stale while the provider does not.
    assert.equal(/gpt-|claude-|gemini-/iu.test(copy.description), false);
  }
  // The exhaustive `satisfies Record<ProviderType, …>` is what enforces this at
  // compile time; assert it at runtime too, because a `Partial` would compile.
  for (const providerType of Object.keys(PROVIDER_REGISTRY)) {
    assert.ok(
      Object.hasOwn(PROVIDER_DISPLAY_COPY, providerType),
      `${providerType} has no display copy`,
    );
  }
});

// ── adding a connection ────────────────────────────────────────────────────

const gatewayDraft = (patch: Partial<AddProviderDraft> = {}): AddProviderDraft => ({
  providerType: 'relx-gateway',
  slug: 'relx-gateway',
  existingSlugs: [],
  apiKey: 'gw-key',
  cloudflareAccountId: '',
  baseUrl: 'https://gateway.example.com/v1',
  ...patch,
});

test('the gateway setup form blocks on a missing endpoint, by name', () => {
  assert.equal(addProviderRequiresBaseUrl('relx-gateway'), true);
  assert.deepEqual(validateAddProviderDraft(gatewayDraft({ baseUrl: '   ' })), {
    field: 'baseUrl',
    reason: 'required',
  });
  assert.equal(validateAddProviderDraft(gatewayDraft()), null);
});

test('the field gate reports one issue at a time, in fixing order', () => {
  // Identity, then endpoint, then credential: the user fixes one thing per
  // submit rather than being handed a wall of red, and the endpoint comes
  // first of the two because it is the field they are least likely to know
  // they owe. A key is obviously required; an address an operator hands out
  // is not.
  assert.deepEqual(
    validateAddProviderDraft(gatewayDraft({ slug: 'Not A Slug', apiKey: '', baseUrl: '' })),
    { field: 'slug', reason: 'invalid', detail: 'format' },
  );
  assert.deepEqual(validateAddProviderDraft(gatewayDraft({ existingSlugs: ['relx-gateway'] })), {
    field: 'slug',
    reason: 'duplicate',
  });
  assert.deepEqual(validateAddProviderDraft(gatewayDraft({ apiKey: '', baseUrl: '' })), {
    field: 'baseUrl',
    reason: 'required',
  });
  assert.deepEqual(validateAddProviderDraft(gatewayDraft({ apiKey: '' })), {
    field: 'apiKey',
    reason: 'required',
  });
});

test('a keyed provider is verified before it is written', () => {
  // The Host onboarding pair probes the endpoint with the credential before
  // anything is persisted; the legacy writer creates first and discovers after.
  assert.equal(addProviderRoute('relx-gateway'), 'host');
  assert.equal(addProviderRoute('openai'), 'host');
  // Cloudflare composes its endpoint from an account id rather than taking one.
  assert.equal(addProviderRoute('cloudflare-workers-ai'), 'legacy');
  // A keyless local runtime has no credential slot for the Host to check.
  assert.equal(addProviderRoute('lm-studio'), 'legacy');
});

test('the chosen default model is the head of the enabled list the Host stores', () => {
  const models = [{ id: 'b-model' }, { id: 'a-model' }, { id: 'c-model' }];
  assert.deepEqual(initialOnboardingModelIds(models, 'c-model'), ['c-model']);
  // No recommendation to honour: the first in display order, not wire order.
  assert.deepEqual(initialOnboardingModelIds(models, 'absent'), ['a-model']);
  assert.deepEqual(
    orderedOnboardingModelIds({
      models,
      selectedIds: ['a-model', 'b-model', 'c-model'],
      defaultId: 'c-model',
    }),
    ['c-model', 'b-model', 'a-model'],
  );
  // A default the user then deselected must not be re-asserted by the ordering.
  assert.deepEqual(
    orderedOnboardingModelIds({ models, selectedIds: ['a-model'], defaultId: 'c-model' }),
    ['a-model'],
  );
});

// ── the connections list ───────────────────────────────────────────────────

const connection = (patch: Partial<LlmConnection> = {}): LlmConnection => ({
  slug: 'gateway',
  name: 'Gateway',
  providerType: 'relx-gateway',
  defaultModel: 'a-model',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

test('a connection row badges only what the user has to act on', () => {
  // Working is the quiet case: `verified` proves the credential validated, not
  // that a turn will run, so it earns no badge.
  assert.equal(connectionChipStatus(connection({ lastTestStatus: 'verified' }), 'en'), null);
  assert.equal(connectionChipStatus(connection(), 'en'), null);
  // A lapsed OAuth login arrives as disabled + needs_reauth; "sign in again"
  // must win over "you turned this off".
  assert.equal(
    connectionChipStatus(connection({ enabled: false, lastTestStatus: 'needs_reauth' }), 'en')
      ?.tone,
    'attention',
  );
  // Disabled AND failed keeps both facts, or the state has no explanation.
  assert.equal(
    connectionChipStatus(connection({ enabled: false, lastTestStatus: 'error' }), 'en')?.tone,
    'error',
  );
  assert.equal(connectionChipStatus(connection({ enabled: false }), 'en')?.tone, 'neutral');
  // A retired provider can never work again, whatever else is true of the row.
  assert.equal(
    connectionChipStatus(
      { providerType: 'claude-subscription', enabled: true, lastTestStatus: 'verified' },
      'en',
    )?.tone,
    'error',
  );
});

test("an OAuth kill-switch reads as Maka's, not as the provider refusing", () => {
  const disabled = oauthFailureMessage(
    { reason: 'experimental_disabled', message: 'nope' },
    'fallback',
    'en',
  );
  assert.notEqual(disabled, 'fallback');
  assert.notEqual(disabled, 'nope');
  // Nothing recognised and nothing to say: the caller's own sentence, because
  // only the caller knows which step failed.
  assert.equal(
    oauthFailureMessage({ reason: 'unknown', message: '  ' }, 'fallback', 'en'),
    'fallback',
  );
});

// ── subagents ──────────────────────────────────────────────────────────────

const preset = (patch: Partial<SubagentPreset> = {}): SubagentPreset => ({
  id: 'fast-reader',
  name: 'Fast reader',
  description: '',
  profile: 'local_read',
  connectionSlug: 'gateway',
  model: 'a-model',
  enabled: true,
  ...patch,
});

test('a subagent route reports the first fact that makes it unusable', () => {
  const usable = [connection({ enabledModelIds: ['a-model'] })];
  assert.equal(subagentPresetAvailability(preset(), usable).kind, 'available');
  // Switched off by the user is a settled choice, not an alert.
  assert.equal(subagentPresetAvailability(preset({ enabled: false }), usable).kind, 'disabled');
  assert.equal(subagentPresetAvailability(preset(), []).kind, 'missing_connection');
  // Retired outranks disabled: a retained retired connection stays enabled and
  // there is no switch that brings it back.
  assert.equal(
    subagentPresetAvailability(preset(), [
      connection({ providerType: 'claude-subscription', enabled: false }),
    ]).kind,
    'provider_retired',
  );
  assert.equal(
    subagentPresetAvailability(preset(), [
      connection({ enabled: false, enabledModelIds: ['a-model'] }),
    ]).kind,
    'connection_disabled',
  );
  // `connectionEnabledModelIds` always admits the connection's own default, so
  // a preset is only model-disabled when the id is in neither place.
  assert.equal(
    subagentPresetAvailability(preset(), [
      connection({ defaultModel: 'other', enabledModelIds: ['other'] }),
    ]).kind,
    'model_disabled',
  );
});

test('the editor offers only connections a run could actually use', () => {
  assert.equal(isSelectableSubagentConnection(connection()), true);
  assert.equal(isSelectableSubagentConnection(connection({ enabled: false })), false);
  assert.equal(
    isSelectableSubagentConnection(connection({ providerType: 'claude-subscription' })),
    false,
  );
});

test('the preset id follows the name until the user takes it over', () => {
  const derived = nextSubagentDraftForName(
    { name: '', id: '' },
    'Fast reader',
    false,
    new Set<string>(),
  );
  assert.equal(derived.name, 'Fast reader');
  assert.equal(derived.id, 'fast-reader');
  // A name that collides with a stored preset derives the next free id rather
  // than one the store would refuse.
  assert.equal(
    nextSubagentDraftForName({ name: '', id: '' }, 'Fast reader', false, new Set(['fast-reader']))
      .id,
    'fast-reader-2',
  );
  const taken = nextSubagentDraftForName(
    { name: 'Fast reader', id: 'my-own-id' },
    'Slow reader',
    true,
    new Set<string>(),
  );
  assert.equal(taken.id, 'my-own-id');
});

// ── memory ─────────────────────────────────────────────────────────────────

test('memory names the first reason the model will not be given the file', () => {
  const state = { enabled: true, status: 'ok' as const, agentReadEnabled: true };
  assert.equal(localMemoryPromptBlockedReason(state), null);
  assert.equal(localMemoryPromptBlockedReason({ ...state, enabled: false }), 'disabled');
  // The master switch outranks everything, including a file that is fine.
  assert.equal(
    localMemoryPromptBlockedReason({ ...state, enabled: false, status: 'incognito_blocked' }),
    'disabled',
  );
  assert.equal(
    localMemoryPromptBlockedReason({ ...state, status: 'incognito_blocked' }),
    'incognito',
  );
  assert.equal(localMemoryPromptBlockedReason({ ...state, status: 'safe_mode' }), 'safeMode');
  assert.equal(localMemoryPromptBlockedReason({ ...state, agentReadEnabled: false }), 'agentRead');
});

// ── MCP ────────────────────────────────────────────────────────────────────

test('a quoted command line survives the round trip through the draft', () => {
  const parsed = parseCommandLine('npx -y "my server" --root /a b');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.command, 'npx');
  assert.deepEqual(parsed.ok && parsed.args, ['-y', 'my server', '--root', '/a', 'b']);
  assert.equal(formatCommandLine('npx', ['-y', 'my server']), 'npx -y "my server"');
  // An unterminated quote is a named error, not a silently truncated argument.
  assert.equal(parseCommandLine('npx "unterminated').ok, false);
});

test('the add-server dialog names the field and the line that is wrong', () => {
  const empty = validateMcpServerDraft(createEmptyMcpDraft());
  assert.equal(empty.id?.issue, 'required');
  assert.equal(empty.commandLine?.issue, 'required');
  const taken = validateMcpServerDraft(
    { ...createEmptyMcpDraft(), id: 'files', commandLine: 'npx server' },
    ['files'],
  );
  assert.equal(taken.id?.issue, 'duplicate-id');
  const badEnv = validateMcpServerDraft({
    ...createEmptyMcpDraft(),
    id: 'files',
    commandLine: 'npx server',
    env: 'OK=1\nnot-a-pair\n',
  });
  assert.deepEqual(badEnv.env, { issue: 'invalid-map', line: 2 });
  const remote = validateMcpServerDraft({
    ...createEmptyMcpDraft(),
    id: 'remote',
    kind: 'remote',
    url: 'ftp://example.com',
  });
  assert.equal(remote.url?.issue, 'invalid-url');
});

test('a stored server reopens as the draft that produced it', () => {
  const draft = {
    ...createEmptyMcpDraft(),
    id: 'files',
    commandLine: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
    env: 'TOKEN=abc',
  };
  assert.equal(mcpDraftHasErrors(validateMcpServerDraft(draft)), false);
  const config = mcpConfigFromDraft(draft);
  assert.ok(config);
  const reopened = mcpDraftFromConfig('files', config);
  assert.equal(reopened.commandLine, draft.commandLine);
  assert.equal(reopened.env, draft.env);
  assert.equal(reopened.kind, 'stdio');
});

test('the MCP store reads config and statuses as one value', async () => {
  let statuses = [{ id: 'files' }];
  let push = () => {};
  const store = createMcpStore({
    getMcpConfig: async () => ({ version: 1, mcpServers: {} }),
    listMcpStatuses: async () => statuses,
    subscribeMcpChanges: (handler: () => void) => {
      push = handler;
      return () => {};
    },
  } as never);
  const stop = store.observe(undefined);
  await new Promise((settle) => setTimeout(settle, 0));
  assert.deepEqual(store.getState().data?.statuses, [{ id: 'files' }]);
  statuses = [{ id: 'files' }, { id: 'search' }];
  push();
  await new Promise((settle) => setTimeout(settle, 0));
  // One read, so a row can never exist without its status or the other way round.
  assert.equal(store.getState().data?.statuses.length, 2);
  assert.equal(store.getState().data?.config.version, 1);
  stop();
  assert.equal(store.getState().data, undefined);
});

// ── scheduled tasks ────────────────────────────────────────────────────────

const fields = (patch: Partial<ScheduledTaskFormFields> = {}): ScheduledTaskFormFields => ({
  title: '  Water the plants  ',
  note: '  every morning  ',
  runAtLocal: '2026-09-08T09:00',
  recurrence: 'none',
  cronExpression: '',
  ...patch,
});

test('the schedule form writes the shape the Host takes', () => {
  const once = createScheduledTaskInputFromFields(fields());
  assert.equal(once?.title, 'Water the plants');
  assert.equal(once?.intentBody, 'every morning');
  assert.equal(once?.schedule.kind, 'once');
  // Delivery is local: bot channels need the Bots settings page the rewrite defers.
  assert.deepEqual(once?.effect, { kind: 'notify', channel: 'local' });
  assert.equal(
    scheduledTaskScheduleFromFields(fields({ recurrence: 'cron', cronExpression: ' 0 9 * * * ' }))
      ?.kind,
    'cron',
  );
  assert.equal(scheduledTaskScheduleFromFields(fields({ recurrence: 'daily' }))?.kind, 'calendar');
  // An unparseable time describes no schedule, and the dialog must not submit.
  assert.equal(createScheduledTaskInputFromFields(fields({ runAtLocal: '' })), null);
});

test('an agent-authored interval schedule is preserved rather than re-authored', () => {
  const locked = { kind: 'interval', everySeconds: 3_600, startAt: 0 } as const;
  assert.deepEqual(
    scheduledTaskScheduleFromFields(fields({ recurrence: 'interval', lockedSchedule: locked })),
    locked,
  );
});

test('every scheduled-task mutation re-reads the list it just changed', async () => {
  const tasks = [{ id: 'a', title: 'A', status: 'active', nextFireAt: 1 }];
  const store = createScheduledTasksStore({
    listScheduledTasks: async () => [...tasks],
    subscribeScheduledTaskChanges: () => () => {},
    deleteScheduledTask: async (id: string) => {
      const index = tasks.findIndex((task) => task.id === id);
      if (index >= 0) tasks.splice(index, 1);
    },
  } as never);
  const stop = store.start();
  await new Promise((settle) => setTimeout(settle, 0));
  assert.equal(store.getState().data?.length, 1);
  await store.remove('a');
  // The Host also pushes a change event, but it is not ordered against the
  // promise; the re-read is what keeps the row from snapping back for a frame.
  assert.equal(store.getState().data?.length, 0);
  stop();
});

// ── the Models page's own navigation ───────────────────────────────────────

test('every Models face knows the face Back returns to', () => {
  assert.deepEqual(modelsViewParent({ kind: 'list' }), { kind: 'list' });
  assert.deepEqual(modelsViewParent({ kind: 'catalog' }), { kind: 'list' });
  assert.deepEqual(modelsViewParent({ kind: 'detail', connectionId: 'c1' }), { kind: 'list' });
  // Setup came from the catalog, so Back is one step, not two.
  assert.deepEqual(modelsViewParent({ kind: 'setup', providerType: 'relx-gateway' }), {
    kind: 'catalog',
  });
});
