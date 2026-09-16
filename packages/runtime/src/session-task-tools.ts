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

// TaskCreate / TaskList / TaskGet / TaskUpdate: the reference task-list surface,
// with its descriptions, parameter names and result text copied verbatim. The
// model learns the shape of a result by seeing it, so the wording of every line
// here is a contract, not prose — `Task #1 created successfully: …`,
// `No tasks found`, `#1 [pending] subject (owner) [blocked by #2]`,
// `Updated task #1 status`, `Task not found`.
//
// Refusals are the one place the text is ours, because the reference reports
// success for three things it does not do (an edge onto an unknown id, an edge
// that closes a cycle, an update naming no field). Those return the reason.
//
// Two of its read surfaces are ours for the same kind of reason. TaskGet calls
// itself "full task details" and then omits `owner`, `activeForm` and
// `metadata`, the last of which is writable and otherwise unverifiable; all
// three are here. And a deleted task answers `Task #N was deleted` rather than
// joining every unknown number under `Task not found`, because the two need
// opposite fixes from the caller.

import { z } from 'zod';
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  type SessionTask,
  type SessionTaskDocument,
  SESSION_TASK_DESCRIPTION_MAX_CHARS,
  SESSION_TASK_STATUSES,
  findSessionTask,
  missingSessionTaskMessage,
  openBlockers,
} from '@maka/core/session-task';
import type { MakaTool } from './tool-runtime.js';

export const TASK_CREATE_TOOL_NAME = TOOL_NAMES.taskCreate;
export const TASK_LIST_TOOL_NAME = TOOL_NAMES.taskList;
export const TASK_GET_TOOL_NAME = TOOL_NAMES.taskGet;
export const TASK_UPDATE_TOOL_NAME = TOOL_NAMES.taskUpdate;

/** Everything the tools need from the Host; the Host owns admission and durability. */
export interface SessionTaskToolStore {
  list(sessionId: string): Promise<SessionTaskDocument>;
  create(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; task: SessionTask }>;
  update(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; changed: readonly string[]; deleted: boolean }>;
}

const METADATA = z
  .record(z.string(), z.unknown())
  .describe('Arbitrary metadata to attach to the task');

export function buildSessionTaskTools(store: SessionTaskToolStore): MakaTool[] {
  return [
    buildTaskCreateTool(store),
    buildTaskListTool(store),
    buildTaskGetTool(store),
    buildTaskUpdateTool(store),
  ];
}

function buildTaskCreateTool(store: SessionTaskToolStore): MakaTool {
  return {
    name: TASK_CREATE_TOOL_NAME,
    activityKind: 'tasks',
    displayName: 'Task Create',
    description:
      'Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.\nIt also helps the user understand the progress of the task and overall progress of their requests.\n\n## When to Use This Tool\n\nUse this tool proactively in these scenarios:\n\n- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions\n- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations\n- Plan mode - When using plan mode, create a task list to track the work\n- User explicitly requests todo list - When the user directly asks you to use the todo list\n- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)\n- After receiving new instructions - Immediately capture user requirements as tasks\n- When you start working on a task - Mark it as in_progress BEFORE beginning work\n- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation\n\n## When NOT to Use This Tool\n\nSkip using this tool when:\n- There is only a single, straightforward task\n- The task is trivial and tracking it provides no organizational benefit\n- The task can be completed in less than 3 trivial steps\n- The task is purely conversational or informational\n\nNOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.\n\n## Task Fields\n\n- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")\n- **description**: What needs to be done\n- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.\n\nAll tasks are created with status `pending`.\n\n## Tips\n\n- Create tasks with clear, specific subjects that describe the outcome\n- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed\n- Check TaskList first to avoid creating duplicate tasks',
    parameters: z
      .object({
        subject: z.string().describe('A brief title for the task'),
        description: z.string().describe('What needs to be done'),
        activeForm: z
          .string()
          .optional()
          .describe(
            'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
          ),
        metadata: METADATA.optional(),
      })
      .strict(),
    impl: async (input, ctx) => {
      const { task } = await store.create(ctx.sessionId, input);
      return `Task #${task.id} created successfully: ${task.subject}`;
    },
  } satisfies MakaTool<
    {
      subject: string;
      description: string;
      activeForm?: string;
      metadata?: Record<string, unknown>;
    },
    string
  > as MakaTool;
}

function buildTaskListTool(store: SessionTaskToolStore): MakaTool {
  return {
    name: TASK_LIST_TOOL_NAME,
    activityKind: 'tasks',
    displayName: 'Task List',
    description:
      "Use this tool to list all tasks in the task list.\n\n## When to Use This Tool\n\n- To see what tasks are available to work on (status: 'pending', no owner, not blocked)\n- To check overall progress on the project\n- To find tasks that are blocked and need dependencies resolved\n- After completing a task, to check for newly unblocked work or claim the next available task\n- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones\n\n## Output\n\nReturns a summary of each task:\n- **id**: Task identifier (use with TaskGet, TaskUpdate)\n- **subject**: Brief description of the task\n- **status**: 'pending', 'in_progress', or 'completed'\n- **owner**: Agent ID if assigned, empty if available\n- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)\n\nUse TaskGet with a specific task ID to view full details including description and comments.",
    parameters: z.object({}).strict(),
    impl: async (_input, ctx) => renderTaskList(await store.list(ctx.sessionId)),
  } satisfies MakaTool<Record<string, never>, string> as MakaTool;
}

function buildTaskGetTool(store: SessionTaskToolStore): MakaTool {
  return {
    name: TASK_GET_TOOL_NAME,
    activityKind: 'tasks',
    displayName: 'Task Get',
    description:
      "Use this tool to retrieve a task by its ID from the task list.\n\n## When to Use This Tool\n\n- When you need the full description and context before starting work on a task\n- To understand task dependencies (what it blocks, what blocks it)\n- After being assigned a task, to get complete requirements\n\n## Output\n\nReturns full task details:\n- **subject**: Task title\n- **description**: Detailed requirements and context\n- **status**: 'pending', 'in_progress', or 'completed'\n- **owner**: Agent ID if assigned, empty if available\n- **blocks**: Tasks waiting on this one to complete\n- **blockedBy**: Open tasks that must complete before this one can start\n\n## Tips\n\n- After fetching a task, verify its blockedBy list is empty before beginning work.\n- Use TaskList to see all tasks in summary form.",
    parameters: z
      .object({ taskId: z.string().describe('The ID of the task to retrieve') })
      .strict(),
    impl: async (input, ctx) => {
      const document = await store.list(ctx.sessionId);
      const task = findSessionTask(document, input.taskId);
      return task ? renderTask(document, task) : missingSessionTaskMessage(document, input.taskId);
    },
  } satisfies MakaTool<{ taskId: string }, string> as MakaTool;
}

function buildTaskUpdateTool(store: SessionTaskToolStore): MakaTool {
  return {
    name: TASK_UPDATE_TOOL_NAME,
    activityKind: 'tasks',
    displayName: 'Task Update',
    description:
      'Use this tool to update a task in the task list.\n\n## When to Use This Tool\n\n**Mark tasks as resolved:**\n- When you have completed the work described in a task\n- When a task is no longer needed or has been superseded\n- IMPORTANT: Always mark your assigned tasks as resolved when you finish them\n- After resolving, call TaskList to find your next task\n\n- ONLY mark a task as completed when you have FULLY accomplished it\n- If you encounter errors, blockers, or cannot finish, keep the task as in_progress\n- When blocked, create a new task describing what needs to be resolved\n- Never mark a task as completed if:\n  - Tests are failing\n  - Implementation is partial\n  - You encountered unresolved errors\n  - You couldn\'t find necessary files or dependencies\n\n**Delete tasks:**\n- When a task is no longer relevant or was created in error\n- Setting status to `deleted` permanently removes the task\n\n**Update task details:**\n- When requirements change or become clearer\n- When establishing dependencies between tasks\n\n## Fields You Can Update\n\n- **status**: The task status (see Status Workflow below)\n- **subject**: Change the task title (imperative form, e.g., "Run tests")\n- **description**: Change the task description\n- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")\n- **owner**: Change the task owner (agent name)\n- **metadata**: Merge metadata keys into the task (set a key to null to delete it)\n- **addBlocks**: Mark tasks that cannot start until this one completes\n- **addBlockedBy**: Mark tasks that must complete before this one can start\n\nAn edge onto an unknown task id is refused, and so is one that would close a dependency cycle; both report what was wrong rather than reporting success and doing nothing. An update that names no field to change is refused for the same reason.\n\n## Status Workflow\n\nStatus progresses: `pending` -> `in_progress` -> `completed`\n\nUse `deleted` to permanently remove a task.\n\n## Staleness\n\nMake sure to read a task\'s latest state using `TaskGet` before updating it.\n\n## Examples\n\nMark task as in progress when starting work:\n{"taskId": "1", "status": "in_progress"}\n\nMark task as completed after finishing work:\n{"taskId": "1", "status": "completed"}\n\nDelete a task:\n{"taskId": "1", "status": "deleted"}\n\nClaim a task by setting owner:\n{"taskId": "1", "owner": "my-name"}\n\nSet up task dependencies:\n{"taskId": "2", "addBlockedBy": ["1"]}',
    parameters: z
      .object({
        taskId: z.string().describe('The ID of the task to update'),
        status: z
          .enum([...SESSION_TASK_STATUSES, 'deleted'])
          .optional()
          .describe('New status for the task'),
        subject: z.string().optional().describe('New subject for the task'),
        description: z.string().optional().describe('New description for the task'),
        activeForm: z
          .string()
          .optional()
          .describe(
            'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
          ),
        owner: z.string().optional().describe('New owner for the task'),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Metadata keys to merge into the task. Set a key to null to delete it.'),
        addBlocks: z.array(z.string()).optional().describe('Task IDs that this task blocks'),
        addBlockedBy: z.array(z.string()).optional().describe('Task IDs that block this task'),
      })
      .strict(),
    impl: async (input, ctx) => {
      const { changed, deleted } = await store.update(ctx.sessionId, input);
      if (deleted) return `Updated task #${input.taskId} deleted`;
      return `Updated task #${input.taskId} ${changed.join(', ')}`;
    },
  } satisfies MakaTool<{ taskId: string }, string> as MakaTool;
}

/** `#<id> [<status>] <subject>` plus optional ` (<owner>)` and ` [blocked by #a, #b]`. */
export function renderTaskList(document: SessionTaskDocument): string {
  if (document.items.length === 0) return 'No tasks found';
  return document.items
    .map((task) => {
      const owner = task.owner ? ` (${task.owner})` : '';
      const blockers = openBlockers(document, task);
      const blocked =
        blockers.length > 0 ? ` [blocked by ${blockers.map((id) => `#${id}`).join(', ')}]` : '';
      return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
    })
    .join('\n');
}

export function renderTask(document: SessionTaskDocument, task: SessionTask): string {
  const lines = [
    `Task #${task.id}: ${task.subject}`,
    `Status: ${task.status}`,
    `Description: ${task.description}`,
  ];
  // The reference calls this "full task details" and then echoes neither
  // `activeForm` nor `metadata` on either read surface — so a caller can write
  // them and has no way to read them back, and cannot tell whether setting a
  // metadata key to null took effect. Both are writable through TaskUpdate;
  // both are readable here.
  if (task.activeForm) lines.push(`Active form: ${task.activeForm}`);
  if (task.owner) lines.push(`Owner: ${task.owner}`);
  if (task.metadata && Object.keys(task.metadata).length > 0) {
    lines.push(`Metadata: ${renderMetadata(task.metadata)}`);
  }
  const blockers = openBlockers(document, task);
  if (blockers.length > 0) {
    lines.push(`Blocked by: ${blockers.map((id) => `#${id}`).join(', ')}`);
  }
  if (task.blocks.length > 0) {
    lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Metadata accepts arbitrary nested JSON, so it is the one field on a task
 * that can be large. The document's byte budget bounds it, but that budget is
 * far wider than a tool result should be, so the echo is clipped at the same
 * size a description is allowed to be and says so rather than trailing off.
 */
function renderMetadata(metadata: Readonly<Record<string, unknown>>): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(metadata) ?? '{}';
  } catch {
    return '(unserializable)';
  }
  if (encoded.length <= SESSION_TASK_DESCRIPTION_MAX_CHARS) return encoded;
  return `${encoded.slice(0, SESSION_TASK_DESCRIPTION_MAX_CHARS)}… (clipped)`;
}
