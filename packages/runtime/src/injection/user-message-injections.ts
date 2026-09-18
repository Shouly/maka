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

// What rides ON a user message, ahead of the user's own text.
//
// The moment the message was sent is a fact about that message, so it stays
// with it for the rest of the conversation and is rendered the same way
// every time the history is replayed, from the message's own timestamp —
// which is what keeps the provider's cached prefix byte-stable. It is the
// one reminder that is never stored: the timestamp already is.

import type { UserContent } from '../model-protocol.js';
import { wrapSystemReminder } from './system-reminder.js';

export interface MessageSentReminderInput {
  /** Epoch milliseconds the message was sent. */
  readonly ts: number;
  /** IANA zone of the user's machine; UTC when unknown. */
  readonly timeZone?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function partsIn(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** `Fri 2026-09-18 04:28`, in the zone. */
export function formatLocalMoment(date: Date, timeZone: string): string {
  const parts = partsIn(date, timeZone);
  // `hour12: false` can print midnight as 24 in some ICU builds.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const weekday = WEEKDAYS.includes(parts.weekday as (typeof WEEKDAYS)[number])
    ? parts.weekday
    : (parts.weekday ?? '');
  return `${weekday} ${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}`.trim();
}

/** `2026-09-18`, in the zone. */
export function formatLocalDate(date: Date, timeZone: string): string {
  const parts = partsIn(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
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
 * `<system-reminder>The user's timezone is America/New_York (UTC-04:00).
 * Message sent at Fri 2026-09-18 04:28 local time.</system-reminder>`
 *
 * It is the moment THIS message was sent, not a clock: the model reads the
 * current time from the turn's date line and its tools, never from here.
 */
export function renderMessageSentReminder(input: MessageSentReminderInput): string {
  const date = new Date(input.ts);
  const zone = resolveZone(input.timeZone, date);
  return wrapSystemReminder(
    `The user's timezone is ${zone} (${formatUtcOffset(date, zone)}). Message sent at ${formatLocalMoment(date, zone)} local time.`,
  );
}

/**
 * Put reminder blocks ahead of the user's text. A string stays a string; an
 * array keeps its parts, the reminders joining the first text part or
 * standing as a new one in front of everything else.
 */
export function prependUserMessageReminders(
  content: UserContent,
  reminders: readonly string[],
): UserContent {
  if (reminders.length === 0) return content;
  const block = reminders.join('\n');
  if (typeof content === 'string') {
    return content.length === 0 ? block : `${block}\n${content}`;
  }
  const [first, ...rest] = content;
  if (first && first.type === 'text') {
    return [
      { ...first, text: first.text.length === 0 ? block : `${block}\n${first.text}` },
      ...rest,
    ];
  }
  return [{ type: 'text', text: block }, ...content];
}
