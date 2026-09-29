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

import { z } from 'zod';
import { decodeCanonicalToolResultContent } from '@maka/core/tool-result-record-schema';
import { isSafeSubagentPresetId } from '@maka/core/subagent-settings';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { type ToolResultContent } from '@maka/core/events';
import type { MakaTool, MakaToolContext } from './tool-runtime.js';
import {
  BUILTIN_AGENT_DEFINITIONS,
  DEFAULT_AGENT_TYPE,
  getBuiltinAgentDefinitionByProfile,
  type AgentDefinition,
} from './agent-catalog.js';

export const AGENT_SPAWN_TOOL_NAME = TOOL_NAMES.agent;
export const AGENT_LIST_TOOL_NAME = TOOL_NAMES.listAgents;
export const AGENT_OUTPUT_TOOL_NAME = TOOL_NAMES.agentOutput;
export const SUBAGENT_HANDBACK_TOOL_NAME = TOOL_NAMES.subagentHandback;
const CHILD_PROGRESS_ERROR_MAX_CHARS = 1_000;
/** The 3-5 word label a person reads while the child runs. */
const AGENT_DESCRIPTION_MAX_CHARS = 120;
/** A `to` is one line; the design caps it at 300 characters. */
const SEND_MESSAGE_TO_MAX_CHARS = 300;

/**
 * Which schema fields each `AgentOutput` locator needs. A rejection that only
 * says "its matching identity fields" leaves the model guessing which of the
 * four optional id fields to add, so name them.
 */
const LOCATOR_REQUIRED_FIELDS = {
  child_session_latest: 'child_session_id',
  child_session_run: 'child_session_id and run_id',
  legacy_run: 'run_id',
  legacy_turn: 'turn_id',
} as const satisfies Record<string, string>;

type SubagentToolResult = Extract<ToolResultContent, { kind: 'subagent' }>;

export function buildSubagentSpawnTool(): MakaTool<
  {
    subagent_type?: string;
    description: string;
    prompt: string;
  },
  unknown
> {
  return {
    name: AGENT_SPAWN_TOOL_NAME,
    displayName: 'Agent',
    activityKind: 'delegate',
    description: [
      'Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.',
      '',
      `The agent types this session can run are listed in your context, each with what it is for and what it can use. When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the ${DEFAULT_AGENT_TYPE} agent is used.`,
      '',
      '## When to use',
      '',
      "A fresh agent costs more than it looks. It knows only what you put in the prompt, and you see only the report it hands back — both handoffs drop detail, and neither of you can tell what the other missed. You can't watch it work, only wait or stop it. Its mistakes come back in the same confident register as its findings, and an agent handed your hypothesis tends to return it confirmed. Several at once spend tokens in a burst the user didn't ask for. Weigh those tokens against the accuracy they buy: the user pays for agents you did not need, and pays again for work you redo because you skipped one.",
      '',
      "Reach for this when you have independent work to run in parallel, when the user asks for a side quest that shouldn't block your main thread, or when answering would mean reading across several files — delegate that and you keep the conclusion, not the file dumps.",
      '',
      "Do the work yourself when it is a handful of tool calls or a lookup whose target you already know; don't delegate a check you could run inline. Delegate review only when you want a read that isn't anchored on yours — then give it the code, not your conclusion. Once you've delegated something, don't also run it yourself; wait for the result. When in doubt, don't spawn.",
      '',
      'When you do spawn one, brief it like the peer it is: state the goal and what you have already ruled out, point it at the files and docs worth reading instead of retyping them, and keep the scope explicit and narrow. That brief is the only context it will have, so it is your one lever on every cost above — and if you cannot write a clear one, you do not understand the task well enough to hand it off.',
      '',
      '- The child sees nothing of this conversation and cannot ask you or the user anything, so write `prompt` as the whole brief.',
      "- `description` is the 3-5 word label a person reads while the child runs; it is not part of the child's brief.",
      "- Agents run in the background: this returns an ID as soon as the child is running, and you'll be notified when it finishes, with the report it handed back. Never fabricate or predict a pending agent's results — the notification is never something you write yourself; if the user asks before it arrives, say it is still running.",
      "- Don't duplicate a running agent's work: stay off the files and topics it is using.",
      '- Use SendMessage with the agent ID to continue it with its context intact; a new Agent call starts a fresh one. End one early with TaskStop.',
      "- The agent's final report is not shown to the user — relay what matters in your own words.",
      '- Fails when `subagent_type` names no agent type listed in your context, and when this session has no child-agent capability at all; that one repeats on retry, so do the task with the tools you already have.',
    ].join('\n'),
    parameters: z
      .object({
        description: z
          .string()
          .min(1)
          .max(AGENT_DESCRIPTION_MAX_CHARS)
          .describe('A short (3-5 word) description of the task'),
        prompt: z.string().min(1).max(60_000).describe('The task for the agent to perform'),
        subagent_type: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe('The type of specialized agent to use for this task'),
      })
      .strict(),
    categoryHint: 'subagent',
    impl: async (input, ctx) => {
      const selector = input.subagent_type ?? DEFAULT_AGENT_TYPE;
      const builtin = getBuiltinAgentDefinitionByProfile(selector);
      const definition = builtin ?? (await resolvePresetDefinition(selector, ctx));
      if (!ctx.spawnChildSession) {
        throw new Error(
          'Agent is not available in this session, so no child agent was started. ' +
            'Retrying Agent will fail the same way — do the task yourself with the tools you already have.',
          {
            cause: new Error('spawnChildSession capability is unavailable in this runtime context'),
          },
        );
      }
      // The child's own activity belongs to the child's Session: this row
      // closes as soon as the child is running, so anything streamed into it
      // afterwards would arrive after the reader had stopped looking.
      ctx.emitOutput('stdout', `Starting child agent: ${definition.name}\n`);
      let started: StartedChildAgent;
      try {
        started = projectStartedChildAgent(
          await ctx.spawnChildSession({
            agentProfile: definition.profile,
            ...(builtin ? {} : { subagentId: selector }),
            prompt: input.prompt,
            description: input.description,
          }),
        );
      } catch (error) {
        ctx.emitOutput(
          'stderr',
          `Child agent ${definition.name} failed: ${boundedChildError(error)}\n`,
        );
        throw error;
      }
      ctx.emitOutput('stdout', `Child agent ${definition.name} is running\n`);
      return {
        kind: 'subagent',
        childSessionId: started.childSessionId,
        ...(started.agentId ? { agentId: started.agentId } : {}),
        agentName: started.agentName,
        turnId: started.turnId,
        ...(started.runId ? { runId: started.runId } : {}),
        // Running is the terminal state of THIS tool call: the child's own end
        // arrives later, as a notification, not as this result.
        status: 'running',
        permissionMode: started.permissionMode,
        summary: '',
        artifactIds: [],
      } satisfies SubagentToolResult;
    },
    toModelOutput: ({ output }) => {
      const result = output as { kind?: string; childSessionId?: string };
      if (result?.kind !== 'subagent' || typeof result.childSessionId !== 'string') {
        return undefined;
      }
      return { type: 'text', value: startedChildAgentText(result.childSessionId) };
    },
  };
}

/**
 * A `subagent_type` that is not a built-in type names a preset: a custom type
 * the user set up in Settings, running as one of the built-in ones on its own
 * model.
 */
async function resolvePresetDefinition(
  subagentId: string,
  ctx: MakaToolContext,
): Promise<AgentDefinition> {
  const catalog = isSafeSubagentPresetId(subagentId) ? await ctx.listChildAgents?.() : undefined;
  const presets = (catalog as { presets?: unknown } | undefined)?.presets;
  const available = Array.isArray(presets)
    ? presets.filter(
        (candidate): candidate is { id: string; profile: string } =>
          Boolean(candidate) &&
          typeof candidate === 'object' &&
          typeof (candidate as { id?: unknown }).id === 'string' &&
          typeof (candidate as { profile?: unknown }).profile === 'string' &&
          (candidate as { availability?: { status?: unknown } }).availability?.status ===
            'available',
      )
    : [];
  const preset = available.find((candidate) => candidate.id === subagentId);
  const definition = preset ? getBuiltinAgentDefinitionByProfile(preset.profile) : undefined;
  if (!definition) {
    const names = [
      ...BUILTIN_AGENT_DEFINITIONS.map((candidate) => candidate.profile),
      ...available.map((candidate) => candidate.id),
    ].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
    throw new Error(`Agent type '${subagentId}' not found. Available agents: ${names.join(', ')}`);
  }
  return definition;
}

interface StartedChildAgent {
  childSessionId: string;
  agentId?: string;
  agentName: string;
  turnId: string;
  runId?: string;
  permissionMode: SubagentToolResult['permissionMode'];
}

/** What the model is told the moment a child agent is running. */
export function startedChildAgentText(agentId: string): string {
  return (
    'Async agent launched successfully. (This tool result is internal metadata — never quote ' +
    'or paste any part of it, including the agentId below, into a user-facing reply.)\n' +
    `agentId: ${agentId} (internal ID - do not mention to user. Use SendMessage with ` +
    `to: '${agentId}', summary: '<5-10 word recap>' to continue this agent, or TaskStop with ` +
    'that ID to end it.)\n' +
    'The agent is working in the background. You will be notified automatically when it ' +
    'completes. You know nothing about its results until that notification arrives — do not ' +
    'report, assume, or predict them; continue other work or respond to the user in the ' +
    'meantime.\n' +
    "Do not duplicate this agent's work — avoid working with the same files or topics it is " +
    'using.'
  );
}

function projectStartedChildAgent(value: unknown): StartedChildAgent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Child agent returned an invalid start result');
  }
  const raw = value as Record<string, unknown>;
  const decoded = decodeCanonicalToolResultContent({
    kind: 'subagent',
    childSessionId: raw.childSessionId,
    ...(raw.agentId !== undefined ? { agentId: raw.agentId } : {}),
    agentName: raw.agentName,
    turnId: raw.turnId,
    ...(raw.runId !== undefined ? { runId: raw.runId } : {}),
    status: 'running',
    permissionMode: raw.permissionMode,
    summary: '',
    artifactIds: [],
  });
  if (decoded.kind !== 'subagent' || !decoded.childSessionId) {
    throw new Error('Child agent returned an invalid start result');
  }
  return {
    childSessionId: decoded.childSessionId,
    ...(decoded.agentId ? { agentId: decoded.agentId } : {}),
    agentName: decoded.agentName,
    turnId: decoded.turnId,
    ...(decoded.runId ? { runId: decoded.runId } : {}),
    permissionMode: decoded.permissionMode,
  };
}

function boundedChildError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.length <= CHILD_PROGRESS_ERROR_MAX_CHARS
    ? message
    : `${message.slice(0, CHILD_PROGRESS_ERROR_MAX_CHARS - 1)}…`;
}

export function buildSubagentListTool(): MakaTool<Record<string, never>, unknown> {
  return {
    name: AGENT_LIST_TOOL_NAME,
    displayName: 'Agent List',
    activityKind: 'delegate',
    description: [
      'List the agents you can SendMessage to: the ones this session has started.',
      '',
      '- Each line starts with the ID SendMessage and TaskStop take, then what type the agent is, how it stands, and how long ago it started.',
      '- The types you can launch are listed in your context, not here.',
      '- Takes no arguments and changes nothing.',
    ].join('\n'),
    parameters: z.object({}).strict(),
    categoryHint: 'read',
    impl: async (_input, ctx) => {
      // Runtime Host supplies this capability to production clients. Keep the
      // failure explicit at the embedding boundary.
      if (!ctx.listChildAgents) {
        throw new Error(
          'ListAgents is not available in this session, so no agent could be listed. ' +
            'Retrying ListAgents will fail the same way.',
          { cause: new Error('listChildAgents capability is unavailable in this runtime context') },
        );
      }
      const catalog = await ctx.listChildAgents();
      return { type: 'text', value: renderAgentRoster(ctx.sessionId, catalog, Date.now()) };
    },
  };
}

/**
 * The agents this Session has started, as a person would read them out.
 *
 * The roster is the answer to "what did I set running", so it names the id the
 * other tools take, the type behind it, where it stands and how long ago it
 * began — not the catalog of types, which the Session already carries in its
 * context.
 */
export function renderAgentRoster(sessionId: string, catalog: unknown, now: number): string {
  const raw =
    catalog && typeof catalog === 'object' && !Array.isArray(catalog)
      ? (catalog as Record<string, unknown>)
      : {};
  const executions = Array.isArray(raw.executions) ? raw.executions : [];
  const rows: string[] = [];
  for (const candidate of executions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const execution =
      item.execution && typeof item.execution === 'object' && !Array.isArray(item.execution)
        ? (item.execution as Record<string, unknown>)
        : undefined;
    const id =
      typeof execution?.sessionId === 'string' && execution.kind === 'child_session'
        ? execution.sessionId
        : typeof execution?.runId === 'string'
          ? execution.runId
          : undefined;
    if (id === undefined) continue;
    const type = typeof item.profile === 'string' ? item.profile : 'agent';
    const status = typeof item.status === 'string' ? item.status : 'running';
    const started =
      typeof item.createdAt === 'number' ? ` · started ${agoLabel(now - item.createdAt)}` : '';
    const name = typeof item.agentName === 'string' ? ` · ${item.agentName}` : '';
    rows.push(`  ${id} · ${type} · ${status}${started}${name}`);
  }
  const header =
    `This session is ${sessionId} — the ID other tools use to reach it ` +
    '(it is not listed below; a message to it would be a message to yourself).';
  if (rows.length === 0) {
    return `${header}\n\nNo reachable agents — this session has not started any.`;
  }
  return `${header}\n\nSubagents (${rows.length}):\n${rows.join('\n')}`;
}

/** How long ago, in the coarsest unit that still says something. */
function agoLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function buildSubagentOutputTool(): MakaTool<
  {
    locator?: 'child_session_latest' | 'child_session_run' | 'legacy_run' | 'legacy_turn';
    child_session_id?: string;
    run_id?: string;
    turn_id?: string;
    max_events?: number;
    max_bytes?: number;
    view?: 'result' | 'events' | 'runtime_events' | 'all';
  },
  unknown
> {
  return {
    name: AGENT_OUTPUT_TOOL_NAME,
    displayName: 'Agent Output',
    activityKind: 'delegate',
    description: [
      'Read what one child agent produced, bounded. Use it after Agent returns, or once SwarmStatus or ViewAgentGraph shows a graph item completed, to get the answer itself rather than the trace that produced it.',
      '',
      '- The agentId Agent returned is a child_session_id: read that child with locator child_session_latest and child_session_id set to it.',
      '- Always set `locator`: the runtime reads only the id fields that locator names. child_session_run takes child_session_id and run_id, child_session_latest takes child_session_id and reads that session latest run, legacy_run takes run_id, legacy_turn takes turn_id. A locator missing its ids is rejected naming the field.',
      '- view=result is what you normally want: the final committed child text with its graph result record id. runtime_events is the default only for compatibility with older callers, and view=all is for diagnosing a child that failed.',
      '- Do not read the logs, tool calls or reasoning of a child that is still running to follow its progress. Partial output is not a result, and progress is what SwarmStatus and ViewAgentGraph report.',
      '- Every view is truncated to fit; max_events and max_bytes bound one call. Narrow the view rather than raising the budget.',
      '- Fails when the ids name no child run, and when this session cannot read child output at all; the second repeats on retry, so use the summary Agent returned when that child completed.',
    ].join('\n'),
    parameters: z.preprocess(
      cleanSubagentOutputInput,
      z
        .object({
          locator: z
            .enum(['child_session_latest', 'child_session_run', 'legacy_run', 'legacy_turn'])
            .optional()
            .describe(
              'Explicit locator discriminator. The runtime applies only fields selected by this value.',
            ),
          child_session_id: z
            .string()
            .min(1)
            .optional()
            .describe(
              'The child agent: the agentId Agent returned, or a graph item child session id. Without run_id, inspects its latest AgentRun.',
            ),
          run_id: z
            .string()
            .min(1)
            .optional()
            .describe('AgentRun id: the run inside a child Session, or a legacy child run.'),
          turn_id: z.string().min(1).optional().describe('Legacy child turn id.'),
          max_events: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Cap on events returned by the event views.'),
          max_bytes: z
            .number()
            .int()
            .min(1024)
            .max(128 * 1024)
            .optional()
            .describe('Cap on returned bytes; output beyond it is truncated.'),
          view: z
            .enum(['result', 'events', 'runtime_events', 'all'])
            .optional()
            .describe(
              'result returns the final committed child text; events and runtime_events return bounded activity; all is for diagnostics.',
            ),
        })
        .strip()
        .superRefine((input, ctx) => {
          if (input.locator) {
            const valid =
              (input.locator === 'child_session_latest' && Boolean(input.child_session_id)) ||
              (input.locator === 'child_session_run' &&
                Boolean(input.child_session_id) &&
                Boolean(input.run_id)) ||
              (input.locator === 'legacy_run' && Boolean(input.run_id)) ||
              (input.locator === 'legacy_turn' && Boolean(input.turn_id));
            if (!valid) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `locator=${input.locator} requires ${LOCATOR_REQUIRED_FIELDS[input.locator]}.`,
              });
            }
            return;
          }
          if (input.child_session_id) {
            if (input.turn_id) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['turn_id'],
                message: 'turn_id cannot be combined with child_session_id',
              });
            }
            return;
          }
          if (Number(!!input.run_id) + Number(!!input.turn_id) !== 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Provide child_session_id, or exactly one legacy run_id/turn_id',
            });
          }
        }),
    ),
    categoryHint: 'read',
    impl: async (input, ctx) => {
      if (!ctx.readChildAgentOutput) {
        // Same reachability as `ListAgents` above.
        throw new Error(
          'AgentOutput is not available in this session, so no child output could be read. ' +
            'Retrying AgentOutput will fail the same way — use the summary returned when that child completed.',
          {
            cause: new Error(
              'readChildAgentOutput capability is unavailable in this runtime context',
            ),
          },
        );
      }
      const explicitLocator =
        input.locator === 'child_session_latest'
          ? {
              execution: {
                kind: 'child_session' as const,
                sessionId: input.child_session_id!,
              },
            }
          : input.locator === 'child_session_run'
            ? {
                execution: {
                  kind: 'child_session' as const,
                  sessionId: input.child_session_id!,
                  currentRunId: input.run_id!,
                },
              }
            : input.locator === 'legacy_run'
              ? {
                  execution: {
                    kind: 'legacy_child_run' as const,
                    sessionId: ctx.sessionId,
                    runId: input.run_id!,
                  },
                }
              : input.locator === 'legacy_turn'
                ? { turnId: input.turn_id! }
                : undefined;
      return await ctx.readChildAgentOutput({
        ...(explicitLocator ??
          (input.child_session_id
            ? {
                execution: {
                  kind: 'child_session' as const,
                  sessionId: input.child_session_id,
                  ...(input.run_id ? { currentRunId: input.run_id } : {}),
                },
              }
            : input.run_id
              ? {
                  execution: {
                    kind: 'legacy_child_run' as const,
                    sessionId: ctx.sessionId,
                    runId: input.run_id,
                  },
                }
              : {})),
        ...(input.locator === undefined && input.turn_id ? { turnId: input.turn_id } : {}),
        ...(input.max_events !== undefined ? { maxEvents: input.max_events } : {}),
        ...(input.max_bytes !== undefined ? { maxBytes: input.max_bytes } : {}),
        ...(input.view !== undefined ? { view: input.view } : {}),
      });
    },
  };
}

function cleanSubagentOutputInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const cleaned = { ...(input as Record<string, unknown>) };
  switch (cleaned.locator) {
    case 'child_session_latest':
      delete cleaned.run_id;
      delete cleaned.turn_id;
      break;
    case 'child_session_run':
    case 'legacy_run':
      delete cleaned.turn_id;
      if (cleaned.locator === 'legacy_run') delete cleaned.child_session_id;
      break;
    case 'legacy_turn':
      delete cleaned.child_session_id;
      delete cleaned.run_id;
      break;
  }
  return cleaned;
}

/**
 * How a message reached an agent: a finished one runs again from where it
 * left off; one still working reads it at its next step.
 */
export type ChildAgentMessageDelivery =
  | ({ readonly delivery: 'resumed' } & Record<string, unknown>)
  | { readonly delivery: 'queued'; readonly childSessionId: string };

/**
 * Another message for an agent this session already started.
 *
 * The child keeps its own Session, so a message to a finished one is a new
 * Turn of it: it answers with everything it learned the first time, and like
 * the first brief the answer comes back as a notification. A child still at
 * work reads the message at its next step, as a course correction.
 */
export function buildSendMessageToChildAgentTool(): MakaTool<{
  to: string;
  message: string;
  summary?: string;
}> {
  return {
    name: TOOL_NAMES.sendMessage,
    activityKind: 'delegate',
    // It starts a Turn of a child agent, so it belongs to the same category as
    // Agent: the same permission class, and the same per-Turn cap on how many
    // children one Turn may set running.
    categoryHint: 'subagent',
    description: [
      'Send a message to an agent this session started.',
      '',
      "- `to` is the ID the Agent tool returned, or the agent's name. ListAgents lists everyone you can message.",
      '- An agent that has finished keeps working after a send: it resumes from its transcript with its context intact, in the background like the first brief, and you are notified when it finishes. A new Agent call would instead start one that knows nothing.',
      '- An agent still working reads the message at its next step, as a course correction to the task it is on. One that has finished but whose report has not reached you yet takes the message up in a new turn once it has.',
      "- `summary` is a 5-10 word recap of what you are asking; it stays in this session's record and is not sent to the agent.",
      '- A send that cannot be delivered is not an error: the result says `"success":false` and why, so check it.',
    ].join('\n'),
    parameters: z.object({
      to: z
        .string()
        .min(1)
        .max(SEND_MESSAGE_TO_MAX_CHARS)
        .regex(/^[^\r\n]*$/u, 'to must be one line')
        .describe("The ID the Agent tool returned, or the agent's name"),
      message: z.string().min(1).max(60_000).describe('What to tell the agent'),
      summary: z
        .string()
        .optional()
        .describe("A 5-10 word recap of this message, for this session's record"),
    }),
    impl: async (input, ctx) => {
      if (!ctx.sendChildAgentMessage) {
        throw new Error(
          'SendMessage is not available in this session, so no agent was reached. ' +
            'Retrying SendMessage will fail the same way — start a fresh agent with Agent instead.',
        );
      }
      let delivered: unknown;
      try {
        delivered = await ctx.sendChildAgentMessage({
          childSessionId: input.to,
          text: input.message,
        });
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'The message could not be delivered.',
        };
      }
      if ((delivered as { delivery?: unknown })?.delivery === 'queued') {
        const id = (delivered as { childSessionId: string }).childSessionId;
        return {
          success: true,
          message: `Message delivered to ${id}. It acts on it next: at its next step if it is still working, or in a new turn once its last report has reached you.`,
        };
      }
      const started = projectStartedChildAgent(delivered);
      return {
        kind: 'subagent',
        childSessionId: started.childSessionId,
        ...(started.agentId ? { agentId: started.agentId } : {}),
        agentName: started.agentName,
        turnId: started.turnId,
        ...(started.runId ? { runId: started.runId } : {}),
        status: 'running',
        permissionMode: started.permissionMode,
        summary: '',
        artifactIds: [],
      } satisfies SubagentToolResult;
    },
    toModelOutput: ({ output }) => {
      const result = output as { kind?: unknown; childSessionId?: unknown };
      if (result?.kind !== 'subagent' || typeof result.childSessionId !== 'string') {
        return { type: 'text', value: JSON.stringify(output) };
      }
      return {
        type: 'text',
        value: JSON.stringify({
          success: true,
          message:
            'Resumed agent in the background with its context intact. You will be notified when it finishes.',
          resumedAgentId: result.childSessionId,
        }),
      };
    },
  };
}

/** The design's words for the hand-back, repeated where the child reads its reminder. */
export const SUBAGENT_HANDBACK_REMINDER =
  'Your final report is delivered through SubagentHandback: when your work is complete, call SubagentHandback({message: <your full report>}) and then stop. Only a SubagentHandback call reaches your caller as your result; plain text you write at the end is not delivered.';

/**
 * A child agent's one way to deliver its report. The call ends the child's
 * turn; the report is what its caller's notification carries.
 */
export function buildSubagentHandbackTool(): MakaTool<{ message: string }> {
  return {
    name: SUBAGENT_HANDBACK_TOOL_NAME,
    displayName: 'Hand back',
    activityKind: 'tool',
    description: [
      'Deliver your final report to the agent that spawned you (your caller). Use it once, for that hand-off only: when your work is complete, call SubagentHandback({message: <your full report>}) as your last tool call and then stop. It is not a messaging channel: do not use it for progress updates or questions.',
      '',
      'Only a report delivered through SubagentHandback reaches your caller; plain text you write at the end of your turn is NOT delivered. There is no recipient parameter: the report can only go to your caller.',
    ].join('\n'),
    parameters: z
      .object({
        message: z.string().describe('Your full report for your caller'),
      })
      .strict(),
    impl: async () => ({
      type: 'text',
      value: 'Your report was delivered to your caller. Stop here.',
    }),
  };
}

export function buildParentAgentTools(): MakaTool[] {
  return [buildSubagentSpawnTool(), buildSendMessageToChildAgentTool(), buildSubagentListTool()];
}
