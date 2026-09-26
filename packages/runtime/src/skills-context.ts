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

import { isAbsolute } from 'node:path';
import { cleanPromptText, truncateCodepoints } from './skills-metadata.js';
import { MAX_SKILL_TOOL_BODY_CHARS } from './skills-metadata.js';
import {
  scanSkills,
  scanSkillsWithDiagnostics,
  type RuntimeSkillDefinition,
  type ScannedSkill,
  type SkillDiscoverySource,
  type SkillScanResult,
  type SkillScope,
  type SkillSource,
} from './skills-discovery.js';
import type { MakaToolContext } from './tool-runtime.js';

/**
 * Skill context selection, host-capability gating, prompt rendering, and
 * bounded lexical search.
 *
 * Depends on {@link skills-discovery} for scanning and {@link skills-metadata}
 * for shared text helpers.
 */

// ── Limits ───────────────────────────────────────────────────────────────

/**
 * Backward-compatible fallback when the selected model context window is unknown.
 * See `docs/skill-catalog-policy.md` for ordering, eligibility, and omitted
 * skill lazy-loading semantics.
 */
export const MAX_SKILLS_PROMPT_CHARS = 18000;
export const MIN_SKILLS_PROMPT_TOKENS = 4_000;
export const MAX_SKILLS_PROMPT_TOKENS = 8_000;
export const SKILLS_PROMPT_CONTEXT_RATIO = 0.02;
const SKILLS_PROMPT_CHARS_PER_TOKEN = 4;
export const SKILL_SEARCH_RESULT_LIMIT = 8;

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Host capability surface used to gate which skills a host can advertise or
 * load. `toolNames` is the set of tool names registered on the host;
 * `capabilities` is an optional set of host capability tags.
 */
export interface HostCapabilities {
  toolNames: ReadonlySet<string>;
  capabilities?: ReadonlySet<string>;
}

export function buildHostCapabilitiesFromBinding(
  boundToolNames: Iterable<string>,
): HostCapabilities {
  return Object.freeze({ toolNames: new Set(boundToolNames) });
}

/** Resolves the capability surface for the session executing a Skill call. */
export type HostCapabilitiesResolver = (
  context: Pick<MakaToolContext, 'sessionId' | 'cwd'>,
) => HostCapabilities;

export interface SkillCatalogBudgetOptions {
  /** Selected model context window in tokens. Uses the legacy fixed budget when unknown. */
  contextWindow?: number;
}

/**
 * Per-skill host-compatibility verdict produced by {@link gateSkillsByHostCapabilities}.
 * `missingDeclaredTools` is informational only (a hint); an explicit
 * `requiredTools` / `requiredCapabilities` mismatch hard-hides via `hiddenReason`.
 */
export interface SkillHostCompatibility {
  eligible: boolean;
  hiddenReason?: 'required_tools_missing' | 'required_capabilities_missing';
  missingDeclaredTools: string[];
}

/** A scanned skill annotated with its host-compatibility verdict. */
export type GatedSkill = ScannedSkill & SkillHostCompatibility;

export type SkillContextDecisionReason =
  | 'advertised'
  | 'disabled'
  | 'invalid'
  | 'host_incompatible'
  | 'shadowed'
  | 'budget';

export interface SkillContextDecision {
  ref: string;
  id: string;
  name: string;
  scope: SkillScope;
  source: SkillDiscoverySource;
  reason: SkillContextDecisionReason;
  rank?: number;
  chars?: number;
  shadowedBy?: string;
}

export interface SkillSelectionReport {
  policyVersion: 1;
  budgetChars: number;
  usedChars: number;
  totalCount: number;
  eligibleCount: number;
  advertisedCount: number;
  omittedCount: number;
  decisions: SkillContextDecision[];
}

export interface SkillContextSelection {
  advertised: ScannedSkill[];
  report: SkillSelectionReport;
}

export interface SkillsPromptFragmentResult {
  text?: string;
  report: SkillSelectionReport;
}

/** A skill the catalog offers that is not installed here: a bundled one or an imported source. */
export interface InstallableSkillEntry {
  id: string;
  name: string;
  description: string;
}

/** What SearchSkills searches: every installed skill, and what could be installed. */
export interface SkillSearchCatalog {
  inventory: readonly ScannedSkill[];
  installable?: readonly InstallableSkillEntry[];
}

/** One SearchSkills result, in the reference's shape. */
export interface SkillSearchMatch {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

/** The SearchSkills answer: at most {@link SKILL_SEARCH_RESULT_LIMIT} matches, best first. */
export interface SkillSearchResult {
  results: SkillSearchMatch[];
}

export interface LoadedSkillInstructions {
  ref: string;
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  source: SkillDiscoverySource;
  declaredTools: string[];
  /**
   * The skill's own directory, absolute: SKILL.md's relative paths (scripts,
   * references) resolve against it. Absent for a skill with no directory on
   * disk, such as one a plugin registers.
   */
  baseDirectory?: string;
  instructions: string;
  truncated: boolean;
}

export type LoadSkillInstructionsResult =
  | { ok: true; skill: LoadedSkillInstructions }
  | {
      ok: false;
      reason: 'invalid_name' | 'not_found' | 'disabled' | 'host_incompatible';
      availableSkills: Array<Pick<RuntimeSkillDefinition, 'id' | 'name' | 'description'>>;
    };

// ── Prompt rendering ──────────────────────────────────────────────────────

// The listing the reference harness delivers: one header, a blank line, then
// one line per skill — the name the Skill tool takes, a colon, its
// description. Nothing else; the rules for using skills live in the prompt.
const SKILLS_PROMPT_INTRO = ['The following skills are available for use with the Skill tool:', ''];

function renderSkillCatalogBlock(skill: ScannedSkill): string {
  return `\n- ${cleanPromptText(skill.id)}: ${cleanPromptText(skill.description) || '(no description)'}`;
}

function renderOmittedSkillsNotice(count: number): string {
  return count > 0
    ? `\n\n${count} more ${count === 1 ? 'skill is' : 'skills are'} available but not listed here; find one with SearchSkills and load it with Skill.`
    : '';
}

// ── Public API: budget ────────────────────────────────────────────────────

export function resolveSkillsPromptCharBudget(options?: SkillCatalogBudgetOptions): number {
  const contextWindow = options?.contextWindow;
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return MAX_SKILLS_PROMPT_CHARS;
  }
  const tokenBudget = Math.min(
    MAX_SKILLS_PROMPT_TOKENS,
    Math.max(MIN_SKILLS_PROMPT_TOKENS, Math.floor(contextWindow * SKILLS_PROMPT_CONTEXT_RATIO)),
  );
  return tokenBudget * SKILLS_PROMPT_CHARS_PER_TOKEN;
}

// ── Public API: gating ────────────────────────────────────────────────────

export function gateSkillsByHostCapabilities(
  skills: ScannedSkill[],
  host: HostCapabilities,
): GatedSkill[] {
  const caps = host.capabilities ?? new Set<string>();
  const bound = (tool: string): boolean => host.toolNames.has(tool);
  return skills.map((skill) => {
    const missingDeclaredTools = skill.declaredTools.filter((tool) => !bound(tool));
    const requiredTools = skill.requiredTools;
    const requiredToolsMissing = requiredTools.some((tool) => !bound(tool));
    const requiredCapabilitiesMissing = skill.requiredCapabilities.some((cap) => !caps.has(cap));
    const eligible = !requiredToolsMissing && !requiredCapabilitiesMissing;
    const hiddenReason: SkillHostCompatibility['hiddenReason'] = requiredToolsMissing
      ? 'required_tools_missing'
      : requiredCapabilitiesMissing
        ? 'required_capabilities_missing'
        : undefined;
    return { ...skill, eligible, hiddenReason, missingDeclaredTools };
  });
}

// ── Public API: context selection ────────────────────────────────────────

/** Pure, deterministic projection from one inventory to the model-visible catalog. */
export function selectSkillsForContext(
  inventory: readonly ScannedSkill[],
  host?: HostCapabilities,
  budgetOptions?: SkillCatalogBudgetOptions,
): SkillContextSelection {
  const promptCharBudget = resolveSkillsPromptCharBudget(budgetOptions);
  const gated = host
    ? gateSkillsByHostCapabilities([...inventory], host)
    : inventory.map((skill) => ({
        ...skill,
        eligible: true,
        hiddenReason: undefined,
        missingDeclaredTools: [] as string[],
      }));
  const decisions: SkillContextDecision[] = [];
  const eligible = gated
    .filter((skill) => {
      if (skill.shadowedBy) {
        decisions.push(skillContextDecision(skill, 'shadowed'));
        return false;
      }
      if (!skill.enabled) {
        decisions.push(skillContextDecision(skill, 'disabled'));
        return false;
      }
      if (!skill.eligible) {
        decisions.push(skillContextDecision(skill, 'host_incompatible'));
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        a.precedence - b.precedence ||
        a.name.localeCompare(b.name) ||
        a.ref.localeCompare(b.ref),
    );

  const advertised: ScannedSkill[] = [];
  const omitted: ScannedSkill[] = [];
  const blockChars = new Map<string, number>();
  let usedChars = eligible.length > 0 ? SKILLS_PROMPT_INTRO.join('\n').length : 0;
  for (const skill of eligible) {
    const chars = renderSkillCatalogBlock(skill).length;
    blockChars.set(skill.ref, chars);
    if (usedChars + chars <= promptCharBudget) {
      advertised.push(skill);
      usedChars += chars;
    } else {
      omitted.push(skill);
    }
  }

  // Reserve room for a constant-size long-tail notice. Unlike the legacy list
  // of every omitted id, this cannot make the prompt exceed its own budget.
  let notice = renderOmittedSkillsNotice(omitted.length);
  while (advertised.length > 0 && usedChars + notice.length > promptCharBudget) {
    const removed = advertised.pop();
    if (!removed) break;
    omitted.unshift(removed);
    usedChars -= blockChars.get(removed.ref) ?? 0;
    notice = renderOmittedSkillsNotice(omitted.length);
  }
  usedChars += notice.length;

  const advertisedRefs = new Set(advertised.map((skill) => skill.ref));
  let rank = 0;
  for (const skill of eligible) {
    const isAdvertised = advertisedRefs.has(skill.ref);
    decisions.push({
      ...skillContextDecision(skill, isAdvertised ? 'advertised' : 'budget'),
      ...(isAdvertised ? { rank: ++rank, chars: blockChars.get(skill.ref) } : {}),
    });
  }
  decisions.sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.ref.localeCompare(b.ref),
  );

  return {
    advertised,
    report: {
      policyVersion: 1,
      budgetChars: promptCharBudget,
      usedChars,
      totalCount: inventory.length,
      eligibleCount: eligible.length,
      advertisedCount: advertised.length,
      omittedCount: omitted.length,
      decisions,
    },
  };
}

/** Select a complete scan and include invalid discoveries in the explanation report. */
export function selectSkillScanForContext(
  scan: SkillScanResult,
  host?: HostCapabilities,
  budgetOptions?: SkillCatalogBudgetOptions,
): SkillContextSelection {
  const selection = selectSkillsForContext(scan.inventory, host, budgetOptions);
  if (scan.rejected.length === 0) return selection;
  return {
    advertised: selection.advertised,
    report: {
      ...selection.report,
      totalCount: selection.report.totalCount + scan.rejected.length,
      decisions: [
        ...selection.report.decisions,
        ...scan.rejected.map(
          (skill): SkillContextDecision => ({
            ref: skill.ref,
            id: skill.id,
            name: skill.name,
            scope: skill.scope,
            source: skill.source,
            reason: 'invalid',
          }),
        ),
      ],
    },
  };
}

// ── Public API: prompt fragment ───────────────────────────────────────────

export async function buildSkillsPromptFragmentWithReport(
  source: SkillSource,
  host?: HostCapabilities,
  budgetOptions?: SkillCatalogBudgetOptions,
): Promise<SkillsPromptFragmentResult> {
  const scan = await scanSkillsWithDiagnostics(source);
  const selection = selectSkillScanForContext(scan, host, budgetOptions);
  return renderSkillsPromptSelection(selection);
}

/** Render an already-authoritative inventory without rescanning its backing files. */
export function buildSkillsPromptFragmentFromInventoryWithReport(
  inventory: readonly ScannedSkill[],
  host?: HostCapabilities,
  budgetOptions?: SkillCatalogBudgetOptions,
): SkillsPromptFragmentResult {
  return renderSkillsPromptSelection(selectSkillsForContext(inventory, host, budgetOptions));
}

function renderSkillsPromptSelection(selection: SkillContextSelection): SkillsPromptFragmentResult {
  if (selection.advertised.length === 0 && selection.report.omittedCount === 0) {
    return { report: selection.report };
  }
  const notice = renderOmittedSkillsNotice(selection.report.omittedCount);
  return {
    text: `${SKILLS_PROMPT_INTRO.join('\n')}${selection.advertised
      .map(renderSkillCatalogBlock)
      .join('')}${notice}`,
    report: selection.report,
  };
}

export async function buildSkillsPromptFragment(
  source: SkillSource,
  host?: HostCapabilities,
  budgetOptions?: SkillCatalogBudgetOptions,
): Promise<string | undefined> {
  return (await buildSkillsPromptFragmentWithReport(source, host, budgetOptions)).text;
}

// ── Public API: load instructions ──────────────────────────────────────────

export async function loadSkillInstructions(
  source: SkillSource,
  name: string,
  host?: HostCapabilities,
): Promise<LoadSkillInstructionsResult> {
  return loadSkillInstructionsFromScan(await scanSkills(source), name, host);
}

/**
 * Resolve one skill's full instructions against an already-computed scan.
 * Identical semantics to {@link loadSkillInstructions} — enabled filter, host
 * gate, id-then-name match, body cleaning/truncation — but skips the
 * per-call rescan, so the Host's Skill tool loads from the Turn's inventory.
 */
export function loadSkillInstructionsFromScan(
  skills: ScannedSkill[],
  name: string,
  host?: HostCapabilities,
): LoadSkillInstructionsResult {
  const raw = typeof name === 'string' ? name.trim() : '';
  const enabledSkills = skills.filter((skill) => skill.enabled && !skill.shadowedBy);
  // Gate eligible skills before exposing them as available or loading them.
  // `host === undefined` keeps the legacy no-gating behavior.
  const gated = host
    ? gateSkillsByHostCapabilities(enabledSkills, host)
    : enabledSkills.map((skill) => ({
        ...skill,
        eligible: true,
        hiddenReason: undefined,
        missingDeclaredTools: [] as string[],
      }));
  const eligibleSkills = gated.filter((candidate) => candidate.eligible);
  const availableSkills = eligibleSkills.slice(0, SKILL_SEARCH_RESULT_LIMIT).map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
  }));
  if (raw.length === 0 || raw.length > 512 || /[\u0000-\u001F\u007F]/.test(raw)) {
    return { ok: false, reason: 'invalid_name', availableSkills };
  }

  const normalized = raw.toLowerCase();
  // Match by exact id first, then by name, so a user-level skill whose
  // frontmatter name collides with a project-level skill id does not
  // shadow the higher-precedence id match.
  const skill =
    eligibleSkills.find((candidate) => candidate.ref.toLowerCase() === normalized) ??
    eligibleSkills.find((candidate) => candidate.id.toLowerCase() === normalized) ??
    eligibleSkills.find((candidate) => candidate.name.toLowerCase() === normalized);
  if (skill) {
    const cleaned = cleanPromptText(skill.content).trim();
    const instructions = truncateCodepoints(cleaned || '(empty)', MAX_SKILL_TOOL_BODY_CHARS);
    return {
      ok: true,
      skill: {
        ref: skill.ref,
        id: skill.id,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        source: skill.source,
        declaredTools: skill.declaredTools,
        ...(isAbsolute(skill.path) ? { baseDirectory: skill.path } : {}),
        instructions,
        truncated: Array.from(cleaned || '(empty)').length > MAX_SKILL_TOOL_BODY_CHARS,
      },
    };
  }

  const disabledSkill = skills.find(
    (candidate) =>
      !candidate.shadowedBy &&
      !candidate.enabled &&
      (candidate.ref.toLowerCase() === normalized ||
        candidate.id.toLowerCase() === normalized ||
        candidate.name.toLowerCase() === normalized),
  );
  if (disabledSkill) return { ok: false, reason: 'disabled', availableSkills };

  const hiddenSkill = gated.find(
    (candidate) =>
      !candidate.eligible &&
      (candidate.ref.toLowerCase() === normalized ||
        candidate.id.toLowerCase() === normalized ||
        candidate.name.toLowerCase() === normalized),
  );
  if (hiddenSkill) return { ok: false, reason: 'host_incompatible', availableSkills };

  return { ok: false, reason: 'not_found', availableSkills };
}

// ── Public API: search ────────────────────────────────────────────────────

/** Deterministic, bounded lexical search over the whole catalog: enabled, disabled and installable. */
export function searchSkills(
  catalog: SkillSearchCatalog,
  keywords: readonly string[],
  host?: HostCapabilities,
): SkillSearchResult {
  return skillSearchResult(rankSkillSearchCandidates(catalog, keywords, host));
}

// ── Internal: search ──────────────────────────────────────────────────────

interface SkillSearchCandidate {
  match: SkillSearchMatch;
  /** The installed skill's ref; absent for one that is only installable. */
  ref?: string;
  pinned: boolean;
  precedence: number;
}

export interface RankedSkillSearchCandidates {
  keywords: string[];
  totalCandidates: number;
  ranked: Array<{ candidate: SkillSearchCandidate; score: number }>;
}

/**
 * Rank the whole catalog against the keywords: installed skills, enabled or
 * not, and the bundled and imported ones not installed yet (never enabled).
 * A shadowed copy and a skill this host cannot run are not offered — neither
 * can be used here. Every keyword adds to a candidate's score; a candidate no
 * keyword touches is not a match.
 */
export function rankSkillSearchCandidates(
  catalog: SkillSearchCatalog,
  keywords: readonly string[],
  host?: HostCapabilities,
): RankedSkillSearchCandidates {
  const normalized = [
    ...new Set(keywords.map(normalizeSkillSearchText).filter((keyword) => keyword.length > 0)),
  ];
  const installed = (
    host
      ? gateSkillsByHostCapabilities([...catalog.inventory], host).filter((skill) => skill.eligible)
      : [...catalog.inventory]
  ).filter((skill) => !skill.shadowedBy);
  // Installed ids, every copy included: an installable entry with one of them
  // is already here (or shadowed, or unusable here), so it is not offered.
  const offeredIds = new Set(catalog.inventory.map((skill) => skill.id.toLowerCase()));
  const candidates: SkillSearchCandidate[] = [
    ...installed.map((skill) => ({
      match: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
      },
      ref: skill.ref,
      pinned: skill.pinned,
      precedence: skill.precedence,
    })),
    ...(catalog.installable ?? [])
      .filter((entry) => {
        const id = entry.id.toLowerCase();
        if (offeredIds.has(id)) return false;
        offeredIds.add(id);
        return true;
      })
      .map((entry) => ({
        match: { id: entry.id, name: entry.name, description: entry.description, enabled: false },
        pinned: false,
        precedence: Number.MAX_SAFE_INTEGER,
      })),
  ];
  if (normalized.length === 0) {
    return { keywords: [], totalCandidates: candidates.length, ranked: [] };
  }
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: normalized.reduce(
        (sum, keyword) => sum + scoreSkillSearchMatch(candidate, keyword),
        0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.candidate.match.enabled) - Number(a.candidate.match.enabled) ||
        Number(b.candidate.pinned) - Number(a.candidate.pinned) ||
        a.candidate.precedence - b.candidate.precedence ||
        a.candidate.match.name.localeCompare(b.candidate.match.name) ||
        a.candidate.match.id.localeCompare(b.candidate.match.id),
    );
  return { keywords: normalized, totalCandidates: candidates.length, ranked };
}

export function skillSearchResult(ranking: RankedSkillSearchCandidates): SkillSearchResult {
  return {
    results: ranking.ranked
      .slice(0, SKILL_SEARCH_RESULT_LIMIT)
      .map(({ candidate }) => ({ ...candidate.match })),
  };
}

function normalizeSkillSearchText(value: string): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') : '';
}

function scoreSkillSearchMatch(candidate: SkillSearchCandidate, keyword: string): number {
  const name = normalizeSkillSearchText(candidate.match.name);
  const id = normalizeSkillSearchText(candidate.match.id);
  const description = normalizeSkillSearchText(candidate.match.description);
  let score = 0;
  if (name === keyword || id === keyword || candidate.ref?.toLocaleLowerCase() === keyword) {
    score += 1_000;
  }
  if (name.startsWith(keyword) || id.startsWith(keyword)) score += 240;
  if (name.includes(keyword) || id.includes(keyword)) score += 160;
  if (description.includes(keyword)) score += 80;
  const terms = keyword
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .slice(0, 24);
  for (const term of terms) {
    if (name.includes(term) || id.includes(term)) score += 40;
    if (description.includes(term)) score += 12;
  }
  // A pin is not scored: the ranking's comparator uses it to break ties only.
  return score;
}

// ── Internal: decision helper ────────────────────────────────────────────

function skillContextDecision(
  skill: ScannedSkill,
  reason: SkillContextDecisionReason,
): SkillContextDecision {
  return {
    ref: skill.ref,
    id: skill.id,
    name: skill.name,
    scope: skill.scope,
    source: skill.source,
    reason,
    ...(skill.shadowedBy ? { shadowedBy: skill.shadowedBy } : {}),
  };
}
