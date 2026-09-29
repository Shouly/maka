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
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  CHILD_EXCLUDED_TOOL_NAMES,
  EXPLORE_AGENT_DEFINITION,
  GENERAL_PURPOSE_AGENT_DEFINITION,
  PLAN_AGENT_DEFINITION,
  agentToolsLabel,
  listBuiltinAgentDefinitions,
  selectChildAgentTools,
} from '../agent-catalog.js';
import {
  AGENT_LIST_TOOL_NAME,
  AGENT_SPAWN_TOOL_NAME,
  SUBAGENT_HANDBACK_REMINDER,
  buildParentAgentTools,
  buildSendMessageToChildAgentTool,
  buildSubagentHandbackTool,
  buildSubagentListTool,
  buildSubagentOutputTool,
  buildSubagentSpawnTool,
  renderAgentRoster,
} from '../subagent-tools.js';
import type { MakaTool, MakaToolContext } from '../tool-runtime.js';

function context(overrides: Partial<MakaToolContext> = {}): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'parent-turn',
    cwd: '/tmp/cwd',
    toolCallId: 'tool-1',
    abortSignal: new AbortController().signal,
    emitOutput: () => {},
    ...overrides,
  };
}

function parse(tool: MakaTool, input: unknown): { success: boolean; data?: unknown } {
  return (
    tool.parameters as { safeParse(value: unknown): { success: boolean; data?: unknown } }
  ).safeParse(input);
}

function started(input: { agentProfile: string }) {
  return {
    childSessionId: 'child-session',
    agentId: input.agentProfile,
    agentName: input.agentProfile,
    turnId: 'child-turn',
    runId: 'child-run',
    permissionMode: 'ask',
  };
}

async function expectRejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), pattern);
    return;
  }
  throw new Error('Expected promise to reject');
}

describe('agent types', () => {
  test('the design has three: general-purpose, Explore and Plan', () => {
    assert.deepStrictEqual(
      listBuiltinAgentDefinitions().map((definition) => [
        definition.profile,
        definition.permissionMode,
        definition.tools,
      ]),
      [
        ['general-purpose', 'ask', '*'],
        ['Explore', 'explore', 'All tools except Agent, Write, Edit, NotebookEdit, apply_patch'],
        ['Plan', 'explore', 'All tools except Agent, Write, Edit, NotebookEdit, apply_patch'],
      ],
    );
    assert.strictEqual(agentToolsLabel(GENERAL_PURPOSE_AGENT_DEFINITION), '*');
  });

  test('every role card hands its report back and none contradicts it', () => {
    for (const definition of [
      GENERAL_PURPOSE_AGENT_DEFINITION,
      EXPLORE_AGENT_DEFINITION,
      PLAN_AGENT_DEFINITION,
    ]) {
      assert.match(definition.systemPrompt, /SubagentHandback/u, definition.profile);
      assert.doesNotMatch(definition.systemPrompt, /final assistant message|as a regular message/u);
      assert.doesNotMatch(definition.systemPrompt, /Claude/u);
    }
    assert.match(EXPLORE_AGENT_DEFINITION.systemPrompt, /READ-ONLY MODE/u);
    assert.match(PLAN_AGENT_DEFINITION.systemPrompt, /READ-ONLY MODE/u);
    assert.doesNotMatch(GENERAL_PURPOSE_AGENT_DEFINITION.systemPrompt, /READ-ONLY/u);
  });

  test('a child holds what a main session would, less what no child and its type may hold', () => {
    const surface = [
      TOOL_NAMES.read,
      TOOL_NAMES.write,
      TOOL_NAMES.edit,
      TOOL_NAMES.notebookEdit,
      TOOL_NAMES.applyPatch,
      TOOL_NAMES.bash,
      TOOL_NAMES.sendUserMessage,
      TOOL_NAMES.sendUserFile,
      TOOL_NAMES.skill,
      TOOL_NAMES.memoryRead,
      TOOL_NAMES.memoryList,
      TOOL_NAMES.scheduledTaskCreate,
      TOOL_NAMES.taskStop,
      ...CHILD_EXCLUDED_TOOL_NAMES,
    ].map((name) => ({ name }));
    const general = selectChildAgentTools(surface, GENERAL_PURPOSE_AGENT_DEFINITION).map(
      ({ name }) => name,
    );
    assert.deepStrictEqual(general, [
      'Read',
      'Write',
      'Edit',
      'NotebookEdit',
      'apply_patch',
      'Bash',
      'SendUserMessage',
      'SendUserFile',
      'Skill',
      'MemoryRead',
      'MemoryList',
      'TaskStop',
    ]);
    for (const excluded of [
      TOOL_NAMES.agent,
      TOOL_NAMES.askUserQuestion,
      TOOL_NAMES.memoryWrite,
      TOOL_NAMES.memoryDelete,
      TOOL_NAMES.sendLater,
      TOOL_NAMES.scheduledTaskCreate,
      TOOL_NAMES.scheduledTaskRun,
      TOOL_NAMES.copilotSettingsUpdate,
      TOOL_NAMES.submitPlan,
      TOOL_NAMES.goalSet,
      TOOL_NAMES.sendMessage,
    ]) {
      assert.ok(!general.includes(excluded), excluded);
    }
    assert.deepStrictEqual(
      selectChildAgentTools(surface, EXPLORE_AGENT_DEFINITION).map(({ name }) => name),
      general.filter((name) => !['Write', 'Edit', 'NotebookEdit', 'apply_patch'].includes(name)),
    );
  });
});

describe('subagent tools', () => {
  test('the parent holds Agent, SendMessage and ListAgents', () => {
    assert.deepStrictEqual(
      buildParentAgentTools().map((tool) => [tool.name, tool.categoryHint]),
      [
        [AGENT_SPAWN_TOOL_NAME, 'subagent'],
        [TOOL_NAMES.sendMessage, 'subagent'],
        [AGENT_LIST_TOOL_NAME, 'read'],
      ],
    );
  });

  test('Agent takes description, prompt and an optional subagent_type — nothing else', () => {
    const tool = buildSubagentSpawnTool();
    assert.strictEqual(parse(tool, { description: 'Look', prompt: 'Look.' }).success, true);
    assert.strictEqual(
      parse(tool, { description: 'Look', prompt: 'Look.', subagent_type: 'Explore' }).success,
      true,
    );
    assert.strictEqual(parse(tool, { prompt: 'Look.' }).success, false);
    assert.strictEqual(parse(tool, { description: 'Look' }).success, false);
    for (const extra of [{ model: 'haiku' }, { isolation: 'worktree' }, { write_back: 'patch' }]) {
      assert.strictEqual(
        parse(tool, { description: 'Look', prompt: 'Look.', ...extra }).success,
        false,
        JSON.stringify(extra),
      );
    }
    assert.match(tool.description, /If omitted, the general-purpose agent is used\./u);
  });

  test('Agent runs general-purpose when no type is named, and says it is running', async () => {
    const tool = buildSubagentSpawnTool();
    const calls: Record<string, unknown>[] = [];
    const output: string[] = [];
    const result = await tool.impl(
      { description: 'Check env', prompt: 'Check the environment.' },
      context({
        emitOutput: (_stream, chunk) => output.push(chunk),
        spawnChildSession: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return started(input);
        },
      }),
    );
    assert.deepStrictEqual(calls, [
      {
        agentProfile: 'general-purpose',
        prompt: 'Check the environment.',
        description: 'Check env',
      },
    ]);
    assert.deepStrictEqual(output, [
      'Starting child agent: General purpose\n',
      'Child agent General purpose is running\n',
    ]);
    assert.deepStrictEqual(result, {
      kind: 'subagent',
      childSessionId: 'child-session',
      agentId: 'general-purpose',
      agentName: 'general-purpose',
      turnId: 'child-turn',
      runId: 'child-run',
      status: 'running',
      permissionMode: 'ask',
      summary: '',
      artifactIds: [],
    });
    const model = tool.toModelOutput?.({ input: {}, output: result } as never) as {
      value: string;
    };
    assert.match(model.value, /^Async agent launched successfully\./u);
    assert.match(model.value, /agentId: child-session /u);
  });

  test('Agent runs a preset as its base type on the preset id', async () => {
    const tool = buildSubagentSpawnTool();
    const calls: Record<string, unknown>[] = [];
    await tool.impl(
      { description: 'Scan', prompt: 'Scan.', subagent_type: 'fast-reader' },
      context({
        listChildAgents: async () => ({
          presets: [
            { id: 'fast-reader', profile: 'Explore', availability: { status: 'available' } },
          ],
        }),
        spawnChildSession: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return started(input);
        },
      }),
    );
    assert.strictEqual(calls[0]?.agentProfile, 'Explore');
    assert.strictEqual(calls[0]?.subagentId, 'fast-reader');
  });

  test('an unknown type names every type there is, as the design does', async () => {
    const tool = buildSubagentSpawnTool();
    await expectRejects(
      Promise.resolve(
        tool.impl(
          { description: 'Scan', prompt: 'Scan.', subagent_type: 'nonexistent-type-test' },
          context({
            listChildAgents: async () => ({
              presets: [
                { id: 'fast-reader', profile: 'Explore', availability: { status: 'available' } },
                { id: 'off', profile: 'Explore', availability: { status: 'unavailable' } },
              ],
            }),
            spawnChildSession: async () => assert.fail('must not start'),
          }),
        ),
      ),
      /^Agent type 'nonexistent-type-test' not found\. Available agents: Explore, fast-reader, general-purpose, Plan$/u,
    );
  });

  test('Agent bounds projected startup failures', async () => {
    const tool = buildSubagentSpawnTool();
    const output: string[] = [];
    await expectRejects(
      Promise.resolve(
        tool.impl(
          { description: 'Delegate one task', prompt: 'Fail.' },
          context({
            emitOutput: (_stream, chunk) => output.push(chunk),
            spawnChildSession: async () => {
              throw new Error('x'.repeat(10_000));
            },
          }),
        ),
      ),
      /^x+$/u,
    );
    assert.strictEqual(output.length, 2);
    assert.strictEqual((output[1]?.length ?? Number.POSITIVE_INFINITY) < 1_100, true);
  });

  test('ListAgents takes no arguments and lists what this session started', async () => {
    const tool = buildSubagentListTool();
    assert.strictEqual(parse(tool, {}).success, true);
    assert.strictEqual(parse(tool, { view: 'catalog' }).success, false);
    const empty = await tool.impl(
      {},
      context({ listChildAgents: async () => ({ executions: [] }) }),
    );
    assert.deepStrictEqual(empty, {
      type: 'text',
      value:
        'This session is session-1 — the ID other tools use to reach it (it is not listed below; a message to it would be a message to yourself).\n\nNo reachable agents — this session has not started any.',
    });
    assert.match(
      renderAgentRoster(
        'session-1',
        {
          executions: [
            {
              execution: { kind: 'child_session', sessionId: 'child-1' },
              profile: 'Explore',
              status: 'running',
              createdAt: 1_000,
              agentName: 'Explore',
            },
          ],
        },
        61_000,
      ),
      /\nSubagents \(1\):\n {2}child-1 · Explore · running · started 1m ago · Explore$/u,
    );
  });

  test('SendMessage resumes a finished agent and reports it', async () => {
    const tool = buildSendMessageToChildAgentTool();
    const sent: unknown[] = [];
    const result = await tool.impl(
      { to: 'child-session', message: 'Report the sum again.', summary: 'ask again' },
      context({
        sendChildAgentMessage: async (input) => {
          sent.push(input);
          return { delivery: 'resumed', ...started({ agentProfile: 'general-purpose' }) };
        },
      }),
    );
    // The summary stays on this side: it is not part of what the agent reads.
    assert.deepStrictEqual(sent, [
      { childSessionId: 'child-session', text: 'Report the sum again.' },
    ]);
    const model = tool.toModelOutput?.({ input: {}, output: result } as never) as { value: string };
    assert.deepStrictEqual(JSON.parse(model.value), {
      success: true,
      message:
        'Resumed agent in the background with its context intact. You will be notified when it finishes.',
      resumedAgentId: 'child-session',
    });
  });

  test('SendMessage reaches an agent still at work at its next step', async () => {
    const tool = buildSendMessageToChildAgentTool();
    const result = await tool.impl(
      { to: 'child-session', message: 'Also check the tests.' },
      context({
        sendChildAgentMessage: async () => ({
          delivery: 'queued',
          childSessionId: 'child-session',
        }),
      }),
    );
    const model = tool.toModelOutput?.({ input: {}, output: result } as never) as { value: string };
    assert.deepStrictEqual(JSON.parse(model.value), {
      success: true,
      message:
        'Message delivered to child-session. It acts on it next: at its next step if it is still working, or in a new turn once its last report has reached you.',
    });
  });

  test('a send that cannot be delivered answers success:false instead of failing', async () => {
    const tool = buildSendMessageToChildAgentTool();
    const result = await tool.impl(
      { to: 'no-such-agent-xyz', message: 'Hello.' },
      context({
        sendChildAgentMessage: async () => {
          throw new Error(
            "No agent named 'no-such-agent-xyz' is reachable.\nUse ListAgents to see everyone you can message.",
          );
        },
      }),
    );
    const model = tool.toModelOutput?.({ input: {}, output: result } as never) as { value: string };
    assert.deepStrictEqual(JSON.parse(model.value), {
      success: false,
      message:
        "No agent named 'no-such-agent-xyz' is reachable.\nUse ListAgents to see everyone you can message.",
    });
    assert.strictEqual(parse(tool, { to: 'a\nb', message: 'x' }).success, false);
  });

  test('SubagentHandback takes the report and nothing else, in the design words', async () => {
    const tool = buildSubagentHandbackTool();
    assert.strictEqual(tool.name, TOOL_NAMES.subagentHandback);
    assert.strictEqual(parse(tool, { message: 'Done.' }).success, true);
    assert.strictEqual(parse(tool, {}).success, false);
    assert.strictEqual(parse(tool, { message: 'Done.', to: 'main' }).success, false);
    assert.match(
      tool.description,
      /^Deliver your final report to the agent that spawned you \(your caller\)\./u,
    );
    assert.match(
      tool.description,
      /plain text you write at the end of your turn is NOT delivered/u,
    );
    assert.match(
      SUBAGENT_HANDBACK_REMINDER,
      /^Your final report is delivered through SubagentHandback/u,
    );
    assert.deepStrictEqual(await tool.impl({ message: 'Done.' }, context()), {
      type: 'text',
      value: 'Your report was delivered to your caller. Stop here.',
    });
  });

  test('AgentOutput uses an explicit locator when a provider fills unrelated fields', async () => {
    const outputTool = buildSubagentOutputTool();
    const parsed = (
      outputTool.parameters as {
        safeParse(input: unknown): { success: boolean; data?: Record<string, unknown> };
      }
    ).safeParse({
      locator: 'child_session_run',
      child_session_id: 'child-session',
      run_id: 'child-run',
      turn_id: { malformed: true },
      ignored: true,
    });
    assert.strictEqual(parsed.success, true);
    assert.deepStrictEqual(parsed.data, {
      locator: 'child_session_run',
      child_session_id: 'child-session',
      run_id: 'child-run',
    });

    const output = await outputTool.impl(
      {
        locator: 'child_session_run',
        child_session_id: 'child-session',
        run_id: 'child-run',
        turn_id: 'provider-placeholder',
        max_events: 100,
        max_bytes: 32_768,
        view: 'runtime_events',
      },
      {
        sessionId: 'session-1',
        turnId: 'parent-turn',
        cwd: '/tmp/cwd',
        toolCallId: 'tool-output-provider-filled',
        abortSignal: new AbortController().signal,
        emitOutput: () => {},
        readChildAgentOutput: async (input) => ({ requested: input }),
      },
    );

    assert.deepStrictEqual(output, {
      requested: {
        execution: {
          kind: 'child_session',
          sessionId: 'child-session',
          currentRunId: 'child-run',
        },
        maxEvents: 100,
        maxBytes: 32_768,
        view: 'runtime_events',
      },
    });
  });
});
