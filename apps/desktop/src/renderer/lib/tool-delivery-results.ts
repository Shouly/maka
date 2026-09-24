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

// The Phase 8b result shapes, read structurally.
//
// Two of them are durable result KINDS the tool system emits —
// `user_file_delivery` (SendUserFile) and `user_message` (SendUserMessage) —
// aliased from `@maka/core/events`. Every consumer narrows through the readers
// below, which validate the wire payload structurally.
//
// The other two are not kinds at all. Read, Grep and Glob return plain text to
// the model but keep a STRUCTURED durable result, and the runtime wraps an
// unrecognised structure as `{ kind: 'json', value }` — so a Grep result
// reaches the renderer as JSON whose value happens to be `{ matches, mode }`.
// Routing them by that shape rather than by tool name is the registry's
// existing rule (see `registry.tsx`): a proxied MCP search that answers in the
// same shape gets the same list panel without anyone registering it.

import type { ToolResultContent } from '@maka/core/events';
import { TOOL_NAMES } from '@maka/core/tool-names';
import type { ToolActivityItem } from '@maka/ui';

/** SendUserFile's durable result, as `@maka/core/events` declares it. */
export type UserFileDeliveryContent = Extract<ToolResultContent, { kind: 'user_file_delivery' }>;

/** One file in a delivery. `artifactId` is the Files face's handle on it. */
export type UserFileDeliveryFile = UserFileDeliveryContent['files'][number];

/** SendUserMessage's durable result: the model's words, addressed to the user. */
export type UserMessageContent = Extract<ToolResultContent, { kind: 'user_message' }>;

/** Kept as a name for the callers that widened through it before core caught up. */
export type DurableToolResultContent = ToolResultContent;

export type DurableToolResultKind = DurableToolResultContent['kind'];

/**
 * A row's result at its true width.
 *
 * `ToolActivityItem.result` is typed `ToolResultContent`, which is narrower
 * than what the Host now sends; comparing that type against
 * `'user_file_delivery'` is a compile error, not a runtime one. One widening
 * lives here so no component writes a cast of its own — and so deleting it is
 * the whole of the change when `@maka/core` catches up.
 */
export function durableResultOf(item: ToolActivityItem): DurableToolResultContent | undefined {
  return item.result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringOf(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function stringsOf(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : undefined;
}

const DELIVERY_FILE_KINDS = new Set(['file', 'diff', 'html', 'image', 'pdf']);

/**
 * The delivery a result carries, or undefined.
 *
 * A file with no artifact id is dropped rather than drawn: the card's whole
 * purpose is to open that artifact in the Files face, and a card that cannot
 * is a button which does nothing.
 */
export function readUserFileDelivery(
  result: DurableToolResultContent | undefined,
): UserFileDeliveryContent | undefined {
  if (result?.kind !== 'user_file_delivery') return undefined;
  const record = asRecord(result);
  if (!record) return undefined;
  const files = Array.isArray(record.files) ? record.files : [];
  const read: UserFileDeliveryFile[] = [];
  for (const entry of files) {
    const file = asRecord(entry);
    if (!file) continue;
    const artifactId = stringOf(file, 'artifactId');
    const name = stringOf(file, 'name');
    if (!artifactId || !name) continue;
    const kind = stringOf(file, 'kind');
    const mimeType = stringOf(file, 'mimeType');
    const sizeBytes = typeof file.sizeBytes === 'number' ? file.sizeBytes : 0;
    read.push({
      artifactId,
      name,
      path: stringOf(file, 'path') ?? name,
      kind: (kind && DELIVERY_FILE_KINDS.has(kind) ? kind : 'file') as UserFileDeliveryFile['kind'],
      ...(mimeType ? { mimeType } : {}),
      sizeBytes,
    });
  }
  const caption = stringOf(record, 'caption');
  return {
    kind: 'user_file_delivery',
    status: stringOf(record, 'status') === 'proactive' ? 'proactive' : 'normal',
    ...(caption && caption.trim() ? { caption } : {}),
    display: stringOf(record, 'display') === 'attach' ? 'attach' : 'render',
    files: read,
  };
}

/** The message a result carries, or undefined when there is nothing to show. */
export function readUserMessage(
  result: DurableToolResultContent | undefined,
): UserMessageContent | undefined {
  if (result?.kind !== 'user_message') return undefined;
  const message = stringOf(asRecord(result) ?? {}, 'message');
  return message && message.trim() ? { kind: 'user_message', message } : undefined;
}

/**
 * A note's text, live or settled.
 *
 * Before the call settles the message is in the args preview the Host let
 * through for this tool alone; after it settles the result owns it. Reading
 * both from one place is what keeps the row from changing shape underneath the
 * reader when the result lands — the tier, the dot and the text are decided
 * from the same string throughout.
 */
export function readNoteMessage(item: ToolActivityItem): string | undefined {
  const settled = readUserMessage(durableResultOf(item));
  if (settled) return settled.message;
  if (item.toolName !== TOOL_NAMES.sendUserMessage) return undefined;
  const args = asRecord(item.args) ?? asRecord(item.argsPreview);
  const message = args ? stringOf(args, 'message') : undefined;
  return message && message.trim() ? message : undefined;
}

/**
 * A scheduled-task call that CHANGED something — created or updated one.
 *
 * Listing, deleting and running stay ordinary rows: a card announces a task the
 * person can now open, and deleting one announces nothing they can open. Since
 * the tools split one verb per tool, this is a question about WHICH tool ran
 * rather than about the arguments it ran with.
 */
const SCHEDULED_TASK_WRITE_TOOLS: ReadonlySet<string> = new Set([
  TOOL_NAMES.scheduledTaskCreate,
  TOOL_NAMES.scheduledTaskUpdate,
  TOOL_NAMES.sendLater,
]);

export function isScheduledTaskWriteItem(item: ToolActivityItem): boolean {
  return SCHEDULED_TASK_WRITE_TOOLS.has(item.toolName);
}

/** Whether a row belongs to SendUserMessage at all, settled or not. */
export function isNoteItem(item: ToolActivityItem): boolean {
  return (
    item.toolName === TOOL_NAMES.sendUserMessage || durableResultOf(item)?.kind === 'user_message'
  );
}

/**
 * Whether a note can be carried by ONE row of the activity timeline.
 *
 * SendUserMessage takes a single `message` and nothing else — no status, no
 * display mode — so how prominently a note is drawn cannot be something the
 * model declares. It has to follow from the message, and the question that
 * decides it is not "is this important" (a row cannot tell, and the one-time
 * password that most deserves the reader's eye is a single sentence) but
 * "does this SURVIVE being a row".
 *
 * A row is one line of small muted text. It can hold a paragraph of inline
 * markdown — bold, a link, some code — at any length, because a line can be
 * long. It cannot hold a list, a table, a fenced block, a quote, a rule or a
 * heading: those would be flattened into the line, losing the structure the
 * author chose. A blank line is the same loss in miniature, so more than one
 * paragraph promotes too.
 *
 * Everything this refuses is drawn full width instead, where it renders as
 * what it is.
 *
 * MONOTONIC, which is what makes it safe to answer while the note is still
 * arriving: appending text can introduce a list, a fence or a blank line, but
 * it can never remove one. So a note starts in a row and may be promoted once,
 * and is never demoted — the reader sees at most one change of shape, early,
 * rather than a layout that flips as tokens land.
 */
export function userMessageFitsOneRow(message: string): boolean {
  const text = message.replace(/\r\n?/gu, '\n').trim();
  // Nothing yet — a note whose first token has not arrived. A row holds it,
  // and the answer only ever moves one way from here (see the note on
  // monotonicity below), so starting inline never has to be undone.
  if (text.length === 0) return true;
  // More than one paragraph: the break is content, and a row cannot keep it.
  if (/\n[^\S\n]*\n/u.test(text)) return false;
  const lines = text.split('\n');
  // An opening fence anywhere, even unclosed — the row cannot show code as code.
  if (lines.some((line) => /^\s{0,3}(?:```|~~~)/u.test(line))) return false;
  return !lines.some(
    (line) =>
      /^\s{0,3}#{1,6}\s/u.test(line) || // heading
      /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/u.test(line) || // list item
      /^\s{0,3}>/u.test(line) || // block quote
      /^\s{0,3}(?:(?:-[^\S\n]*){3,}|(?:\*[^\S\n]*){3,}|(?:_[^\S\n]*){3,})$/u.test(line) || // thematic break
      /^\s{0,3}\|/u.test(line) || // table row
      /^\s{0,3}:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/u.test(line), // table delimiter
  );
}

// ── Grep / Glob / Read, inside a `json` result ──────────────────────────────

/** Grep's output modes, as the tool's `output_mode` argument spells them. */
export type GrepMode = 'content' | 'files_with_matches' | 'count';

export interface GrepResultShape {
  readonly matches: readonly string[];
  readonly mode: GrepMode;
  readonly truncated: boolean;
  /** Lines the cap dropped, when the runtime counted them. */
  readonly omitted: number;
}

export interface GlobResultShape {
  readonly files: readonly string[];
  readonly truncated: boolean;
  /** Matches the cap left out. */
  readonly omitted: number;
}

function isGrepMode(value: unknown): value is GrepMode {
  return value === 'content' || value === 'files_with_matches' || value === 'count';
}

/** A `json` result's value read as a Grep result, or undefined. */
export function readGrepResult(value: unknown): GrepResultShape | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const matches = stringsOf(record.matches);
  if (!matches) return undefined;
  return {
    matches,
    mode: isGrepMode(record.mode) ? record.mode : 'files_with_matches',
    truncated: record.truncated === true,
    omitted: typeof record.omitted === 'number' ? record.omitted : 0,
  };
}

/** A `json` result's value read as a Glob result, or undefined. */
export function readGlobResult(value: unknown): GlobResultShape | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const files = stringsOf(record.files);
  if (!files) return undefined;
  return {
    files,
    truncated: record.truncated === true,
    omitted: typeof record.omitted === 'number' ? record.omitted : 0,
  };
}

/** One row of a Grep panel: the path is a link, the rest is what was found. */
export interface GrepRow {
  readonly path: string;
  /** The line number, in `content` mode. */
  readonly line?: number;
  /** The matching text, in `content` mode. */
  readonly text?: string;
  /** The per-file occurrence count, in `count` mode. */
  readonly count?: number;
}

/**
 * Split one ripgrep line into a path and what follows it.
 *
 * Only `content` and `count` lines have a suffix to split off, and both end
 * their path at the LAST colon before a run of digits — splitting at the first
 * colon would cut `C:\src\x.ts` in half, and a path may legitimately contain
 * one. A line that does not match the mode's shape is kept whole as the path,
 * which reads as a file row rather than as a parse error.
 */
export function parseGrepRow(match: string, mode: GrepMode): GrepRow {
  if (mode === 'content') {
    const parsed = /^(.*):(\d+):([\s\S]*)$/u.exec(match);
    if (parsed) return { path: parsed[1]!, line: Number(parsed[2]), text: parsed[3]! };
    return { path: match };
  }
  if (mode === 'count') {
    const parsed = /^(.*):(\d+)$/u.exec(match);
    if (parsed) return { path: parsed[1]!, count: Number(parsed[2]) };
    return { path: match };
  }
  return { path: match };
}
