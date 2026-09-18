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

/**
 * Shared main-session prompt assembly (#2352, reworked 2026-09-13).
 *
 * The static layer of the system prompt — identity, how to behave, response
 * format, progress updates, how the tools fit together, the workspace, working
 * unattended — is prose, so it lives in Markdown under
 * `packages/runtime/resources/prompts/` and reaches this module through the
 * generated catalog. The assembler prepends those sections in their declared
 * order, then the host's session fragments in the order the host chose.
 *
 * The assembler is deliberately order-agnostic about the host fragments: it
 * drops empty ones and joins. Several are position-semantic and must stay where
 * the host put them — the Side Chat isolation boundary and the Deep Research
 * mode contract are trailing assertions that constrain everything before them.
 *
 * The static layer is pure text: constant across sessions and turns, so it
 * never churns the provider-stable request prefix (see request-shape.ts). It is
 * intentionally NOT injected into sub-agent (childInstruction) paths, which
 * carry their own role identities.
 */

import { PROMPT_CATALOG, type PromptSection } from './prompt-catalog.generated.js';

function sectionsOfLayer(layer: PromptSection['layer']): readonly PromptSection[] {
  return PROMPT_CATALOG.filter((section) => section.layer === layer).sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

/** Every named condition a section can carry; the golden pins the prompt with all of them on. */
export const PROMPT_CONDITIONS = ['memory'] as const;
export type PromptCondition = (typeof PROMPT_CONDITIONS)[number];

/**
 * The static prefix every main session shares, in catalog order. A section
 * with a `condition` is present only when the session has that capability —
 * telling the model about memory tools it does not have would be worse than
 * silence — so there is one cached prefix per combination.
 */
export function mainSessionStaticPromptSections(
  conditions: ReadonlySet<string> = new Set(),
): readonly PromptSection[] {
  return sectionsOfLayer('static').filter(
    (section) => section.condition === null || conditions.has(section.condition),
  );
}

/** One catalog section by id, for hosts that place a section themselves. */
export function promptSection(id: string): PromptSection | undefined {
  return PROMPT_CATALOG.find((section) => section.id === id);
}

/**
 * Values the static catalog interpolates by name, written in a section body as
 * `{name}`. Reserved for facts that belong to a section rather than to the
 * session: the knowledge cutoff is the serving model's, so it cannot be frozen
 * into the catalog, and it cannot move to <env> either without leaving the
 * behaviour block it belongs to. Session facts stay in <env>; turn facts stay
 * in the turn reminder. A placeholder with no value renders as nothing, and the
 * blank line it leaves behind is collapsed with the rest.
 */
export type MainSessionPromptSubstitutions = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER = /\{([a-z0-9_]+)\}/gu;

function interpolate(body: string, values: MainSessionPromptSubstitutions): string {
  if (!body.includes('{')) return body;
  return body
    .replace(PLACEHOLDER, (match, name: string) =>
      Object.hasOwn(values, name) ? (values[name] ?? '') : match,
    )
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function assembleMainSessionSystemPrompt(
  fragments: readonly (string | undefined)[],
  substitutions: MainSessionPromptSubstitutions = {},
  conditions: ReadonlySet<string> = new Set(),
): string {
  return [
    ...mainSessionStaticPromptSections(conditions).map((section) =>
      interpolate(section.body, substitutions),
    ),
    ...fragments,
  ]
    .filter((fragment): fragment is string => Boolean(fragment?.trim()))
    .join('\n\n');
}
