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
import { ChildAgentProgressProjector } from './child-agent-progress.js';

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
    'No child selector was provided. Call ListAgents and pass a returned subagent_id as ' +
    `subagent_type, or pass one built-in profile: ${profiles.join(', ')}.`;
  return {
    name: AGENT_SPAWN_TOOL_NAME,
    displayName: 'Agent',
    description: [
      'Launch a new agent to handle complex, multi-step tasks.',
      '',
      'Reach for this when the work is self-contained and what you want back is the conclusion, not everything the child had to read to reach it — a search across many files, a round of research, an implementation slice. Delegate it and you keep the conclusion, not the file dumps. For a single-fact lookup where you already know the file or symbol, look it up yourself. Once you have delegated a search, do not also run it yourself.',
      '',
      '- Call ListAgents first and pass the `subagent_type` whose description fits the task; a built-in profile name is also a valid `subagent_type`.',
      '- The child sees nothing of this conversation, cannot ask you or the user anything, and runs once, so write `prompt` as the whole brief.',
      "- `description` is the 3-5 word label a person reads while the child runs; it is not part of the child's brief.",
      '- The turn waits here until the child finishes.',
      "- The agent's final report is not shown to the user — relay what matters in your own words.",
      '- `write_back` and `isolation` must match the contract the selected agent declares and ListAgents shows; a mismatch is rejected before any child starts, and a worktree agent fails closed while no worktree executor exists.',
      '- Each agent carries its own model, so `model` is accepted and ignored; the result says so when you pass one.',
      '- Returns the child status and summary plus the ids AgentOutput needs for its final text.',
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
            'The type of specialized agent to use for this task, from ListAgents. ' +
              `Built-in profiles available here: ${profiles.join(', ')}.`,
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
      let result: Omit<SubagentToolResult, 'kind'>;
      const progress = new ChildAgentProgressProjector(ctx);
      ctx.emitOutput('stdout', `Starting child agent: ${definition.name}\n`);
      try {
        result = projectSubagentToolResult(
          await ctx.spawnChildSession({
            agentProfile: definition.profile,
            ...(preset ? { subagentId: preset } : {}),
            prompt: input.prompt,
            onEvent: (event) => progress.observe(event),
          }),
        );
      } catch (error) {
        ctx.emitOutput(
          'stderr',
          `Child agent ${definition.name} failed: ${boundedChildError(error)}\n`,
        );
        throw error;
      }
      ctx.emitOutput('stdout', `Child agent ${definition.name}: ${result.status}\n`);
      return {
        kind: 'subagent',
        ...result,
      } satisfies SubagentToolResult;
    },
    // A silently ignored argument is a lie the caller repeats. The durable
    // result stays the canonical subagent shape; the note rides on the model's
    // view of it, and only when a model override was actually asked for.
    toModelOutput: ({ input, output }) => {
      const model = (input as { model?: unknown } | null)?.model;
      if (typeof model !== 'string' || model.trim() === '') return undefined;
      return {
        type: 'json',
        value: {
          ...(output as Record<string, unknown>),
          model_override: `ignored: "${model}" was not applied because the selected agent carries its own model`,
        },
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

function projectSubagentToolResult(value: unknown): Omit<SubagentToolResult, 'kind'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Child agent returned an invalid result');
  }
  const raw = value as Record<string, unknown>;
  const decoded = decodeCanonicalToolResultContent({
    kind: 'subagent',
    ...(raw.childSessionId !== undefined ? { childSessionId: raw.childSessionId } : {}),
    ...(raw.agentId !== undefined ? { agentId: raw.agentId } : {}),
    agentName: raw.agentName,
    turnId: raw.turnId,
    ...(raw.runId !== undefined ? { runId: raw.runId } : {}),
    status: raw.status,
    permissionMode: raw.permissionMode,
    summary: raw.summary,
    artifactIds: raw.artifactIds,
    ...(raw.startedAt !== undefined ? { startedAt: raw.startedAt } : {}),
    ...(raw.completedAt !== undefined ? { completedAt: raw.completedAt } : {}),
    ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs } : {}),
    ...(raw.eventCount !== undefined ? { eventCount: raw.eventCount } : {}),
    ...(raw.failureClass !== undefined ? { failureClass: raw.failureClass } : {}),
  });
  if (decoded.kind !== 'subagent') throw new Error('Child agent returned an invalid result');
  const { kind: _kind, ...result } = decoded as SubagentToolResult;
  return result;
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
      'List the child agents this session can actually run, with the selector each caller needs. Call it before the first delegation and again whenever a selector comes back unknown or unavailable: the catalog is per user and changes between sessions.',
      '',
      '- Match the task to an entry description, not to its name. Each entry carries the id, that description, the model behind it, and the workspace and write-back contract Agent will hold you to.',
      '- The ids are not interchangeable: subagent_id is what Agent takes as subagent_type and UpdateAgentGraph as target_kind=new_preset, agent_id goes to UpdateAgentGraph as target_kind=new_agent, and a built-in profile is also a valid Agent subagent_type.',
      '- The default selection view lists only what is runnable. view=catalog adds the unavailable entries and the reason each is unavailable — read it to diagnose a rejected selector, not to pick from.',
      '- One page per call; a response carrying next_cursor has more entries behind it.',
      '- It reports no execution history at all. What a child did is read with AgentOutput, using the ids Agent or the graph returned.',
      '- Fails when the session exposes no agent catalog; that repeats on retry, so pick a legacy profile from the Agent schema instead.',
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
            'Retrying ListAgents will fail the same way — pick a child agent profile from the Agent schema instead.',
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

export function buildParentAgentTools(
  deps: { definitions?: readonly AgentDefinition[] } = {},
): MakaTool[] {
  const definitions = deps.definitions ?? BUILTIN_AGENT_DEFINITIONS;
  return [
    ...(definitions.length > 0 ? [buildSubagentSpawnTool({ ...deps, definitions })] : []),
    ...buildSubagentProjectionTools(),
  ];
}
