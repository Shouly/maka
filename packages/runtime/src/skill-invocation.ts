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

import {
  INLINE_REFERENCE_LABEL_MAX_LENGTH,
  INLINE_REFERENCE_MAX_COUNT,
  type InlineReference,
} from '@maka/core/events';
import { SKILL_INVOCATION_TOKEN_SOURCE } from '@maka/core/skill-invocation-token';
import { gateSkillsByHostCapabilities, type HostCapabilities } from './skills-context.js';
import { scanSkills, type ScannedSkill, type SkillSource } from './skills-discovery.js';

/**
 * A user naming a skill as `/<name>` (the grammar is
 * `SKILL_INVOCATION_TOKEN_SOURCE` in `@maka/core`). Nothing is loaded when the
 * message is sent: the text reaches the model as written, and the model loads
 * the skill with the Skill tool, whose description says a `/<name>` is a
 * request to invoke it. What remains here is what clients and the Host need
 * around that text — which skills can be named, and which tokens in a sent
 * message name one, so the transcript can draw them as chips.
 */

/** Slim, display-ready view of one skill the current host can actually load. */
export interface InvocableSkillEntry {
  /** Stable scope-aware identity. */
  ref: string;
  id: string;
  name: string;
  description: string;
}

export { SKILL_INVOCATION_TOKEN_SOURCE };

/**
 * List the skills a host can invoke right now: enabled after scanning the
 * given source, and eligible under the host-capability gate when `host` is
 * provided. This is the same set the `Skill` tool can load from. The Host's
 * `skill.catalog.invocable.query` answers the same question for its clients.
 */
export async function listInvocableSkills(
  source: SkillSource,
  host?: HostCapabilities,
): Promise<InvocableSkillEntry[]> {
  return invocableSkills(await scanSkills(source), host).map((skill) => ({
    ref: skill.ref,
    id: skill.id,
    name: skill.name,
    description: skill.description,
  }));
}

/**
 * The `/<name>` tokens in a sent message that name a skill this host can
 * load, as inline references for the transcript. A token names a skill by id
 * first, then by display name; one that names nothing — a path, a typo, a
 * disabled skill — stays plain text. A token is a whole word, so a sentence's
 * own punctuation glued to it (`/pdf,` or `/pdf.`) keeps it text; only the
 * chip is lost, the model still reads the words as written.
 */
export function skillInlineReferences(input: {
  readonly text: string;
  readonly inventory: readonly ScannedSkill[];
  readonly host?: HostCapabilities;
}): InlineReference[] {
  if (!input.text.includes('/')) return [];
  const byId = new Map<string, ScannedSkill>();
  const byName = new Map<string, ScannedSkill>();
  for (const skill of invocableSkills(input.inventory, input.host)) {
    const id = skill.id.toLowerCase();
    const name = skill.name.toLowerCase();
    if (!byId.has(id)) byId.set(id, skill);
    if (!byName.has(name)) byName.set(name, skill);
  }
  const references: InlineReference[] = [];
  for (const match of input.text.matchAll(new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, 'g'))) {
    if (references.length === INLINE_REFERENCE_MAX_COUNT) break;
    const key = match[1].toLowerCase();
    const skill = byId.get(key) ?? byName.get(key);
    if (!skill) continue;
    references.push({
      kind: 'skill',
      value: match[0],
      label: truncateWithoutSplittingSurrogate(skill.name, INLINE_REFERENCE_LABEL_MAX_LENGTH),
      start: match.index,
    });
  }
  return references;
}

function invocableSkills(
  inventory: readonly ScannedSkill[],
  host: HostCapabilities | undefined,
): ScannedSkill[] {
  const enabled = inventory.filter((skill) => skill.enabled && !skill.shadowedBy);
  return host
    ? gateSkillsByHostCapabilities(enabled, host).filter((skill) => skill.eligible)
    : enabled;
}

function truncateWithoutSplittingSurrogate(value: string, maxCodeUnits: number): string {
  const truncated = value.slice(0, maxCodeUnits);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? truncated.slice(0, -1) : truncated;
}
