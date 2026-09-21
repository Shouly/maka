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
  AGENT_WORKSPACE_SAME_WORKSPACE,
  AGENT_WORKSPACE_WORKTREE,
  AGENT_WRITE_BACK_PATCH,
  AGENT_WRITE_BACK_SUMMARY,
  BUILTIN_AGENT_DEFINITIONS,
  agentProfilesForDefinitions,
  buildToolsForAgentDefinition,
  requireAgentDefinitionByProfile,
  type AgentDefinition,
} from './agent-catalog.js';

export const AGENT_SPAWN_TOOL_NAME = TOOL_NAMES.agent;
export const AGENT_LIST_TOOL_NAME = TOOL_NAMES.listAgents;
export const AGENT_OUTPUT_TOOL_NAME = TOOL_NAMES.agentOutput;
export const AGENT_TOOL_GROUP_ID = 'agent';
export const AGENT_TOOL_NAMES = [
  AGENT_SPAWN_TOOL_NAME,
  AGENT_LIST_TOOL_NAME,
  AGENT_OUTPUT_TOOL_NAME,
] as const;
export const CHILD_AGENT_TOOL_NAMES = [
  ...new Set(BUILTIN_AGENT_DEFINITIONS.flatMap((definition) => definition.tools)),
] as readonly string[];
const AGENT_SPAWN_WRITE_BACK_MODES = [AGENT_WRITE_BACK_SUMMARY, AGENT_WRITE_BACK_PATCH] as const;
const AGENT_SPAWN_ISOLATION_MODES = [
  AGENT_WORKSPACE_SAME_WORKSPACE,
  AGENT_WORKSPACE_WORKTREE,
] as const;
const CHILD_PROGRESS_ERROR_MAX_CHARS = 1_000;
const AGENT_LIST_PAGE_SIZE = 8;
// Active tool-result archival starts at roughly 8k characters with the default
// token estimate. Keep discovery safely below it even with maximal catalog text.
const AGENT_LIST_MAX_RESPONSE_CHARS = 7_000;
const AGENT_LIST_DESCRIPTION_MAX_CHARS = 240;
const AGENT_LIST_MODEL_MAX_CHARS = 160;
/** The 3-5 word label a person reads while the child runs. */
const AGENT_DESCRIPTION_MAX_CHARS = 120;
/** Longest model name an override may name before it is obviously not one. */
const AGENT_MODEL_MAX_CHARS = 128;

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

export function buildChildAgentTools(tools: readonly MakaTool[]): MakaTool[] {
  const seen = new Set<string>();
  const out: MakaTool[] = [];
  for (const definition of BUILTIN_AGENT_DEFINITIONS) {
    for (const tool of buildToolsForAgentDefinition(tools, definition)) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      out.push(tool);
    }
  }
  return out;
}

export function buildSubagentSpawnTool(
  deps: { definitions?: readonly AgentDefinition[] } = {},
): MakaTool<
  {
    subagent_type: string;
    description: string;
    prompt: string;
    model?: string;
    write_back?: string;
    isolation?: string;
  },
  unknown
> {
  const definitions = deps.definitions ?? BUILTIN_AGENT_DEFINITIONS;
  const profiles = agentProfilesForDefinitions(definitions);
  const isLegacyProfile = (value: string): boolean => profiles.some((profile) => profile === value);
  // A built-in profile this composition does not carry is a wrong selector, not
  // an unknown preset id: say so at the schema, where the model can still fix
  // it, rather than letting it travel to the catalog as a preset lookup.
  const allBuiltinProfiles = agentProfilesForDefinitions(BUILTIN_AGENT_DEFINITIONS);
  const isUnavailableBuiltinProfile = (value: string): boolean =>
    !isLegacyProfile(value) && allBuiltinProfiles.some((profile) => profile === value);
  const missingSelectorMessage =
    'No child selector was provided. Pass one of the agent types listed in your context as ' +
    `subagent_type; the built-in profiles here are: ${profiles.join(', ')}.`;
  return {
    name: AGENT_SPAWN_TOOL_NAME,
    displayName: 'Agent',
    description: [
      'Launch a new agent to handle complex, multi-step tasks. Each agent type has its own tools and its own model.',
      '',
      'The agent types this session can run are listed in your context, each with what it is for and what it can use. Pass one of those as `subagent_type`. ListAgents resolves a selector that came back unknown, and carries the contracts in full.',
      '',
      '## When to use',
      '',
      "A fresh agent costs more than it looks. It knows only what you put in the prompt, and you see only the summary it sends back — both handoffs drop detail, and neither of you can tell what the other missed. You can't watch it work, only wait or stop it. Its mistakes come back in the same confident register as its findings, and an agent handed your hypothesis tends to return it confirmed. Several at once spend tokens in a burst the user didn't ask for. Weigh those tokens against the accuracy they buy: the user pays for agents you did not need, and pays again for work you redo because you skipped one.",
      '',
      "Reach for this when you have independent work to run in parallel, when the user asks for a side quest that shouldn't block your main thread, or when answering would mean reading across several files — delegate that and you keep the conclusion, not the file dumps.",
      '',
      "Do the work yourself when it is a handful of tool calls or a lookup whose target you already know; don't delegate a check you could run inline. Delegate review only when you want a read that isn't anchored on yours — then give it the code, not your conclusion. Once you've delegated something, don't also run it yourself; wait for the result. When in doubt, don't spawn.",
      '',
      'When you do spawn one, brief it like the peer it is: state the goal and what you have already ruled out, point it at the files and docs worth reading instead of retyping them, and keep the scope explicit and narrow. That brief is the only context it will have, so it is your one lever on every cost above — and if you cannot write a clear one, you do not understand the task well enough to hand it off.',
      '',
      '- The child sees nothing of this conversation and cannot ask you or the user anything, so write `prompt` as the whole brief.',
      "- `description` is the 3-5 word label a person reads while the child runs; it is not part of the child's brief.",
      "- Agents run in the background: this returns an ID as soon as the child is running, and you'll be notified when it finishes. Never fabricate or predict a pending agent's results — the notification is never something you write yourself; if the user asks before it arrives, say it is still running.",
      "- Don't duplicate a running agent's work: stay off the files and topics it is using.",
      '- Use SendMessage with the agent ID to continue it with its context intact; a new Agent call starts a fresh one. End one early with TaskStop.',
      "- The agent's final report is not shown to the user — relay what matters in your own words.",
      '- Each agent carries its own model, so `model` is accepted and ignored; the result says so when you pass one.',
      '- `write_back` and `isolation` must match the contract the selected agent declares and ListAgents shows; a mismatch is rejected before any child starts, and `isolation: "worktree"` fails closed while no worktree executor exists.',
      '- Returns the ID to send messages to, stop, or read with AgentOutput. The result carries nothing the child produced: none of it exists yet.',
      '- Fails when `subagent_type` is unknown or unavailable, which ListAgents resolves, and when this session has no child-agent capability at all; that one repeats on retry, so do the task with the tools you already have.',
    ].join('\n'),
    parameters: z
      .object({
        subagent_type: z
          .string({ error: () => missingSelectorMessage })
          .min(1)
          .max(128)
          // Preset ids are per user and cannot be enumerated in a frozen
          // schema, but the built-in profiles this composition can actually
          // run can — and naming them is what keeps a wrong selector out of
          // the catalog lookup in the first place.
          .describe(
            'The type of specialized agent to use for this task, from the agent types listed ' +
              `in your context. Built-in profiles available here: ${profiles.join(', ')}.`,
          ),
        description: z
          .string()
          .min(1)
          .max(AGENT_DESCRIPTION_MAX_CHARS)
          .describe('A short (3-5 word) description of the task'),
        prompt: z.string().min(1).max(60_000).describe('The task for the agent to perform'),
        model: z
          .string()
          .min(1)
          .max(AGENT_MODEL_MAX_CHARS)
          .optional()
          .describe(
            'Optional model override. Every agent here carries its own model, so this is accepted and ignored.',
          ),
        write_back: z
          .enum(AGENT_SPAWN_WRITE_BACK_MODES)
          .optional()
          .describe(
            'Requested child write-back mode. Each built-in profile declares its supported modes.',
          ),
        isolation: z
          .enum(AGENT_SPAWN_ISOLATION_MODES)
          .optional()
          .describe(
            'Requested child workspace isolation. Worktree profiles fail closed until a worktree child executor is available.',
          ),
      })
      .strip()
      .superRefine((input, ctx) => {
        if (!isLegacyProfile(input.subagent_type)) {
          if (isUnavailableBuiltinProfile(input.subagent_type)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['subagent_type'],
              message:
                `Agent profile "${input.subagent_type}" is not runnable in this composition. ` +
                `Available built-in profiles: ${profiles.join(', ')}.`,
            });
            return;
          }
          if (!isSafeSubagentPresetId(input.subagent_type)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['subagent_type'],
              message:
                'subagent_type is not a well-formed preset id. Call ListAgents and pass a returned ' +
                `subagent_id, or one built-in profile: ${profiles.join(', ')}.`,
            });
          }
          return;
        }
        const definition = requireAgentDefinitionByProfile(definitions, input.subagent_type);
        const requestedWriteBack = input.write_back ?? definition.contract.defaultWriteBack;
        if (!definition.contract.supportedWriteBack.some((mode) => mode === requestedWriteBack)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['write_back'],
            message: `Agent profile "${definition.profile}" does not support write_back "${requestedWriteBack}".`,
          });
        }
        const requestedIsolation = input.isolation ?? definition.contract.workspace;
        if (requestedIsolation !== definition.contract.workspace) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['isolation'],
            message: `Agent profile "${definition.profile}" requires isolation "${definition.contract.workspace}", not "${requestedIsolation}".`,
          });
        }
      }),
    categoryHint: 'subagent',
    impl: async (input, ctx) => {
      const preset = isLegacyProfile(input.subagent_type) ? undefined : input.subagent_type;
      const definition = preset
        ? await resolvePresetDefinition(preset, ctx, definitions)
        : requireAgentDefinitionByProfile(definitions, input.subagent_type);
      const requestedWriteBack = input.write_back ?? definition.contract.defaultWriteBack;
      if (!definition.contract.supportedWriteBack.some((mode) => mode === requestedWriteBack)) {
        throw new Error(
          `Agent profile "${definition.profile}" does not support write_back "${requestedWriteBack}".`,
        );
      }
      const requestedIsolation = input.isolation ?? definition.contract.workspace;
      if (requestedIsolation !== definition.contract.workspace) {
        throw new Error(
          `Agent profile "${definition.profile}" requires isolation "${definition.contract.workspace}", not "${requestedIsolation}".`,
        );
      }
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
            ...(preset ? { subagentId: preset } : {}),
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
    // A silently ignored argument is a lie the caller repeats. The durable
    // result stays the canonical subagent shape; the note rides on the model's
    // view of it, and only when a model override was actually asked for.
    toModelOutput: ({ input, output }) => {
      const result = output as { kind?: string; childSessionId?: string; agentName?: string };
      if (result?.kind !== 'subagent' || typeof result.childSessionId !== 'string') {
        return undefined;
      }
      const model = (input as { model?: unknown } | null)?.model;
      const ignored =
        typeof model === 'string' && model.trim() !== ''
          ? ` The agent carries its own model, so "${model}" was not applied.`
          : '';
      return {
        type: 'text',
        value: startedChildAgentText(result.childSessionId, ignored),
      };
    },
  };
}

async function resolvePresetDefinition(
  subagentId: string,
  ctx: MakaToolContext,
  definitions: readonly AgentDefinition[],
): Promise<AgentDefinition> {
  if (!ctx.listChildAgents) {
    throw new Error('listChildAgents capability is unavailable in this runtime context');
  }
  const catalog = await ctx.listChildAgents();
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('ListAgents returned an invalid catalog');
  }
  const presets = (catalog as { presets?: unknown }).presets;
  if (!Array.isArray(presets)) throw new Error('Configured subagent catalog is unavailable');
  const preset = presets.find(
    (candidate): candidate is { id: string; profile: string; availability?: { status?: string } } =>
      Boolean(candidate) &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as { id?: unknown }).id === subagentId &&
      typeof (candidate as { profile?: unknown }).profile === 'string',
  );
  if (!preset) throw new Error(`Unknown subagent_id "${subagentId}". Call ListAgents first.`);
  if (preset.availability?.status !== 'available') {
    throw new Error(`Subagent preset "${subagentId}" is unavailable.`);
  }
  return requireAgentDefinitionByProfile(definitions, preset.profile);
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
export function startedChildAgentText(agentId: string, trailer = ''): string {
  return (
    `Agent running in the background with ID: ${agentId}. ` +
    'You will be notified when it finishes; until then you know nothing about its results. ' +
    'To continue it with its context intact, use SendMessage with that ID; to end it, use TaskStop.' +
    trailer
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

export function buildSubagentListTool(): MakaTool<
  { view?: 'selection' | 'catalog'; cursor?: string },
  unknown
> {
  return {
    name: AGENT_LIST_TOOL_NAME,
    displayName: 'Agent List',
    description: [
      'The agent catalog in full. The types you can launch are already listed in your context, so reach for this when that is not enough: a selector came back unknown or unavailable, you need the contracts behind an entry, or a graph tool needs an id.',
      '',
      '- Each entry carries the id, its description, the model behind it, and the workspace and write-back contract Agent will hold you to. Match a task to a description, never to a name.',
      '- The ids are not interchangeable: subagent_id is what Agent takes as subagent_type and UpdateAgentGraph as target_kind=new_preset, agent_id goes to UpdateAgentGraph as target_kind=new_agent, and a built-in profile is also a valid Agent subagent_type.',
      '- The default selection view lists only what is runnable. view=catalog adds the unavailable entries and the reason each is unavailable — read it to diagnose a rejected selector, not to pick from.',
      '- One page per call; a response carrying next_cursor has more entries behind it.',
      '- It reports no execution history at all. What a child did is read with AgentOutput, using the ids Agent or the graph returned.',
      '- Fails when the session exposes no agent catalog; that repeats on retry, so pick one of the types listed in your context instead.',
    ].join('\n'),
    parameters: z
      .object({
        view: z
          .enum(['selection', 'catalog'])
          .default('selection')
          .describe(
            'selection lists runnable choices; catalog also includes unavailable choices and reasons.',
          ),
        cursor: z
          .string()
          .regex(/^\d+$/)
          .optional()
          .describe('next_cursor returned by the previous ListAgents page.'),
      })
      .strip(),
    categoryHint: 'read',
    impl: async (input, ctx) => {
      // Runtime Host supplies this capability to production clients. Keep the
      // failure explicit at the embedding boundary.
      if (!ctx.listChildAgents) {
        throw new Error(
          'ListAgents is not available in this session, so no agent catalog could be read. ' +
            'Retrying ListAgents will fail the same way — pick one of the agent types listed in your context instead.',
          { cause: new Error('listChildAgents capability is unavailable in this runtime context') },
        );
      }
      return projectAgentList(await ctx.listChildAgents(), input);
    },
  };
}

function projectAgentList(
  catalog: unknown,
  input: { view?: 'selection' | 'catalog'; cursor?: string },
): unknown {
  // The host capability remains a rich control-plane projection because spawn
  // and swarm resolve presets through it. Only the model-facing list is narrowed.
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('ListAgents returned an invalid catalog');
  }
  const raw = catalog as Record<string, unknown>;
  const definitions = Array.isArray(raw.definitions) ? raw.definitions : [];
  const definitionByProfile = new Map<string, Record<string, unknown>>();
  for (const candidate of definitions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const definition = candidate as Record<string, unknown>;
    if (typeof definition.profile === 'string') {
      definitionByProfile.set(definition.profile, definition);
    }
  }

  const view = input.view ?? 'selection';
  const presets = (Array.isArray(raw.presets) ? raw.presets : [])
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const preset = candidate as Record<string, unknown>;
      if (
        typeof preset.id !== 'string' ||
        typeof preset.name !== 'string' ||
        typeof preset.description !== 'string' ||
        typeof preset.profile !== 'string' ||
        typeof preset.model !== 'string'
      ) {
        return [];
      }
      const availability = effectivePresetAvailability(
        preset,
        definitionByProfile.get(preset.profile),
      );
      return [
        {
          subagent_id: preset.id,
          name: boundedCatalogText(preset.name, 128),
          description: boundedCatalogText(preset.description, AGENT_LIST_DESCRIPTION_MAX_CHARS),
          profile: preset.profile,
          model: boundedCatalogText(preset.model, AGENT_LIST_MODEL_MAX_CHARS),
          ...(typeof preset.thinkingLevel === 'string'
            ? { thinking_level: boundedCatalogText(preset.thinkingLevel, 32) }
            : {}),
          ...availability,
        },
      ];
    })
    .filter((preset) => view === 'catalog' || preset.status === 'available');

  const offset = Math.min(Number.parseInt(input.cursor ?? '0', 10), presets.length);
  const pagePresets = presets.slice(offset, offset + AGENT_LIST_PAGE_SIZE);
  const legacyProfiles = definitions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const definition = candidate as Record<string, unknown>;
    if (
      typeof definition.id !== 'string' ||
      typeof definition.profile !== 'string' ||
      typeof definition.name !== 'string' ||
      typeof definition.description !== 'string'
    ) {
      return [];
    }
    const availability = catalogAvailability(definition.availability);
    if (view === 'selection' && availability.status !== 'available') return [];
    const contract =
      definition.contract &&
      typeof definition.contract === 'object' &&
      !Array.isArray(definition.contract)
        ? (definition.contract as Record<string, unknown>)
        : undefined;
    return [
      {
        agent_id: definition.id,
        profile: definition.profile,
        name: boundedCatalogText(definition.name, 128),
        description: boundedCatalogText(definition.description, AGENT_LIST_DESCRIPTION_MAX_CHARS),
        ...(typeof contract?.workspace === 'string'
          ? { workspace: boundedCatalogText(contract.workspace, 32) }
          : {}),
        ...(typeof contract?.defaultWriteBack === 'string'
          ? { write_back: boundedCatalogText(contract.defaultWriteBack, 32) }
          : {}),
        ...availability,
      },
    ];
  });

  const buildPage = () => {
    const nextOffset = offset + pagePresets.length;
    return {
      presets: pagePresets,
      legacy_profiles: legacyProfiles,
      page: {
        returned: pagePresets.length,
        total: presets.length,
        ...(nextOffset < presets.length ? { next_cursor: String(nextOffset) } : {}),
      },
      view,
    };
  };
  while (
    pagePresets.length > 1 &&
    JSON.stringify(buildPage()).length > AGENT_LIST_MAX_RESPONSE_CHARS
  ) {
    pagePresets.pop();
  }
  return buildPage();
}

function effectivePresetAvailability(
  preset: Record<string, unknown>,
  definition: Record<string, unknown> | undefined,
): { status: 'available' } | { status: 'unavailable'; reason: string } {
  const presetAvailability = catalogAvailability(preset.availability);
  if (presetAvailability.status === 'unavailable') return presetAvailability;
  if (!definition) return { status: 'unavailable', reason: 'unknown_profile' };
  const definitionAvailability = catalogAvailability(definition.availability);
  if (definitionAvailability.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: `profile_${definitionAvailability.reason}`,
    };
  }
  return { status: 'available' };
}

function catalogAvailability(
  value: unknown,
): { status: 'available' } | { status: 'unavailable'; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'unavailable', reason: 'availability_unknown' };
  }
  const availability = value as Record<string, unknown>;
  if (availability.status === 'available') return { status: 'available' };
  return {
    status: 'unavailable',
    reason:
      typeof availability.reason === 'string'
        ? boundedCatalogText(availability.reason, 120)
        : 'availability_unknown',
  };
}

function boundedCatalogText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
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
    description: [
      'Read what one child agent produced, bounded. Use it after Agent returns, or once SwarmStatus or ViewAgentGraph shows a graph item completed, to get the answer itself rather than the trace that produced it.',
      '',
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
            .describe('Linked child Session id. Without run_id, inspects its latest AgentRun.'),
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

export function buildSubagentProjectionTools(): MakaTool[] {
  return [buildSubagentListTool(), buildSubagentOutputTool()];
}

/**
 * Another message for an agent this session already started.
 *
 * The child keeps its own Session, so a message here is a new Turn of it: it
 * answers with everything it learned the first time. Like the first brief, the
 * answer comes back as a notification, not as this tool's result.
 */
export function buildSendMessageToChildAgentTool(): MakaTool<{
  agent_id: string;
  message: string;
}> {
  return {
    name: TOOL_NAMES.sendMessage,
    // It starts a Turn of a child agent, so it belongs to the same category as
    // Agent: the same permission class, and the same per-Turn cap on how many
    // children one Turn may set running.
    categoryHint: 'subagent',
    description: [
      'Send a message to an agent this session started, continuing it with its context intact.',
      '',
      '- `agent_id` is the ID the Agent tool returned.',
      '- The agent picks up where it left off; a new Agent call would instead start one that knows nothing.',
      '- It runs in the background like the first brief: you are notified when it finishes, and you know nothing about its answer until then.',
      '- Only agents of the current session can be continued, and only one message at a time: an agent that is still working rejects a second one.',
    ].join('\n'),
    parameters: z.object({
      agent_id: z.string().min(1).max(256).describe('The ID the Agent tool returned'),
      message: z.string().min(1).max(60_000).describe('What to tell the agent'),
    }),
    impl: async (input, ctx) => {
      if (!ctx.sendChildAgentMessage) {
        throw new Error(
          'SendMessage is not available in this session, so no agent was continued. ' +
            'Retrying SendMessage will fail the same way — start a fresh agent with Agent instead.',
        );
      }
      const started = projectStartedChildAgent(
        await ctx.sendChildAgentMessage({
          childSessionId: input.agent_id,
          text: input.message,
        }),
      );
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
      const result = output as { childSessionId?: string };
      if (typeof result?.childSessionId !== 'string') return undefined;
      return {
        type: 'text',
        value:
          `Message delivered; the agent is running again with ID: ${result.childSessionId}. ` +
          'You will be notified when it finishes.',
      };
    },
  };
}

export function buildParentAgentTools(
  deps: { definitions?: readonly AgentDefinition[] } = {},
): MakaTool[] {
  const definitions = deps.definitions ?? BUILTIN_AGENT_DEFINITIONS;
  return [
    ...(definitions.length > 0
      ? [buildSubagentSpawnTool({ ...deps, definitions }), buildSendMessageToChildAgentTool()]
      : []),
    ...buildSubagentProjectionTools(),
  ];
}
