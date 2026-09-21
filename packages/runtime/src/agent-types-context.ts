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

// Which agents this Session can launch, said once in its context.
//
// Choosing what to delegate to is part of deciding whether to delegate at
// all, so the catalog belongs where that decision is made rather than behind
// a tool call the model has to remember to make first. It travels the way the
// skills listing does — a context recorded ahead of a turn, re-sent only when
// it changes — because it changes on its own schedule and would otherwise
// invalidate the cached system prompt every time a preset is edited.

import type { AgentDefinitionListItem, SubagentPresetListItem } from './agent-catalog.js';

export const AGENT_TYPES_PROMPT_INTRO = 'Available agent types for the Agent tool:';

export const AGENT_TYPES_PROMPT_OUTRO =
  'When you launch several agents for independent work, send them in one message so they run at the same time.';

/** One line per type: what to pass as `subagent_type`, what it is for, what it can use. */
export function renderAgentTypesPromptFragment(catalog: {
  readonly definitions: readonly AgentDefinitionListItem[];
  readonly presets: readonly SubagentPresetListItem[];
}): string | undefined {
  const lines: string[] = [];
  for (const definition of catalog.definitions) {
    if (definition.availability.status !== 'available') continue;
    lines.push(
      `- ${definition.profile}: ${clean(definition.description)} (Tools: ${toolList(definition.tools)})`,
    );
  }
  for (const preset of catalog.presets) {
    if (preset.availability.status !== 'available') continue;
    lines.push(`- ${preset.id}: ${clean(preset.description)} (${clean(preset.name)})`);
  }
  if (lines.length === 0) return undefined;
  return [AGENT_TYPES_PROMPT_INTRO, ...lines, '', AGENT_TYPES_PROMPT_OUTRO].join('\n');
}

function toolList(tools: readonly string[]): string {
  return tools.length === 0 ? 'none' : [...tools].sort().join(', ');
}

function clean(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}
