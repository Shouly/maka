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

import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';
import {
  loadSkillInstructions,
  loadSkillInstructionsFromScan,
  rankSkillSearchCandidates,
  skillSearchResult,
  type HostCapabilities,
  type HostCapabilitiesResolver,
  type LoadedSkillInstructions,
  type LoadSkillInstructionsResult,
  type SkillSearchCatalog,
  type SkillSearchResult,
} from './skills-context.js';
import {
  scanSkillsWithDiagnostics,
  type ScannedSkill,
  type SkillSource,
  type SkillSourceResolver,
} from './skills-discovery.js';
import {
  failedSkillInvocationReceipt,
  loadedSkillInvocationReceipt,
  skillInvocationReceiptTraceData,
} from './skill-invocation-receipt.js';
import type { MakaTool, MakaToolContext } from './tool-runtime.js';

/**
 * Agent-tool builders for the Skill and SearchSkills tools, in the reference
 * harness's shapes (`技能相关工具实测手册`, 2026-09-25).
 *
 * Skill answers in one text result: the reference's `Launching skill: <name>`
 * line, then what the reference injects as the next message — the skill's base
 * directory, the SKILL.md body without its front matter, and `ARGUMENTS:` when
 * arguments were passed. Keeping it in the tool result needs no second message
 * kind; the body is exempt from tool-result archiving instead
 * (`isUnarchivableToolResult`), because the model follows it for the rest of
 * the task.
 *
 * Depends on {@link skills-context} for instruction loading and search
 * ranking, and {@link skills-discovery} for scanning.
 */

const SKILL_SHADOW_RANK_LIMIT = 20;
const SEARCH_KEYWORD_MAX_CHARS = 64;
const SEARCH_KEYWORDS_MAX = 8;
const SKILL_REINVOCATION_SESSION_LIMIT = 100;

/** Name of the always-on Skill tool, for hosts that bind it before the instance exists. */
export const SKILL_TOOL_NAME = TOOL_NAMES.skill;
export const SKILL_SEARCH_TOOL_NAME = TOOL_NAMES.searchSkills;

export interface SkillToolOptions {
  shadowTracker?: SkillShadowSelectionTracker;
  /** Remembers which skills a session loaded, for the re-invocation line. */
  reinvocationTracker?: SkillReinvocationTracker;
}

export type SkillInventoryResolver = (
  context: Pick<MakaToolContext, 'sessionId' | 'turnId' | 'cwd'>,
) => readonly ScannedSkill[] | Promise<readonly ScannedSkill[]>;

export type SkillSearchCatalogResolver = (
  context: Pick<MakaToolContext, 'sessionId' | 'turnId' | 'cwd'>,
) => SkillSearchCatalog | Promise<SkillSearchCatalog>;

export class SkillShadowSelectionTracker {
  private readonly candidatesByTurn = new Map<string, string[]>();

  record(context: Pick<MakaToolContext, 'sessionId' | 'turnId'>, refs: readonly string[]): void {
    this.candidatesByTurn.set(
      `${context.sessionId}:${context.turnId}`,
      refs.slice(0, SKILL_SHADOW_RANK_LIMIT),
    );
    if (this.candidatesByTurn.size > 100) {
      const first = this.candidatesByTurn.keys().next().value;
      if (typeof first === 'string') this.candidatesByTurn.delete(first);
    }
  }

  observe(
    context: Pick<MakaToolContext, 'sessionId' | 'turnId'>,
    ref: string,
  ): {
    rank?: number;
    candidateCount: number;
    hitAt1: boolean;
    hitAt5: boolean;
    hitAt20: boolean;
  } {
    const key = `${context.sessionId}:${context.turnId}`;
    const candidates = this.candidatesByTurn.get(key) ?? [];
    const index = candidates.indexOf(ref);
    const rank = index >= 0 ? index + 1 : undefined;
    return {
      ...(rank !== undefined ? { rank } : {}),
      candidateCount: candidates.length,
      hitAt1: rank === 1,
      hitAt5: rank !== undefined && rank <= 5,
      hitAt20: rank !== undefined && rank <= 20,
    };
  }
}

/**
 * Which skills each session has loaded through the Skill tool. It lives as
 * long as the tool binding, so a Host restart forgets it and the next load of
 * a skill reads as a first one — the instructions come back in full either way.
 */
export class SkillReinvocationTracker {
  private readonly loadedBySession = new Map<string, Set<string>>();

  /** Record a load; true when this session had already loaded the skill. */
  markLoaded(sessionId: string, ref: string): boolean {
    let loaded = this.loadedBySession.get(sessionId);
    if (!loaded) {
      loaded = new Set();
      this.loadedBySession.set(sessionId, loaded);
      if (this.loadedBySession.size > SKILL_REINVOCATION_SESSION_LIMIT) {
        const oldest = this.loadedBySession.keys().next().value;
        if (typeof oldest === 'string') this.loadedBySession.delete(oldest);
      }
    }
    const seen = loaded.has(ref);
    loaded.add(ref);
    return seen;
  }
}

export interface SkillToolInput {
  skill: string;
  args?: string;
}

/** A loaded skill, as the Skill tool records it; the model reads {@link renderSkillToolResult}. */
export interface SkillToolResult {
  /** The name as the model passed it; the result's first line repeats it. */
  request: string;
  skill: LoadedSkillInstructions;
  args?: string;
  /** This session had loaded the skill before. */
  reinvocation: boolean;
}

const SKILL_TOOL_DESCRIPTION = [
  'Invoke a skill.',
  '',
  'A skill is a packaged set of instructions the user or project has set up for a particular kind of task (deploy steps, a review checklist, a repo-specific workflow). Available skills appear in a system-reminder listing with one-line descriptions. When the task at hand is one a listed skill covers, call this tool first — the skill\'s instructions load into the turn for you to follow in place of your default approach. Users may also ask for one by name (`/<name>`, or "slash command"); that\'s a request to invoke it.',
  '',
  '- `skill`: exact name from the listing, no leading slash.',
  '- `args`: optional arguments to pass through.',
  '',
  "Only names from the listing or an enabled SearchSkills result (or that the user typed explicitly) are valid. Built-in commands (`/help`, `/new`, …) aren't skills.",
].join('\n');

const SEARCH_SKILLS_DESCRIPTION = [
  "Search the user's skills by keyword. Call this when a skill (a reference document or instruction set the user has uploaded or enabled) might help complete the task.",
  '',
  'Examples:',
  '- "follow the team\'s PR guidelines" → keywords ["pr", "review", "guidelines"]',
  '- "export this as a slide deck" → keywords ["pptx", "slides", "presentation"]',
  '',
  'Returns a ranked list with id, name, description, and whether the skill is enabled. When results fit and SuggestSkills is among your tools, call it to render the add card; otherwise relay the relevant results in text instead. If nothing relevant, proceed without mentioning that you searched.',
].join('\n');

/**
 * What the model reads for a loaded skill: `Launching skill: <name>`, then —
 * the reference's injected message — the re-invocation note when this session
 * loaded the skill before, the base directory, the body, and the arguments.
 */
export function renderSkillToolResult(result: SkillToolResult): string {
  const parts = [`Launching skill: ${result.request}`];
  if (result.reinvocation) {
    parts.push(
      `(Re-invocation of /${result.request} — the skill instructions were previously loaded; the arguments or dynamic output below are new.)`,
    );
  }
  if (result.skill.baseDirectory) {
    parts.push(`Base directory for this skill: ${result.skill.baseDirectory}`);
  }
  parts.push(result.skill.instructions);
  if (result.args !== undefined && result.args.trim() !== '') {
    parts.push(`ARGUMENTS: ${result.args}`);
  }
  return parts.join('\n\n');
}

export function buildSkillAgentTool(
  source: SkillSource | SkillSourceResolver,
  host?: HostCapabilities | HostCapabilitiesResolver,
  options: SkillToolOptions = {},
): MakaTool<SkillToolInput, SkillToolResult> {
  return buildSkillAgentToolWithLoader(
    (name, ctx, resolvedHost) =>
      loadSkillInstructions(
        typeof source === 'function' ? source(ctx) : source,
        name,
        resolvedHost,
      ),
    host,
    options,
  );
}

export function buildSkillAgentToolFromInventory(
  resolveInventory: SkillInventoryResolver,
  host?: HostCapabilities | HostCapabilitiesResolver,
  options: SkillToolOptions = {},
): MakaTool<SkillToolInput, SkillToolResult> {
  return buildSkillAgentToolWithLoader(
    async (name, ctx, resolvedHost) =>
      loadSkillInstructionsFromScan([...(await resolveInventory(ctx))], name, resolvedHost),
    host,
    options,
  );
}

function buildSkillAgentToolWithLoader(
  load: (
    name: string,
    context: MakaToolContext,
    host?: HostCapabilities,
  ) => LoadSkillInstructionsResult | Promise<LoadSkillInstructionsResult>,
  host?: HostCapabilities | HostCapabilitiesResolver,
  options: SkillToolOptions = {},
): MakaTool<SkillToolInput, SkillToolResult> {
  return {
    name: SKILL_TOOL_NAME,
    description: SKILL_TOOL_DESCRIPTION,
    parameters: z.object({
      skill: z
        .string()
        .describe('The name of a skill from the available-skills list. Do not guess names.'),
      args: z.string().optional().describe('Optional arguments for the skill'),
    }),
    displayName: SKILL_TOOL_NAME,
    impl: async (input, ctx) => {
      const { args } = input as SkillToolInput;
      const name = (input as SkillToolInput).skill.trim();
      const loaded = await load(name, ctx, typeof host === 'function' ? host(ctx) : host);
      if (!loaded.ok) {
        const receipt = failedSkillInvocationReceipt(name, loaded.reason);
        ctx.emitRunTrace?.('skill_load_failed', 'Skill instructions were not loaded', {
          ...skillInvocationReceiptTraceData(receipt),
        });
        // One answer for every miss, as in the reference: a disabled or
        // host-incompatible skill is not in the listing either.
        throw new Error(`Unknown skill: ${name}`);
      }
      const shadow = options.shadowTracker?.observe(ctx, loaded.skill.ref);
      const receipt = loadedSkillInvocationReceipt(name, loaded.skill);
      ctx.emitRunTrace?.('skill_loaded', 'Skill instructions loaded', {
        ...skillInvocationReceiptTraceData(receipt),
        declaredTools: loaded.skill.declaredTools,
        ...(shadow?.rank !== undefined ? { shadowRank: shadow.rank } : {}),
        ...(shadow
          ? {
              shadowCandidateCount: shadow.candidateCount,
              shadowHitAt1: shadow.hitAt1,
              shadowHitAt5: shadow.hitAt5,
              shadowHitAt20: shadow.hitAt20,
            }
          : {}),
      });
      return {
        request: name,
        skill: loaded.skill,
        ...(args !== undefined ? { args } : {}),
        reinvocation:
          options.reinvocationTracker?.markLoaded(ctx.sessionId, loaded.skill.ref) ?? false,
      };
    },
    toModelOutput: ({ output }) => ({
      type: 'text',
      value: renderSkillToolResult(output as SkillToolResult),
    }),
    errorToModelText: (message) => `<tool_use_error>${message}</tool_use_error>`,
  };
}

export function buildSkillSearchAgentTool(
  source: SkillSource | SkillSourceResolver,
  host?: HostCapabilities | HostCapabilitiesResolver,
  options: SkillToolOptions = {},
): MakaTool<{ keywords: string[] }, SkillSearchResult> {
  return buildSkillSearchAgentToolFromCatalog(
    async (ctx) => {
      const resolvedSource = typeof source === 'function' ? source(ctx) : source;
      return { inventory: (await scanSkillsWithDiagnostics(resolvedSource)).inventory };
    },
    host,
    options,
  );
}

export function buildSkillSearchAgentToolFromCatalog(
  resolveCatalog: SkillSearchCatalogResolver,
  host?: HostCapabilities | HostCapabilitiesResolver,
  options: SkillToolOptions = {},
): MakaTool<{ keywords: string[] }, SkillSearchResult> {
  return {
    name: SKILL_SEARCH_TOOL_NAME,
    description: SEARCH_SKILLS_DESCRIPTION,
    parameters: z.object({
      keywords: z
        .array(z.string().min(1).max(SEARCH_KEYWORD_MAX_CHARS))
        .min(1)
        .max(SEARCH_KEYWORDS_MAX)
        .describe('Keywords for what the user is trying to do, 1–8 of them.'),
    }),
    displayName: SKILL_SEARCH_TOOL_NAME,
    impl: async ({ keywords }, ctx) => {
      const startedAt = performance.now();
      const resolvedHost = typeof host === 'function' ? host(ctx) : host;
      const ranking = rankSkillSearchCandidates(await resolveCatalog(ctx), keywords, resolvedHost);
      const result = skillSearchResult(ranking);
      const rankedRefs = ranking.ranked
        .map(({ candidate }) => candidate.ref)
        .filter((ref): ref is string => ref !== undefined);
      options.shadowTracker?.record(ctx, rankedRefs.slice(0, SKILL_SHADOW_RANK_LIMIT));
      ctx.emitRunTrace?.('skill_searched', 'Skill catalog searched', {
        keywordCount: ranking.keywords.length,
        resultCount: result.results.length,
        matchedCount: ranking.ranked.length,
        totalCandidates: ranking.totalCandidates,
        candidateReductionRatio:
          ranking.totalCandidates > 0
            ? (ranking.totalCandidates - result.results.length) / ranking.totalCandidates
            : 0,
        shadowCandidateCount: Math.min(rankedRefs.length, SKILL_SHADOW_RANK_LIMIT),
        selectionDurationMs: Math.round((performance.now() - startedAt) * 1_000) / 1_000,
        truncated: ranking.ranked.length > result.results.length,
      });
      return result;
    },
  };
}
