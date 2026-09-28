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

// Dates and the blocks that ride ON a user message.
//
// A turn's recorded injections are placed around the user's own text: most
// ahead of it, the listings the design sends after the message behind it.
// Dates are written the design's way: "Monday, September 28, 2026".

import type { UserContent } from '../model-protocol.js';

function partsIn(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** `2026-09-18`, the calendar day in the zone. */
export function formatLocalDate(date: Date, timeZone: string): string {
  const parts = partsIn(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The design's date form in the user's zone: "Monday, September 28, 2026". */
export function formatLongDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** `UTC-04:00`, the zone's offset at that moment. */
export function formatUtcOffset(date: Date, timeZone: string): string {
  const name = partsIn(date, timeZone).timeZoneName ?? 'GMT';
  // ICU prints `GMT` for a zero offset and `GMT+08:00` otherwise.
  const offset = name.replace(/^(GMT|UTC)/u, '');
  return `UTC${offset === '' ? '+00:00' : offset}`;
}

/** The zone to render in: the given one when ICU knows it, else UTC — never a thrown turn. */
export function resolveZone(timeZone: string | undefined, date: Date): string {
  if (timeZone) {
    try {
      partsIn(date, timeZone);
      return timeZone;
    } catch {
      // An unknown zone name falls through to UTC rather than failing the turn.
    }
  }
  return 'UTC';
}

/**
 * Put placed blocks (`renderPlacedBlock`, each carrying its own break) ahead of
 * the user's text. A string stays a string; an array keeps its parts, the
 * blocks joining the first text part or standing as a new one in front of
 * everything else.
 */
export function prependUserMessageBlocks(
  content: UserContent,
  blocks: readonly string[],
): UserContent {
  if (blocks.length === 0) return content;
  const lead = blocks.join('');
  if (typeof content === 'string') {
    return content.length === 0 ? lead.trimEnd() : `${lead}${content}`;
  }
  const [first, ...rest] = content;
  if (first && first.type === 'text') {
    return [
      { ...first, text: first.text.length === 0 ? lead.trimEnd() : `${lead}${first.text}` },
      ...rest,
    ];
  }
  return [{ type: 'text', text: lead.trimEnd() }, ...content];
}

/**
 * Put placed blocks after the user's text: the listings the design delivers
 * after the message. A string stays a string; an array gains a trailing text
 * part.
 */
export function appendUserMessageBlocks(
  content: UserContent,
  blocks: readonly string[],
): UserContent {
  if (blocks.length === 0) return content;
  const tail = blocks.join('');
  if (typeof content === 'string') {
    return content.length === 0 ? tail.trimStart() : `${content}${tail}`;
  }
  return [...content, { type: 'text', text: tail.trimStart() }];
}
