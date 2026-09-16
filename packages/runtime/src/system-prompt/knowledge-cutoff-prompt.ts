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

// The <knowledge_cutoff> section, which belongs to the model rather than to the
// session: the date is the serving model's own reliable cutoff, so the section
// is interpolated into the behaviour block at composition time instead of being
// frozen into the static catalog. Today's date is deliberately NOT in here — it
// lives once, in <env> — so the section stays constant for a given model.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * models.dev states a cutoff as `YYYY-MM` or `YYYY-MM-DD`. Render it the way a
 * sentence would read it; anything else passes through as written rather than
 * being dropped, because a malformed date is still information.
 */
export function formatKnowledgeCutoff(cutoff: string): string {
  const trimmed = cutoff.trim();
  const full = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed);
  if (full) {
    const month = MONTHS[Number(full[2]) - 1];
    if (month) return `${month} ${Number(full[3])}, ${full[1]}`;
  }
  const monthOnly = /^(\d{4})-(\d{2})$/u.exec(trimmed);
  if (monthOnly) {
    const month = MONTHS[Number(monthOnly[2]) - 1];
    if (month) return `${month} ${monthOnly[1]}`;
  }
  return trimmed;
}

/**
 * Render the section for a known cutoff. A model whose cutoff we do not know
 * gets the same guidance without a date: the behaviour (search rather than
 * guess) is what matters, and inventing a date would be worse than omitting it.
 */
export function renderKnowledgeCutoffSection(cutoff: string | undefined): string {
  const formatted = cutoff?.trim() ? formatKnowledgeCutoff(cutoff) : undefined;
  const opening = formatted
    ? `Copilot's reliable knowledge cutoff date - the date past which it cannot answer questions reliably - is ${formatted}. It answers questions the way a highly informed individual in ${formatted} would if they were talking to someone from the current date (provided in the <env> section at the end of this prompt), and can let the person it's talking to know this if relevant.`
    : "Copilot has a reliable knowledge cutoff date - the date past which it cannot answer questions reliably. It answers questions the way a highly informed individual from that date would if they were talking to someone from the current date (provided in the <env> section at the end of this prompt), and can let the person it's talking to know this if relevant.";
  return [
    '<knowledge_cutoff>',
    `${opening} If asked or told about events or news that may have occurred after this cutoff date, Copilot can't know what happened, so Copilot uses the web search tool to find more information. If asked about current news, events or any information that could have changed since its knowledge cutoff, Copilot uses the search tool without asking for permission. Copilot is careful to search before responding when asked about specific binary events (such as deaths, elections, or major incidents) or current holders of positions (such as "who is the prime minister of <country>", "who is the CEO of <company>") to ensure it always provides the most accurate and up to date information. Copilot does not make overconfident claims about the validity of search results or lack thereof, and instead presents its findings evenhandedly without jumping to unwarranted conclusions, allowing the person to investigate further if desired. Copilot should not remind the person of its cutoff date unless it is relevant to the person's message.`,
    '</knowledge_cutoff>',
  ].join('\n');
}
