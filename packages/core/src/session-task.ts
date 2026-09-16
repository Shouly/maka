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

// The session task list, as the reference tool surface defines it: TaskCreate /
// TaskList / TaskGet / TaskUpdate over a document of identified tasks, not a
// whole-list replace. An id means a one-field update costs one field, and a
// task can carry the detail another agent needs to pick it up.
//
// Two places deliberately diverge from the reference implementation, because
// the reference is wrong there rather than merely different (see the task-tools
// test report): a dependency edge onto an unknown id is refused instead of
// being dropped while reporting success, and an edge that would close a cycle
// is refused instead of producing a task that can never start. `relx` fixed
// both in its own port; so do we.
//
// Both refusals are properties of the DOCUMENT, not of one function, so they
// are enforced twice: on the write path by `updateSessionTask`, and on anything
// arriving as data by `normalizeSessionTaskDocument` — the protocol decoder and
// the SQLite reader both go through it. The counter is checked in the same
// place and for the same reason: `nextId` is the whole of what makes an id
// unrepeatable, and an id that repeats silently retargets an update.

import { serializedByteLength } from './serialized-byte-length.js';
import { redactSecrets } from './display-redaction.js';
import { sanitizeUnicodeText } from './text-sanitize.js';

export const SESSION_TASK_SUBJECT_MAX_CHARS = 200;
export const SESSION_TASK_DESCRIPTION_MAX_CHARS = 2_000;
export const SESSION_TASK_ACTIVE_FORM_MAX_CHARS = 200;
export const SESSION_TASK_OWNER_MAX_CHARS = 200;
export const SESSION_TASK_MAX_ITEMS = 200;
export const SESSION_TASK_DOCUMENT_MAX_BYTES = 256 * 1024;

export const SESSION_TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type SessionTaskStatus = (typeof SESSION_TASK_STATUSES)[number];

/** `deleted` is a write-only status: it removes the task rather than storing. */
export const SESSION_TASK_DELETED_STATUS = 'deleted' as const;

export interface SessionTask {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly status: SessionTaskStatus;
  readonly activeForm?: string;
  readonly owner?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Tasks that cannot start until this one completes. */
  readonly blocks: readonly string[];
  /** Tasks that must complete before this one can start. */
  readonly blockedBy: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionTaskDocument {
  /** Monotonic; never reused, so a stale reference can never name a new task. */
  readonly nextId: number;
  readonly items: readonly SessionTask[];
}

export type SessionTaskResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function emptySessionTaskDocument(): SessionTaskDocument {
  return { nextId: 1, items: [] };
}

/**
 * Blockers that still stand. A completed blocker no longer blocks, so both read
 * surfaces hide it; the stored edge survives, because the history of what
 * gated what is worth keeping and costs nothing.
 *
 * The reference shows completed blockers in TaskGet and hides them in TaskList,
 * while TaskGet's own description tells the reader to "verify its blockedBy
 * list is empty before beginning work" — advice its own output makes
 * impossible to follow. One meaning, both surfaces.
 *
 * An id that names no task does not gate anything either. It cannot: nothing
 * can complete it, so reading it as a blocker would hold the task shut
 * forever. `normalizeSessionTaskDocument` refuses such an edge at every
 * boundary, and this is what the rule degrades to if one ever gets past.
 * EVERY surface calls this — the tools, the CLI and the renderer panel — so
 * there is one answer to "is this blocked" rather than one per reader.
 */
export function openBlockers(document: SessionTaskDocument, task: SessionTask): readonly string[] {
  const byId = new Map(document.items.map((item) => [item.id, item]));
  return task.blockedBy.filter((id) => {
    const blocker = byId.get(id);
    return blocker !== undefined && blocker.status !== 'completed';
  });
}

/** `openBlockers` against a bare list, for readers that hold no document. */
export function openBlockersOf(
  items: readonly SessionTask[],
  task: SessionTask,
): readonly string[] {
  return openBlockers({ nextId: 1, items }, task);
}

/**
 * Why a task id resolves to nothing.
 *
 * The reference answers `Task not found` for both a task it deleted a moment
 * ago and an id it never issued, so a caller cannot tell "you already removed
 * this" from "you made that number up" — and the two call for opposite fixes.
 *
 * No tombstone is needed to tell them apart. `nextId` only ever moves forward
 * and is never reused, so every id below it was issued at some point and every
 * id at or above it never was. `normalizeSessionTaskDocument` holds that
 * invariant at each boundary, which is what makes this answer trustworthy.
 */
export function missingSessionTaskMessage(document: SessionTaskDocument, taskId: string): string {
  const issued = /^[1-9][0-9]*$/u.test(taskId) && Number(taskId) < document.nextId;
  return issued ? `Task #${taskId} was deleted` : 'Task not found';
}

export function findSessionTask(
  document: SessionTaskDocument,
  taskId: string,
): SessionTask | undefined {
  return document.items.find((item) => item.id === taskId);
}

export interface SessionTaskCreateInput {
  readonly subject: string;
  readonly description: string;
  readonly activeForm?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createSessionTask(
  document: SessionTaskDocument,
  input: SessionTaskCreateInput,
  now: number,
): SessionTaskResult<{ document: SessionTaskDocument; task: SessionTask }> {
  if (document.items.length >= SESSION_TASK_MAX_ITEMS) {
    return fail(`Task list may contain at most ${SESSION_TASK_MAX_ITEMS} tasks`);
  }
  const subject = text(input.subject, SESSION_TASK_SUBJECT_MAX_CHARS, 'subject');
  if (!subject.ok) return subject;
  const description = text(
    input.description,
    SESSION_TASK_DESCRIPTION_MAX_CHARS,
    'description',
    'block',
  );
  if (!description.ok) return description;
  const activeForm =
    input.activeForm === undefined
      ? undefined
      : text(input.activeForm, SESSION_TASK_ACTIVE_FORM_MAX_CHARS, 'activeForm');
  if (activeForm && !activeForm.ok) return activeForm;
  if (input.metadata !== undefined && !isPlainRecord(input.metadata)) {
    return fail('metadata must be an object');
  }

  const task: SessionTask = {
    id: String(document.nextId),
    subject: subject.value,
    description: description.value,
    status: 'pending',
    ...(activeForm?.ok && activeForm.value ? { activeForm: activeForm.value } : {}),
    ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
    blocks: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
  const next: SessionTaskDocument = {
    nextId: document.nextId + 1,
    items: [...document.items, task],
  };
  const bounded = withinByteBudget(next);
  if (!bounded.ok) return bounded;
  return { ok: true, value: { document: next, task } };
}

export interface SessionTaskUpdateInput {
  readonly taskId: string;
  readonly status?: SessionTaskStatus | typeof SESSION_TASK_DELETED_STATUS;
  readonly subject?: string;
  readonly description?: string;
  readonly activeForm?: string;
  readonly owner?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly addBlocks?: readonly string[];
  readonly addBlockedBy?: readonly string[];
}

/** Every field of an update besides `taskId`, in the order the tool lists them. */
const SESSION_TASK_UPDATE_FIELDS = [
  'status',
  'subject',
  'description',
  'activeForm',
  'owner',
  'metadata',
  'addBlocks',
  'addBlockedBy',
] as const satisfies readonly (keyof SessionTaskUpdateInput)[];

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface SessionTaskUpdateOutcome {
  readonly document: SessionTaskDocument;
  /** Stored field names, alphabetical, as the reference reports them. */
  readonly changed: readonly string[];
  readonly deleted: boolean;
}

export function updateSessionTask(
  document: SessionTaskDocument,
  input: SessionTaskUpdateInput,
  now: number,
): SessionTaskResult<SessionTaskUpdateOutcome> {
  const target = findSessionTask(document, input.taskId);
  if (!target) return fail(missingSessionTaskMessage(document, input.taskId));

  if (input.status === SESSION_TASK_DELETED_STATUS) {
    return {
      ok: true,
      value: { document: deleteTask(document, target.id, now), changed: [], deleted: true },
    };
  }

  // The guard is on what the caller NAMED, not on what turned out to differ.
  // Those come apart on a re-assert — `{taskId, status: 'in_progress'}` against
  // a task already in progress — which a model issues constantly: after a
  // retry, after its context is compacted, whenever it reconciles its own list.
  // Refusing that would be answering a correct call with an error. What the
  // reference hides, and what this still refuses, is the caller who named no
  // field at all. An edge array that is present but empty names nothing either.
  const named = SESSION_TASK_UPDATE_FIELDS.filter((field) => {
    const value = input[field];
    if (value === undefined) return false;
    return field === 'addBlocks' || field === 'addBlockedBy' ? asArray(value).length > 0 : true;
  });
  if (named.length === 0) {
    return fail('Nothing to update: pass at least one field besides taskId');
  }

  // Every named field is reported, whether or not its value moved. One rule for
  // all of them: reporting `subject` on a re-assert while dropping `status` on
  // one would make the result text depend on state the caller cannot see.
  const changed = new Set<string>();
  let next: SessionTask = target;

  if (input.status !== undefined) {
    if (!isSessionTaskStatus(input.status)) {
      return fail(`status must be one of ${SESSION_TASK_STATUSES.join(', ')}, or deleted`);
    }
    changed.add('status');
    next = { ...next, status: input.status };
  }
  for (const [field, max, shape] of [
    ['subject', SESSION_TASK_SUBJECT_MAX_CHARS, 'line'],
    ['description', SESSION_TASK_DESCRIPTION_MAX_CHARS, 'block'],
    ['activeForm', SESSION_TASK_ACTIVE_FORM_MAX_CHARS, 'line'],
    ['owner', SESSION_TASK_OWNER_MAX_CHARS, 'line'],
  ] as const) {
    const raw = input[field];
    if (raw === undefined) continue;
    const parsed = text(raw, max, field, shape);
    if (!parsed.ok) return parsed;
    changed.add(field);
    next = { ...next, [field]: parsed.value };
  }
  if (input.metadata !== undefined) {
    if (!isPlainRecord(input.metadata)) return fail('metadata must be an object');
    const merged: Record<string, unknown> = { ...(next.metadata ?? {}) };
    for (const [key, value] of Object.entries(input.metadata)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    changed.add('metadata');
    next = Object.keys(merged).length > 0 ? { ...next, metadata: merged } : stripMetadata(next);
  }

  let items: readonly SessionTask[] = document.items.map((item) =>
    item.id === target.id ? next : item,
  );
  for (const [field, direction] of [
    ['addBlockedBy', 'blockedBy'],
    ['addBlocks', 'blocks'],
  ] as const) {
    const ids = input[field];
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      return fail(`${field} must be an array of task ids`);
    }
    if (ids.length === 0) continue;
    const linked = linkTasks({ nextId: document.nextId, items }, target.id, ids, direction, now);
    if (!linked.ok) return linked;
    items = linked.value;
    changed.add(direction);
  }

  items = items.map((item) => (item.id === target.id ? { ...item, updatedAt: now } : item));
  const document_ = { nextId: document.nextId, items };
  const bounded = withinByteBudget(document_);
  if (!bounded.ok) return bounded;
  return {
    ok: true,
    value: { document: document_, changed: [...changed].sort(), deleted: false },
  };
}

/**
 * Both directions write the same edge, so a caller writes it once from either
 * end. An unknown id is refused rather than dropped, and an edge that would
 * close a cycle is refused rather than producing a task that can never start.
 */
function linkTasks(
  document: SessionTaskDocument,
  taskId: string,
  otherIds: readonly string[],
  direction: 'blocks' | 'blockedBy',
  now: number,
): SessionTaskResult<readonly SessionTask[]> {
  let items = document.items;
  for (const otherId of otherIds) {
    if (otherId === taskId) return fail(`Task #${taskId} cannot block itself`);
    if (!items.some((item) => item.id === otherId)) return fail(`Task #${otherId} not found`);
    const blockerId = direction === 'blockedBy' ? otherId : taskId;
    const blockedId = direction === 'blockedBy' ? taskId : otherId;
    if (reaches(items, blockedId, blockerId)) {
      return fail(`Task #${blockerId} cannot block #${blockedId}: that would create a cycle`);
    }
    // Both ends are rewritten, so both ends are touched. The task the caller
    // did not name has a new dependency list too, and a reader diffing on
    // `updatedAt` must see that; `deleteTask` already bumps every end it edits.
    items = items.map((item) => {
      if (item.id === blockedId) {
        return { ...item, blockedBy: union(item.blockedBy, blockerId), updatedAt: now };
      }
      if (item.id === blockerId) {
        return { ...item, blocks: union(item.blocks, blockedId), updatedAt: now };
      }
      return item;
    });
  }
  return { ok: true, value: items };
}

/** Does `from` already block `to`, directly or through other tasks? */
function reaches(items: readonly SessionTask[], from: string, to: string): boolean {
  if (from === to) return true;
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    if (id === to) return true;
    for (const next of byId.get(id)?.blocks ?? []) queue.push(next);
  }
  return false;
}

/** A hard delete, with every edge that named the task removed with it. */
function deleteTask(
  document: SessionTaskDocument,
  taskId: string,
  now: number,
): SessionTaskDocument {
  const items = document.items
    .filter((item) => item.id !== taskId)
    .map((item) =>
      item.blocks.includes(taskId) || item.blockedBy.includes(taskId)
        ? {
            ...item,
            blocks: item.blocks.filter((id) => id !== taskId),
            blockedBy: item.blockedBy.filter((id) => id !== taskId),
            updatedAt: now,
          }
        : item,
    );
  return { nextId: document.nextId, items };
}

/**
 * Validate a whole document off the wire. The protocol needs this because a
 * task document crosses the Host boundary as data, and a malformed one must be
 * refused at the edge rather than after it has been rendered.
 */
export function normalizeSessionTaskDocument(
  value: unknown,
): SessionTaskResult<SessionTaskDocument> {
  if (!isPlainRecord(value)) return fail('Task document must be an object');
  const { nextId, items } = value;
  if (typeof nextId !== 'number' || !Number.isSafeInteger(nextId) || nextId < 1) {
    return fail('Task document nextId must be a positive integer');
  }
  if (!Array.isArray(items)) return fail('Task document items must be an array');
  if (items.length > SESSION_TASK_MAX_ITEMS) {
    return fail(`Task document may contain at most ${SESSION_TASK_MAX_ITEMS} tasks`);
  }
  const tasks: SessionTask[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of items.entries()) {
    const task = normalizeTask(raw, index);
    if (!task.ok) return task;
    if (seen.has(task.value.id)) return fail(`Task #${task.value.id} appears twice`);
    seen.add(task.value.id);
    tasks.push(task.value);
  }
  const maxId = tasks.reduce((max, task) => Math.max(max, Number(task.id)), 0);
  if (nextId <= maxId) {
    // `nextId` is what makes an id unrepeatable. A counter at or below an id
    // already in the list hands the next create an id that is taken, and from
    // then on `findSessionTask` answers with whichever copy comes first: the
    // update lands on the wrong task and the delete takes both.
    return fail(`Task document nextId must be greater than every task id (#${maxId})`);
  }
  const edges = checkEdges(tasks);
  if (!edges.ok) return edges;
  const document: SessionTaskDocument = { nextId, items: tasks };
  const bounded = withinByteBudget(document);
  if (!bounded.ok) return bounded;
  return { ok: true, value: document };
}

/**
 * The dependency graph, checked the way the write path maintains it: every
 * edge names a task that exists, is written at both ends, and closes no cycle.
 *
 * `updateSessionTask` refuses all three, so a document this repository wrote
 * can never fail here. That is the point — this is the boundary, and the
 * guarantee the rest of the module rests on (`openBlockers` reads these edges,
 * the panel and the tools render them) has to be re-established on anything
 * arriving as data rather than produced by a call.
 */
function checkEdges(tasks: readonly SessionTask[]): SessionTaskResult<true> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const [field, mirror] of [
      ['blockedBy', 'blocks'],
      ['blocks', 'blockedBy'],
    ] as const) {
      const ids = task[field];
      if (new Set(ids).size !== ids.length) {
        return fail(`Task #${task.id} lists the same id twice in ${field}`);
      }
      for (const id of ids) {
        const other = byId.get(id);
        if (!other) return fail(`Task #${task.id} ${field} names #${id}, which does not exist`);
        if (!other[mirror].includes(task.id)) {
          return fail(`The edge between #${task.id} and #${id} is written at one end only`);
        }
      }
    }
  }
  for (const task of tasks) {
    if (task.blocks.some((id) => reaches(tasks, id, task.id))) {
      return fail(`Task #${task.id} is part of a dependency cycle`);
    }
  }
  return { ok: true, value: true };
}

function normalizeTask(value: unknown, index: number): SessionTaskResult<SessionTask> {
  if (!isPlainRecord(value)) return fail(`Task ${index + 1} must be an object`);
  const id = value.id;
  if (typeof id !== 'string' || !/^[1-9][0-9]*$/u.test(id)) {
    return fail(`Task ${index + 1} id must be a positive integer string`);
  }
  const subject = text(value.subject, SESSION_TASK_SUBJECT_MAX_CHARS, `Task #${id} subject`);
  if (!subject.ok) return subject;
  const description = text(
    value.description,
    SESSION_TASK_DESCRIPTION_MAX_CHARS,
    `Task #${id} description`,
    'block',
  );
  if (!description.ok) return description;
  if (!isSessionTaskStatus(value.status)) {
    return fail(`Task #${id} status must be one of ${SESSION_TASK_STATUSES.join(', ')}`);
  }
  const optional: Record<string, string> = {};
  for (const [field, max] of [
    ['activeForm', SESSION_TASK_ACTIVE_FORM_MAX_CHARS],
    ['owner', SESSION_TASK_OWNER_MAX_CHARS],
  ] as const) {
    if (value[field] === undefined) continue;
    const parsed = text(value[field], max, `Task #${id} ${field}`);
    if (!parsed.ok) return parsed;
    optional[field] = parsed.value;
  }
  const edges: Record<'blocks' | 'blockedBy', string[]> = { blocks: [], blockedBy: [] };
  for (const field of ['blocks', 'blockedBy'] as const) {
    const raw = value[field] ?? [];
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
      return fail(`Task #${id} ${field} must be an array of task ids`);
    }
    edges[field] = raw as string[];
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      return fail(`Task #${id} ${field} must be a number`);
    }
  }
  if (value.metadata !== undefined && !isPlainRecord(value.metadata)) {
    return fail(`Task #${id} metadata must be an object`);
  }
  return {
    ok: true,
    value: {
      id,
      subject: subject.value,
      description: description.value,
      status: value.status,
      ...optional,
      ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
      blocks: edges.blocks,
      blockedBy: edges.blockedBy,
      createdAt: value.createdAt as number,
      updatedAt: value.updatedAt as number,
    },
  };
}

export function isSessionTaskStatus(value: unknown): value is SessionTaskStatus {
  return typeof value === 'string' && (SESSION_TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * Project stored task text into a shared display-safe surface value.
 *
 * `sanitizeUnicodeText` collapses every whitespace run, newlines included —
 * right for a label, and it would undo a description's line structure on the
 * way to the panel, which is the one place the structure was kept FOR. So a
 * block is sanitized a line at a time and rejoined, and the code-point budget
 * is applied to the result rather than to each line.
 */
export function sessionTaskTextForDisplay(
  value: string,
  maxCodePoints: number,
  shape: 'line' | 'block' = 'line',
): string {
  const sanitized =
    shape === 'line'
      ? sanitizeUnicodeText(value, { maxCodePoints, truncatedSuffix: '' })
      : clipCodePoints(
          value
            .split('\n')
            .map((line) => sanitizeUnicodeText(line, { maxCodePoints, truncatedSuffix: '' }))
            .join('\n'),
          maxCodePoints,
        );
  let current = redactSecrets(sanitized);
  const tag = /<\/?session-task\b[^>]*>/gi;
  for (;;) {
    const next = current.replace(tag, '');
    if (next === current) return current.trim();
    current = next;
  }
}

function clipCodePoints(value: string, maxCodePoints: number): string {
  const points = [...value];
  return points.length <= maxCodePoints ? value : points.slice(0, maxCodePoints).join('');
}

export function projectSessionTasksForDisplay(
  items: readonly SessionTask[],
): readonly SessionTask[] {
  return items.map((item) => ({
    ...item,
    subject: sessionTaskTextForDisplay(item.subject, SESSION_TASK_SUBJECT_MAX_CHARS),
    description: sessionTaskTextForDisplay(
      item.description,
      SESSION_TASK_DESCRIPTION_MAX_CHARS,
      'block',
    ),
    ...(item.activeForm === undefined
      ? {}
      : {
          activeForm: sessionTaskTextForDisplay(
            item.activeForm,
            SESSION_TASK_ACTIVE_FORM_MAX_CHARS,
          ),
        }),
    ...(item.owner === undefined
      ? {}
      : { owner: sessionTaskTextForDisplay(item.owner, SESSION_TASK_OWNER_MAX_CHARS) }),
  }));
}

function stripMetadata(task: SessionTask): SessionTask {
  const { metadata: _metadata, ...rest } = task;
  return rest;
}

function union(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function withinByteBudget(document: SessionTaskDocument): SessionTaskResult<true> {
  if (
    serializedByteLength(document, SESSION_TASK_DOCUMENT_MAX_BYTES) >
    SESSION_TASK_DOCUMENT_MAX_BYTES
  ) {
    return fail(`Task document exceeds ${SESSION_TASK_DOCUMENT_MAX_BYTES} encoded bytes`);
  }
  return { ok: true, value: true };
}

/**
 * `line` is a label — subject, activeForm, owner — and every run of whitespace
 * in one collapses to a single space, because it is rendered on one row of a
 * list and a newline there would break the row.
 *
 * `block` is a description. It is prose with a 2,000 character budget, and the
 * tool that writes it asks for "detailed requirements and context"; a model
 * answering that with a checklist or two paragraphs must get them back. So the
 * horizontal runs still collapse, and the line structure survives: at most one
 * blank line between blocks, no trailing spaces.
 */
function text(
  value: unknown,
  max: number,
  field: string,
  shape: 'line' | 'block' = 'line',
): SessionTaskResult<string> {
  if (typeof value !== 'string') return fail(`${field} must be a string`);
  const nfc = value.normalize('NFC');
  const normalized =
    shape === 'line'
      ? nfc.replace(/\s+/gu, ' ').trim()
      : nfc
          .replace(/\r\n?/gu, '\n')
          .replace(/[^\S\n]+/gu, ' ')
          .replace(/ *\n/gu, '\n')
          .replace(/\n{3,}/gu, '\n\n')
          .trim();
  if (normalized.length === 0) return fail(`${field} cannot be empty`);
  if ([...normalized].length > max) return fail(`${field} must be ${max} characters or fewer`);
  return { ok: true, value: normalized };
}

function fail<T>(message: string): SessionTaskResult<T> {
  return { ok: false, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
