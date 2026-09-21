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

import { z } from 'zod';
import { jsonSchema, zodSchema } from 'ai';
import {
  encodedTerminalInputActionsByteLength,
  normalizeTerminalInputActionDefaults,
  parseTerminalInputAction,
  TERMINAL_INPUT_MODIFIERS,
  TERMINAL_INPUT_NAMED_KEYS,
  TERMINAL_MOUSE_BUTTONS,
  TERMINAL_MOUSE_EVENTS,
  TERMINAL_MOUSE_SCROLL_DIRECTIONS,
  type TerminalInputAction,
} from '@maka/core/terminal-input';
import { isActiveShellRunStatus, isShellRunId, SHELL_RUN_ID_MAX_CHARS } from '@maka/core/shell-run';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { shellRunResourceRef } from './shell-run-contract.js';

/** A task id the command store has never heard of; it may still be an agent. */
function isUnknownTaskError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
  // An id the command store will not even parse is not a command id; it may
  // still name an agent, whose ids are drawn from the same alphabet.
  return /Invalid shell run id|not a background task/iu.test(error.message);
}
import { redactSecrets } from '@maka/core/redaction';
import type { ToolResultContent } from '@maka/core/events';
import type { ToolExecutionFacts } from '@maka/core/permission';
import type { SandboxBoundaryExpansion } from '@maka/core/sandbox-boundary';
import type { MakaTool, MakaToolContext } from './tool-runtime.js';
import type { SandboxType } from './sandbox/types.js';
import { isLikelySandboxDenial } from './sandbox/detect.js';
import { runShellWithBoundedTail, type BoundedShellResult } from './shell-exec.js';
import {
  bashToolTurnShellGuidance,
  defaultShellPlan,
  throwIfShellSetupFailed,
  type TurnShellPlan,
} from './shell-detect.js';
import { truncateToolOutput } from './tool-output.js';
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_PTY_COLS,
  MAX_PTY_ROWS,
  MAX_FOREGROUND_BASH_TIMEOUT_MS,
  MAX_SHELL_RUN_RESOURCE_REF_CHARS,
  MAX_SHELL_RUN_TIMEOUT_MS,
  MAX_WRITE_STDIN_ACTIONS,
  MAX_WRITE_STDIN_INPUT_BYTES,
  MIN_PTY_COLS,
  MIN_PTY_ROWS,
  type BackgroundTaskStopper,
  type PtyControlWriter,
  type ShellRunBashInput,
  isShellRunResourceRef,
  isWellFormedTerminalInput,
} from './shell-run-contract.js';
import type { ChildFdInput } from './child-fd-input.js';
import { shellRunResultToModelOutput } from './shell-run-model-output.js';
import { bashToolResultToModelOutput } from './bash-model-output.js';
import {
  BASH_REQUIRED_BOUNDARY_DESCRIPTION,
  bashBoundaryIntentSchema,
  preflightDeclaredSandboxBoundary,
  preprocessBashBoundaryDeclaration,
  refineBashBoundaryDeclaration,
  sandboxBoundaryExpansionSchema,
  selectedBashBoundaryExpansion,
} from './sandbox-boundary-declaration.js';

/**
 * What the user reads instead of the command.
 *
 * The raw command is what runs, and it is kept; this is the line a person sees
 * in the transcript, so it has to be a sentence and not a shell fragment. The
 * runtime records it with the rest of the arguments and does nothing else with
 * it — it never changes what executes.
 */
export const MAX_BASH_DESCRIPTION_CHARS = 200;

export const bashDescriptionField = z
  .string()
  .max(MAX_BASH_DESCRIPTION_CHARS)
  .optional()
  .describe(
    'Clear, concise description of what this command does in active voice. ' +
      "Say what the command does in plain words: do not echo the command's text, its flags, or file paths — " +
      'the user reads this description, often without seeing the command.',
  );

/**
 * The Bash description, shared by every builder so the contract cannot drift
 * between the executor-backed and the shell-run-backed tool.
 *
 * The opening section is the general shell contract; `# Git` is there because
 * git is the one program whose interactive modes hang a non-interactive shell
 * forever, and `# Maka` carries what only this host can say — which shell the
 * turn actually resolved, background and PTY runs, and the sandbox boundary.
 */
export function bashToolDescription(
  shell: TurnShellPlan,
  makaBullets: readonly string[],
  maxTimeoutMs: number = MAX_FOREGROUND_BASH_TIMEOUT_MS,
): string {
  const guidance = bashToolTurnShellGuidance(shell);
  return [
    'Executes a bash command and returns its output.',
    '',
    "- Every call starts in the session working directory: a `cd` applies to that call only and does not carry over, so prefer absolute paths. Shell state (env vars, functions) does not persist either; the shell is initialized from the user's profile.",
    '- Command output is displayed to you, not reliably to the user.',
    `- \`timeout\` is in milliseconds: default ${DEFAULT_BASH_TIMEOUT_MS}, max ${maxTimeoutMs}.`,
    '- IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task.',
    '',
    '# Copilot',
    ...(guidance ? [`- ${guidance}`] : []),
    ...makaBullets,
  ].join('\n');
}

export interface ForegroundBashExecuteInput {
  command: string;
  cwd: string;
  timeoutMs?: number;
  ctx: MakaToolContext;
}

export interface ForegroundBashResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  timedOut?: boolean;
  aborted?: boolean;
  sandboxType?: SandboxType;
  sandboxed?: boolean;
}

export interface BuildForegroundBashToolOptions {
  description: string;
  executionFacts?: ToolExecutionFacts;
  defaultTimeoutMs?: (command: string) => number | undefined;
  maxTimeoutMs?: number;
  emitReturnedOutput?: boolean;
  execute: (input: ForegroundBashExecuteInput) => Promise<ForegroundBashResult>;
  afterResult?: (
    input: { command: string; cwd: string; timeoutMs?: number },
    result: ForegroundBashResult,
    ctx: MakaToolContext,
  ) => Promise<void> | void;
}

type TerminalToolResult = Extract<ToolResultContent, { kind: 'terminal' }>;
type ShellRunToolResult = Extract<ToolResultContent, { kind: 'shell_run' }>;

export interface ShellRunLauncher {
  runForegroundBash(input: ShellRunBashInput): Promise<TerminalToolResult>;
  runBackgroundBash(input: ShellRunBashInput): Promise<ShellRunToolResult>;
}

export function buildForegroundBashTool(options: BuildForegroundBashToolOptions): MakaTool {
  const maxTimeoutMs = options.maxTimeoutMs ?? 600_000;
  return {
    name: TOOL_NAMES.bash,
    activityKind: 'command',
    description: options.description,
    parameters: z.object({
      command: z.string().describe('The command to execute'),
      timeout: z
        .number()
        .int()
        .positive()
        .max(maxTimeoutMs)
        .optional()
        .describe(`Optional timeout in milliseconds (max ${maxTimeoutMs})`),
      description: bashDescriptionField,
    }),
    toModelOutput: ({ output }) => bashToolResultToModelOutput(output),
    ...(options.executionFacts ? { executionFacts: options.executionFacts } : {}),
    impl: async ({ command, timeout }, ctx) => {
      const timeoutMs = timeout ?? options.defaultTimeoutMs?.(command);
      const result = await options.execute({ command, cwd: ctx.cwd, timeoutMs, ctx });
      if (options.emitReturnedOutput) {
        if (result.stdout) ctx.emitOutput('stdout', result.stdout);
        if (result.stderr) ctx.emitOutput('stderr', result.stderr);
      }
      await options.afterResult?.(
        { command, cwd: ctx.cwd, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
        result,
        ctx,
      );
      return shapeTerminalResult({
        cwd: ctx.cwd,
        command,
        result,
      });
    },
  };
}

export function buildLocalForegroundBashTool(
  options: { executionFacts?: ToolExecutionFacts; shell?: TurnShellPlan } = {},
): MakaTool {
  const shell = options.shell ?? { plan: defaultShellPlan() };
  return buildForegroundBashTool({
    description: bashToolDescription(shell, [
      '- The command runs to completion and the result is what it printed. A failure leads with an `Exit code N` line; a command that printed nothing returns "(no output)".',
      '- `description` is what the user reads in place of the raw command.',
      '- Subject to the permission policy of the session.',
    ]),
    ...(options.executionFacts ? { executionFacts: options.executionFacts } : {}),
    defaultTimeoutMs: () => 120_000,
    execute: async ({ command, cwd, timeoutMs, ctx }) => {
      throwIfShellSetupFailed(shell);
      return runShellWithBoundedTail(command, {
        cwd,
        timeoutMs: timeoutMs ?? 120_000,
        abortSignal: ctx.abortSignal,
        emitOutput: ctx.emitOutput,
        shell: shell.plan,
      });
    },
  });
}

export function buildManagedBashTool(
  shellRuns: ShellRunLauncher,
  options: {
    executionFacts?: ToolExecutionFacts;
    shell?: TurnShellPlan;
    /** Opening sentence of the description, before the shared foreground/background/PTY contract. */
    lead?: string;
    /**
     * Whether this host has a sandbox boundary the model can be asked to declare.
     * False drops `boundary_intent` and `required_boundary` from the schema
     * entirely rather than accepting and ignoring them: parameters no host
     * enforces are pure noise in the model's tool selection.
     */
    declareSandboxBoundary?: boolean;
    /**
     * Foreground timeout when the model does not ask for one, per command —
     * the same hook shape buildForegroundBashTool exposes, so a host that
     * carves out a slow command keeps that carve-out on both paths instead of
     * re-implementing it on one.
     *
     * A host default is CLAMPED to MAX_FOREGROUND_BASH_TIMEOUT_MS rather than
     * passed through: the launcher REJECTS anything larger, so an operator who
     * raised their own floor past ten minutes would otherwise break every
     * foreground command instead of merely capping it. A timeout the model asks
     * for explicitly is still rejected above the maximum — that is a stated
     * schema bound, not a host misconfiguration.
     */
    defaultTimeoutMs?: (command: string) => number | undefined;
    /** Observes each committed result; used by hosts that record tool evidence. */
    afterResult?: (
      input: { command: string; cwd: string; timeoutMs?: number },
      result: TerminalToolResult | ShellRunToolResult,
      ctx: MakaToolContext,
    ) => Promise<void> | void;
    transformCommand?: (input: {
      command: string;
      pty: boolean;
      requiredBoundary?: SandboxBoundaryExpansion;
      ctx: MakaToolContext;
    }) =>
      | {
          argv?: readonly string[];
          cwd: string;
          env?: NodeJS.ProcessEnv;
          fdInputs?: readonly ChildFdInput[];
          sandboxType?: SandboxType;
          onCompletion?: (outcome: { successful: boolean }) => void;
        }
      | undefined;
  } = {},
): MakaTool {
  const shell = options.shell ?? { plan: defaultShellPlan() };
  const declareSandboxBoundary = options.declareSandboxBoundary !== false;
  const managedBashFields = {
    command: z.string().describe('The command to execute'),
    timeout: z
      .number()
      .int()
      .positive()
      .max(MAX_SHELL_RUN_TIMEOUT_MS)
      .optional()
      .describe(
        `Optional timeout in milliseconds (foreground default ${DEFAULT_BASH_TIMEOUT_MS}, foreground max ${MAX_FOREGROUND_BASH_TIMEOUT_MS}; background max ${MAX_SHELL_RUN_TIMEOUT_MS})`,
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe('Run the command detached as a tracked task and return an ID instead of output'),
    pty: z
      .boolean()
      .optional()
      .describe('Allocate a terminal for the run; requires run_in_background'),
    description: bashDescriptionField,
  };
  const refineManagedBash = (
    { timeout, run_in_background, pty }: z.infer<z.ZodObject<typeof managedBashFields>>,
    ctx: z.core.$RefinementCtx,
  ) => {
    if (!run_in_background && timeout !== undefined && timeout > MAX_FOREGROUND_BASH_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'too_big',
        maximum: MAX_FOREGROUND_BASH_TIMEOUT_MS,
        origin: 'number',
        inclusive: true,
        path: ['timeout'],
        message: `Foreground Bash timeout may not exceed ${MAX_FOREGROUND_BASH_TIMEOUT_MS}ms`,
      });
    }
    if (pty && !run_in_background) {
      ctx.addIssue({
        code: 'custom',
        path: ['pty'],
        message: 'PTY Bash requires run_in_background=true',
      });
    }
  };
  return {
    name: TOOL_NAMES.bash,
    activityKind: 'command',
    description: bashToolDescription(shell, [
      ...(options.lead ? [`- ${options.lead}`] : []),
      `- Foreground is the default: the command runs to completion and the result is what it printed. A failure leads with an \`Exit code N\` line; a command that printed nothing returns "(no output)".`,
      `- Set \`run_in_background: true\` for a command that should keep running as a tracked task — a dev server, a watcher, a long build. It keeps running across turns and re-invokes you when it exits. No \`&\` needed. It returns an ID and a file its output is written to: read that file to see what it printed, and end it with TaskStop. Background runs have no default timeout (maximum explicit timeout ${MAX_SHELL_RUN_TIMEOUT_MS}ms).`,
      '- Set `pty: true` together with `run_in_background: true` only when the command needs terminal semantics or later keystrokes. A terminal task has a live screen rather than a log, so it writes no output file: send keystrokes with TaskInput on the returned ID and read the screen it answers with.',
      '- `description` is what the user reads in place of the raw command.',
      ...(declareSandboxBoundary ? ['- Enforced by the current session sandbox boundary.'] : []),
    ]),
    parameters: declareSandboxBoundary
      ? preprocessBashBoundaryDeclaration(
          z
            .object({
              ...managedBashFields,
              boundary_intent: bashBoundaryIntentSchema,
              required_boundary: sandboxBoundaryExpansionSchema
                .optional()
                .describe(BASH_REQUIRED_BOUNDARY_DESCRIPTION),
            })
            .strict()
            .superRefine(refineManagedBash)
            .superRefine(refineBashBoundaryDeclaration),
        )
      : z.object(managedBashFields).strict().superRefine(refineManagedBash),
    toModelOutput: ({ output }) => bashToolResultToModelOutput(output),
    ...(options.executionFacts ? { executionFacts: options.executionFacts } : {}),
    impl: async (input, ctx) => {
      throwIfShellSetupFailed(shell);
      const { command, timeout, run_in_background, pty, description } = input;
      const normalizedRequiredBoundary = await preflightDeclaredSandboxBoundary(
        selectedBashBoundaryExpansion(input),
        ctx,
      );
      const transformed = options.transformCommand?.({
        command,
        pty: pty === true,
        ...(normalizedRequiredBoundary ? { requiredBoundary: normalizedRequiredBoundary } : {}),
        ctx,
      });
      const onCompletion = onceCompletion(transformed?.onCompletion);
      const timeoutMs =
        timeout ??
        (run_in_background
          ? undefined
          : clampHostForegroundTimeout(options.defaultTimeoutMs?.(command)));
      try {
        const result = await shellRuns[
          run_in_background ? 'runBackgroundBash' : 'runForegroundBash'
        ]({
          sessionId: ctx.sessionId,
          ...(ctx.runId ? { sourceRunId: ctx.runId } : {}),
          sourceTurnId: ctx.turnId,
          sourceToolCallId: ctx.toolCallId,
          cwd: transformed?.cwd ?? ctx.cwd,
          command,
          ...(description !== undefined ? { description } : {}),
          ...(pty !== undefined ? { pty } : {}),
          ...(transformed?.argv ? { argv: transformed.argv } : { shell: shell.plan }),
          ...(transformed?.env ? { env: transformed.env } : {}),
          ...(transformed?.fdInputs ? { fdInputs: transformed.fdInputs } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          abortSignal: ctx.abortSignal,
          emitOutput: ctx.emitOutput,
          ...(transformed?.sandboxType ? { sandboxType: transformed.sandboxType } : {}),
          ...(onCompletion ? { onCompletion } : {}),
        });
        if (result.kind === 'terminal' || !isActiveShellRunStatus(result.status)) {
          onCompletion?.({
            successful: result.status === 'completed' && result.exitCode === 0,
          });
        }
        await options.afterResult?.(
          {
            command,
            cwd: transformed?.cwd ?? ctx.cwd,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          },
          result,
          ctx,
        );
        return result;
      } catch (error) {
        onCompletion?.({ successful: false });
        throw error;
      }
    },
  };
}

function clampHostForegroundTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(value, MAX_FOREGROUND_BASH_TIMEOUT_MS);
}

function onceCompletion(
  callback: ((outcome: { successful: boolean }) => void) | undefined,
): ((outcome: { successful: boolean }) => void) | undefined {
  if (!callback) return undefined;
  let completed = false;
  return (outcome) => {
    if (completed) return;
    completed = true;
    callback(outcome);
  };
}

export function buildStopBackgroundTaskTool(backgroundTasks: BackgroundTaskStopper): MakaTool {
  return {
    name: TOOL_NAMES.taskStop,
    activityKind: 'command',
    description: [
      'Stops a running background task.',
      '',
      '- `task_id` is the ID a background Bash or an Agent returned. Both kinds are accepted.',
      '- Only tasks of the current session can be stopped; an ID from elsewhere is rejected.',
      '- Returns the task state after the stop. A task that had already finished is reported as such rather than failing.',
      '- Stop a task as soon as its work is done: one left running holds its process for the rest of the session.',
    ].join('\n'),
    parameters: z.object({
      task_id: z.string().describe('The ID of the background task or agent to stop'),
    }),
    impl: async ({ task_id: taskId }, ctx) => {
      // Both kinds wear the same shape of ID, so the answer decides which it
      // is: the command store knows its own tasks, and anything it has never
      // heard of is looked for among this Session's agents.
      let unknownToCommands: unknown;
      try {
        return await backgroundTasks.stopBackgroundTask(
          ctx.sessionId,
          shellRunResourceRef(taskId),
          ctx.abortSignal,
        );
      } catch (error) {
        if (!isUnknownTaskError(error) || !ctx.stopChildAgent) throw error;
        unknownToCommands = error;
      }
      // Neither kind claims it. The command store's answer is the one written
      // for this case, so it is what the model reads — not the agent lookup's
      // complaint about a Session that was never a Session.
      const stopped = (await ctx.stopChildAgent({ childSessionId: taskId }).catch(() => {
        throw unknownToCommands;
      })) as {
        stopped?: boolean;
        agentName?: string;
        description?: string;
        status?: string;
      };
      // The same line a stopped background command answers with, so one tool
      // reads one way whatever it stopped.
      const command = stopped.description ?? stopped.agentName ?? 'agent';
      return {
        kind: 'text',
        text: JSON.stringify({
          message: stopped.stopped
            ? `Successfully stopped task: ${taskId} (${command})`
            : `Task ${taskId} had already finished (${command})`,
          task_id: taskId,
          task_type: 'local_agent',
          command,
          ...(stopped.status !== undefined ? { status: stopped.status } : {}),
        }),
      };
    },
    toModelOutput: ({ output }) => {
      const text = output as { kind?: string; text?: string };
      if (text?.kind === 'text' && typeof text.text === 'string') {
        return { type: 'text', value: text.text };
      }
      return shellRunResultToModelOutput(output);
    },
  };
}

/** A syntactically valid PTY task ID used only in the documented TaskInput examples. */
export const WRITE_STDIN_EXAMPLE_TASK_ID = 'sr_example';
export const WRITE_STDIN_EXAMPLE_REF = shellRunResourceRef(WRITE_STDIN_EXAMPLE_TASK_ID);

/**
 * One minimal legal payload per TaskInput action type (plus a resize-only
 * call). Each entry is valid under the loose provider schema AND passes strict
 * validation after normalization — the TaskInput contract conformance test
 * asserts both, so the documented shape can never drift from what the runtime
 * actually accepts. The `key (chord)` entry shows the ctrl-modified printable
 * form the description points at.
 */
export const WRITE_STDIN_MINIMAL_EXAMPLES: readonly {
  readonly label: string;
  readonly payload: Readonly<Record<string, unknown>>;
}[] = [
  {
    label: 'text',
    payload: { task_id: WRITE_STDIN_EXAMPLE_TASK_ID, actions: [{ type: 'text', text: 'hello' }] },
  },
  {
    label: 'key (named)',
    payload: { task_id: WRITE_STDIN_EXAMPLE_TASK_ID, actions: [{ type: 'key', key: 'enter' }] },
  },
  {
    label: 'key (chord)',
    payload: {
      task_id: WRITE_STDIN_EXAMPLE_TASK_ID,
      actions: [{ type: 'key', key: 'c', modifiers: ['ctrl'] }],
    },
  },
  {
    label: 'mouse click',
    payload: {
      task_id: WRITE_STDIN_EXAMPLE_TASK_ID,
      actions: [{ type: 'mouse', event: 'click', x: 0, y: 0, button: 'left' }],
    },
  },
  {
    label: 'mouse press',
    payload: {
      task_id: WRITE_STDIN_EXAMPLE_TASK_ID,
      actions: [{ type: 'mouse', event: 'press', x: 0, y: 0, button: 'left' }],
    },
  },
  {
    label: 'mouse release',
    payload: {
      task_id: WRITE_STDIN_EXAMPLE_TASK_ID,
      actions: [{ type: 'mouse', event: 'release', x: 0, y: 0, button: 'left' }],
    },
  },
  {
    label: 'mouse move',
    payload: {
      task_id: WRITE_STDIN_EXAMPLE_TASK_ID,
      actions: [{ type: 'mouse', event: 'move', x: 1, y: 1 }],
    },
  },
  {
    label: 'mouse scroll',
    payload: {
      task_id: WRITE_STDIN_EXAMPLE_TASK_ID,
      actions: [{ type: 'mouse', event: 'scroll', x: 0, y: 0, direction: 'up' }],
    },
  },
  {
    label: 'resize only',
    payload: { task_id: WRITE_STDIN_EXAMPLE_TASK_ID, size: { cols: 80, rows: 24 } },
  },
];

/**
 * The concrete minimal example embedded in the TaskInput tool description,
 * derived from the pinned {@link WRITE_STDIN_MINIMAL_EXAMPLES} `key (named)`
 * entry so the documented shape can never drift from what conformance tests
 * exercise. The example ref id is templated to `<id>` for human readers.
 */
export const WRITE_STDIN_DESCRIPTION_EXAMPLE_JSON = JSON.stringify(
  (
    WRITE_STDIN_MINIMAL_EXAMPLES.find((example) => example.label === 'key (named)') ??
    WRITE_STDIN_MINIMAL_EXAMPLES[0]
  ).payload,
).replace('sr_example', '<id>');

/**
 * Build the two-layer TaskInput schema pair as a single unit so the
 * provider-visible (loose) schema and the strict runtime validator can be
 * exercised together by conformance tests. The loose provider schema exists so
 * providers that inject `null`/`0`/`''` placeholders are tolerated; the strict
 * validator (via {@link normalizeProviderWriteStdinInput}) normalizes those away
 * and enforces the real contract. {@link WRITE_STDIN_MINIMAL_EXAMPLES} pins a
 * minimal legal payload per action type that must pass BOTH layers.
 */
/** The validated shape the strict TaskInput schema yields after normalization. */
export interface WriteStdinInput {
  task_id: string;
  input?: string;
  actions?: TerminalInputAction[];
  size?: { cols: number; rows: number };
}

export function createWriteStdinSchemas(): {
  providerParameters: z.ZodTypeAny;
  strictParameters: z.ZodType<WriteStdinInput, unknown>;
} {
  const terminalAction = z.unknown().transform((value, context): TerminalInputAction => {
    try {
      return parseTerminalInputAction(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid terminal input action',
      });
      return value as TerminalInputAction;
    }
  });
  const strictParameters = z.preprocess(
    normalizeProviderWriteStdinInput,
    z
      .object({
        task_id: z
          .string()
          .max(SHELL_RUN_ID_MAX_CHARS)
          .refine(isShellRunId, 'task_id must be the ID a PTY Bash task returned'),
        input: z
          .string()
          .min(1, 'input must not be empty')
          .refine(isWellFormedTerminalInput, 'input must be well-formed Unicode')
          .refine(
            (value) => Buffer.byteLength(value, 'utf8') <= MAX_WRITE_STDIN_INPUT_BYTES,
            `input must not exceed ${MAX_WRITE_STDIN_INPUT_BYTES} bytes`,
          )
          .optional(),
        actions: z.array(terminalAction).min(1).max(MAX_WRITE_STDIN_ACTIONS).optional(),
        size: z
          .object({
            cols: z.number().int().min(MIN_PTY_COLS).max(MAX_PTY_COLS),
            rows: z.number().int().min(MIN_PTY_ROWS).max(MAX_PTY_ROWS),
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine((value) => value.input === undefined || value.actions === undefined, {
        message: 'raw input and terminal actions are mutually exclusive',
      })
      .refine(
        (value) =>
          value.input !== undefined || value.actions !== undefined || value.size !== undefined,
        {
          message: 'input, actions, and/or size is required',
        },
      )
      .superRefine((value, context) => {
        if (!value.actions) return;
        try {
          if (encodedTerminalInputActionsByteLength(value.actions) > MAX_WRITE_STDIN_INPUT_BYTES) {
            context.addIssue({
              code: 'custom',
              path: ['actions'],
              message: `actions must not exceed ${MAX_WRITE_STDIN_INPUT_BYTES} encoded bytes`,
            });
          }
        } catch {
          // The key action reports its own precise validation issue.
        }
      }),
  );
  const providerAction = z
    .object({
      type: z.enum(['text', 'key', 'mouse']).describe('Action kind'),
      text: z
        .string()
        .describe('Visible text for a text action; omit it for a key action')
        .optional(),
      key: z
        .string()
        .describe(
          `Named key (${TERMINAL_INPUT_NAMED_KEYS.join(', ')}) or one printable ASCII character for a key action; omit it for a text action`,
        )
        .optional(),
      event: z
        .enum(TERMINAL_MOUSE_EVENTS)
        .describe('Mouse event; omit it for text and key actions')
        .optional(),
      x: z
        .number()
        .int()
        .min(0)
        .describe('Zero-based terminal cell column for a mouse action')
        .optional(),
      y: z
        .number()
        .int()
        .min(0)
        .describe('Zero-based terminal cell row for a mouse action')
        .optional(),
      button: z
        .enum(TERMINAL_MOUSE_BUTTONS)
        .describe('Mouse button; required for click, press, and release')
        .optional(),
      direction: z
        .enum(TERMINAL_MOUSE_SCROLL_DIRECTIONS)
        .describe('Scroll direction; required only for scroll')
        .optional(),
      modifiers: z
        .array(z.enum(TERMINAL_INPUT_MODIFIERS))
        .describe('Optional unique modifiers for a key or mouse action')
        .optional(),
    })
    .strict();
  const providerParameters = z
    .object({
      task_id: z.string().max(SHELL_RUN_ID_MAX_CHARS).describe('The ID a PTY Bash task returned'),
      actions: z
        .array(providerAction)
        .max(MAX_WRITE_STDIN_ACTIONS)
        .describe(
          'Ordered terminal input actions. Text uses type and text. Key uses type, key, and optional modifiers. Mouse uses type, event, zero-based x/y, event-specific button or direction, and optional modifiers. Omit it for a resize-only call.',
        )
        .optional(),
      size: z
        .object({
          cols: z.number().describe('Terminal columns').optional(),
          rows: z.number().describe('Terminal rows').optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .describe('Send ordered terminal actions and/or resize a background PTY');
  return { providerParameters, strictParameters };
}

export function buildWriteStdinTool(ptyControls: PtyControlWriter): MakaTool {
  const { providerParameters, strictParameters } = createWriteStdinSchemas();
  const providerSchema = zodSchema(providerParameters);
  const parameters = jsonSchema(async () => await providerSchema.jsonSchema, {
    validate: async (value) => {
      const result = await strictParameters.safeParseAsync(value);
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  });
  const parseInput = (value: unknown) => strictParameters.parse(value);
  return {
    name: TOOL_NAMES.taskInput,
    activityKind: 'command',
    description: [
      'Sends text, keys and mouse actions to a background PTY task, and/or resizes it.',
      '',
      '- `task_id` is the ID a `pty: true` background Bash returned.',
      `- Named keys are ${TERMINAL_INPUT_NAMED_KEYS.join(', ')}. Use a printable ASCII key with ctrl or alt for a chord such as Ctrl-B; use a text action for ordinary typing.`,
      '- Mouse coordinates are zero-based terminal cells and only reach an application that has enabled SGR cell mouse reporting.',
      '- Actions are written atomically, in the order listed. They are ordinary audited tool-call data, not a secure channel — never send a secret through them.',
      `- Minimal example: ${WRITE_STDIN_DESCRIPTION_EXAMPLE_JSON}`,
      '- Returns the terminal state at the next parser cut. That is the screen as it stands, NOT output attributed to this input; call again to watch what follows.',
    ].join('\n'),
    parameters,
    permissionArgs: (input) => parseInput(input),
    toModelOutput: ({ output }) => shellRunResultToModelOutput(output),
    impl: (input, ctx) => {
      const { task_id: taskId, input: rawInput, actions, size } = parseInput(input);
      return ptyControls.writeStdin({
        sessionId: ctx.sessionId,
        ref: shellRunResourceRef(taskId),
        ...(rawInput !== undefined ? { input: rawInput } : {}),
        ...(actions !== undefined ? { actions } : {}),
        ...(size !== undefined ? { size } : {}),
        abortSignal: ctx.abortSignal,
      });
    },
  };
}

function normalizeProviderWriteStdinInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const normalized = { ...(value as Record<string, unknown>) };
  if (normalized.actions === null || isEmptyArray(normalized.actions)) {
    delete normalized.actions;
  } else if (Array.isArray(normalized.actions)) {
    normalized.actions = normalized.actions.map(normalizeTerminalInputActionDefaults);
  }
  if (normalized.size === null || isEmptyProviderSize(normalized.size)) delete normalized.size;
  return normalized;
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isEmptyProviderSize(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.every(([key]) => key === 'cols' || key === 'rows') &&
    entries.every(([, field]) => field === undefined || field === null || field === 0)
  );
}

export function shapeTerminalResult(input: {
  cwd: string;
  command: string;
  result: ForegroundBashResult | BoundedShellResult;
}): TerminalToolResult {
  const stdout = redactSecrets(input.result.stdout);
  const stderr = redactSecrets(input.result.stderr);
  const stdoutView = truncateToolOutput(stdout, { direction: 'tail' });
  const stderrView = truncateToolOutput(stderr, { direction: 'tail' });
  return {
    kind: 'terminal',
    cwd: input.cwd,
    cmd: redactSecrets(input.command),
    status: terminalStatus(input.result),
    exitCode: input.result.exitCode,
    output: {
      mode: 'pipes',
      stdout: stdoutView.content,
      stderr: stderrView.content,
      stdoutTruncated: Boolean(input.result.stdoutTruncated) || stdoutView.truncated,
      stderrTruncated: Boolean(input.result.stderrTruncated) || stderrView.truncated,
      redacted: stdout !== input.result.stdout || stderr !== input.result.stderr,
    },
    ...(isLikelySandboxDenial({
      stdout: input.result.stdout,
      stderr: input.result.stderr,
      sandboxed: 'sandboxed' in input.result && input.result.sandboxed === true,
    })
      ? {
          sandboxDenial: {
            likely: true,
            ...('sandboxType' in input.result &&
            (input.result.sandboxType === 'macos-seatbelt' || input.result.sandboxType === 'linux')
              ? { backend: input.result.sandboxType }
              : {}),
          },
        }
      : {}),
  };
}

function terminalStatus(
  result: ForegroundBashResult | BoundedShellResult,
): TerminalToolResult['status'] {
  if (result.timedOut) return 'timed_out';
  if (result.aborted) return 'cancelled';
  return result.exitCode === 0 ? 'completed' : 'failed';
}
