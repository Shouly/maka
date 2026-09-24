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
 * The words a SendUserMessage call puts in front of the reader.
 *
 * While the call is live the message is in the args preview the Host lets
 * through for this tool alone, so the prose grows as the model writes it.
 *
 * A call that COMPLETED keeps reading the preview until its body arrives. The
 * Host's live `tool_result` frame omits the body (`contentOmitted`), so between
 * that frame and the durable transcript the row is settled with no result at
 * all — and dropping the words there would fold a delivered message into the
 * run for a moment and bring it back when the transcript lands.
 *
 * A call that did NOT complete — refused, failed, cut short — delivered
 * nothing, and neither did one whose body is something other than a message.
 * Its arguments are never drawn as if they had arrived: the model was told
 * they did not.
 */
export function readSendUserMessageText(item: ToolActivityItem): string | undefined {
  const result = durableResultOf(item);
  if (result !== undefined) return readUserMessage(result)?.message;
  const awaitingBody = item.status === 'completed' && item.failure === undefined;
  if (item.status !== 'running' && !awaitingBody) return undefined;
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
export function isSendUserMessageItem(item: ToolActivityItem): boolean {
  return (
    item.toolName === TOOL_NAMES.sendUserMessage || durableResultOf(item)?.kind === 'user_message'
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
