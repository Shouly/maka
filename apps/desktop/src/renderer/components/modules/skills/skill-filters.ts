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

// What the Skills page's toolbar does to the three lists, as pure functions.
//
// Search, the scope/category pills and the sort order are one pipeline —
// filter, then filter, then order — and keeping it out of the component is
// what lets the rules be tested without a DOM: which fields a query reads,
// which rows a pill keeps, and which row a sort puts first.
//
// The searched fields are the ones a user could plausibly type: the display
// name, the slug they see in a collision, the description, and the PATH,
// because "the one under .maka" is how people find the project copy of a
// skill that exists three times.

import {
  skillStatusSemantic,
  type BundledSkillCatalogEntry,
  type ManagedSkillCategory,
  type ManagedSkillSourceEntry,
  type ManagedSkillUpdatePreview,
  type SkillEntry,
} from '@maka/ui';

/**
 * Who a skill came from, as the governance lock records it: no lock means
 * the user wrote the SKILL.md themselves (`workspace`); `bundled` came from
 * Maka's own catalog and `managed` from a configured skill source. It is
 * the "Created by you / From Anthropic" split of Claude's Customize page.
 * The Host's `unknown` (a diagnostic, a file it could not read as a skill)
 * is still a file in the user's own directories, so it is theirs too.
 */
export type SkillOrigin = 'workspace' | 'bundled' | 'managed';
export type SkillOriginFilter = 'all' | SkillOrigin;
export type SkillCategoryFilter = 'all' | ManagedSkillCategory;
export type SkillSort = 'source' | 'name' | 'updates';

/** Section order on the Yours list: the user's own first, the catalogs after. */
export const SKILL_ORIGINS = ['workspace', 'bundled', 'managed'] as const;

/** Trimmed and folded once, so every row is matched against the same string. */
export function normalizeSkillQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true;
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(query));
}

export function skillMatchesQuery(skill: SkillEntry, query: string): boolean {
  return matches(query, skill.name, skill.id, skill.description, skill.path);
}

export function catalogEntryMatchesQuery(entry: BundledSkillCatalogEntry, query: string): boolean {
  return matches(query, entry.name, entry.id, entry.description, entry.category);
}

export function sourceEntryMatchesQuery(entry: ManagedSkillSourceEntry, query: string): boolean {
  return matches(query, entry.name, entry.id, entry.description, entry.category);
}

export function skillOrigin(skill: SkillEntry): SkillOrigin {
  const sourceType = skill.sourceType;
  return sourceType === 'bundled' || sourceType === 'managed' ? sourceType : 'workspace';
}

export function skillOriginCounts(
  skills: readonly SkillEntry[],
): Record<SkillOriginFilter, number> {
  const counts: Record<SkillOriginFilter, number> = {
    all: skills.length,
    workspace: 0,
    bundled: 0,
    managed: 0,
  };
  for (const skill of skills) counts[skillOrigin(skill)] += 1;
  return counts;
}

export function skillMatchesOrigin(skill: SkillEntry, origin: SkillOriginFilter): boolean {
  return origin === 'all' || skillOrigin(skill) === origin;
}

/**
 * The Yours list as sections, one per origin in `SKILL_ORIGINS` order, empty
 * ones left out. Rows keep the order they arrive in, so sorting happens
 * once, before grouping, and holds inside every section. This is the
 * grouping Claude's Customize page does ("Created by you", "From Anthropic")
 * where the old panel had a pill row.
 */
export function groupSkillsByOrigin(
  skills: readonly SkillEntry[],
): { origin: SkillOrigin; skills: SkillEntry[] }[] {
  const groups = SKILL_ORIGINS.map((origin) => ({ origin, skills: [] as SkillEntry[] }));
  for (const skill of skills) {
    groups.find((group) => group.origin === skillOrigin(skill))?.skills.push(skill);
  }
  return groups.filter((group) => group.skills.length > 0);
}

/** The categories the two Discover lists actually offer, in catalog order. */
export function presentCategories(
  catalog: readonly BundledSkillCatalogEntry[],
  sources: readonly ManagedSkillSourceEntry[],
): ManagedSkillCategory[] {
  const seen: ManagedSkillCategory[] = [];
  for (const entry of [...catalog, ...sources]) {
    if (!seen.includes(entry.category)) seen.push(entry.category);
  }
  return seen;
}

/**
 * Which rung of the status ladder a skill sits on, as a sort key.
 *
 * `skillStatusSemantic` already decides which of a skill's several problems
 * wins its one chip; reading the same verdict here is what keeps "needs
 * attention first" agreeing with the chips the user can see.
 */
function attentionRank(skill: SkillEntry): number {
  const semantic = skillStatusSemantic(skill);
  if (semantic === 'error') return 0;
  if (semantic === 'attention') return 1;
  return 2;
}

/**
 * Order a list without ever losing the Host's own order.
 *
 * `source` returns the array as it came: discovery order is meaningful (it is
 * the order the skills are offered to the model) and it is the default. Every
 * other order is a STABLE sort over a copy, so rows that tie keep discovery
 * order rather than shuffling on each render.
 */
export function sortSkills(skills: readonly SkillEntry[], sort: SkillSort): SkillEntry[] {
  if (sort === 'source') return [...skills];
  return [...skills]
    .map((skill, index) => ({ skill, index }))
    .sort((left, right) => {
      const compared =
        sort === 'name'
          ? left.skill.name.localeCompare(right.skill.name)
          : attentionRank(left.skill) - attentionRank(right.skill);
      return compared !== 0 ? compared : left.index - right.index;
    })
    .map((row) => row.skill);
}

/** The catalogs have no status to rank, so anything but `name` is source order. */
export function sortCatalogRows<Row extends { name: string }>(
  rows: readonly Row[],
  sort: SkillSort,
): Row[] {
  if (sort !== 'name') return [...rows];
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = left.row.name.localeCompare(right.row.name);
      return compared !== 0 ? compared : left.index - right.index;
    })
    .map((entry) => entry.row);
}

/**
 * The tool names for a row's meta line: all of them up to `limit`, then a
 * count for the rest. The count alone was the old line's whole content, and
 * "3 tools" never told anyone whether one of them was Bash.
 */
export function summarizeDeclaredTools(
  tools: readonly string[] | undefined,
  limit: number,
  more: (count: number) => string,
): string | undefined {
  if (!tools || tools.length === 0) return undefined;
  if (tools.length <= limit) return tools.join(', ');
  return [...tools.slice(0, limit), more(tools.length - limit)].join(', ');
}

/** A managed skill whose source has moved on — the only rows that can be updated. */
export function skillUpdateReviewable(skill: SkillEntry): boolean {
  return (
    skill.kind !== 'discovery_diagnostic' &&
    (skill.managedUpdateStatus === 'update_available' ||
      skill.managedUpdateStatus === 'local_modified')
  );
}

/**
 * What the apply is allowed to do, derived from the preview the user read.
 *
 * Both digests always go back: they are the Host's check that the source has
 * not moved since the review, and a write that skipped them would land a
 * version nobody saw. `force` is the one thing the dialog asks for — it is
 * set only for `local_modified`, where the user has been told in so many
 * words that their own edits are what gets replaced.
 */
export function managedUpdateOptions(preview: ManagedSkillUpdatePreview): {
  force?: boolean;
  expectedCurrentSha256: string;
  expectedSourceSha256: string;
} {
  return {
    ...(preview.skill.managedUpdateStatus === 'local_modified' ? { force: true } : {}),
    expectedCurrentSha256: preview.expectedCurrentSha256,
    expectedSourceSha256: preview.expectedSourceSha256,
  };
}

/** The Host said it cannot satisfy what this skill requires (`skills-context.ts`). */
export function skillHostIncompatible(skill: SkillEntry): boolean {
  return skill.contextStatus === 'host_incompatible';
}
