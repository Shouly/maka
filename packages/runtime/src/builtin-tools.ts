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

// packages/runtime/src/builtin-tools.ts
// Baseline tool set. ToolRuntime settlement decorates each tool with durable
// execution facts, while the active session ExecutionBoundary constrains local
// filesystem, shell, and network effects.

import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';
import { jsonSchema, zodSchema } from 'ai';
import {
  closeSync,
  constants,
  fstatSync,
  futimesSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { compilePermissionProfile } from '@maka/core/permission-profile-compiler';
import { parseAttachmentResourceRef } from '@maka/core/attachments';
import { type SandboxBoundaryExpansion } from '@maka/core/sandbox-boundary';
import { isStorageRef, type StorageRef, type ToolResultContent } from '@maka/core/events';
import { type PermissionProfile } from '@maka/core/permission-profile';
import { bashToolResultToModelOutput } from './bash-model-output.js';
import {
  fileWriteToolResultToModelOutput,
  globToolResultToModelOutput,
  grepToolResultToModelOutput,
  readToolResultToModelOutput,
} from './file-tool-model-output.js';
import { GREP_HARD_LINE_CAP } from './search-plan.js';
import { GREP_OUTPUT_MODES, type GrepOutputMode } from './filesystem-worker/protocol.js';
import { openAiApplyPatchInputSchema } from './openai-apply-patch.js';
import { parseCodexV4aPatch } from './codex-v4a-patch.js';
import { executeApplyPatchOperations } from './apply-patch-batch.js';
import {
  bashDescriptionField,
  bashToolDescription,
  buildManagedBashTool,
  buildStopBackgroundTaskTool,
  buildWriteStdinTool,
  shapeTerminalResult,
} from './shell-tools.js';
import type { ShellRunLauncher } from './shell-tools.js';
import { defaultShellPlan, throwIfShellSetupFailed, type TurnShellPlan } from './shell-detect.js';
import type {
  BackgroundTaskStopper,
  PtyControlWriter,
  RuntimeResourceReader,
} from './shell-run-contract.js';
import {
  createLocalWorkspaceExecutor,
  type WorkspaceExecResult,
  type WorkspaceExecutor,
} from './workspace-executor.js';
import {
  createBoundaryFilesystemExecutor,
  type FilesystemExecuteInput,
} from './filesystem-executor.js';

// tool-runtime.ts is the single source of truth for the tool shape; this
// re-export only keeps back-compat for callers that imported from
// builtin-tools directly.
import type { MakaTool, MakaToolContext } from './tool-runtime.js';
export type { MakaTool, MakaToolContext };
import { profileRequiresSandbox, type SandboxManager } from './sandbox/sandbox-manager.js';
import { SandboxCommandError } from './sandbox/errors.js';
import { isLikelySandboxDenial } from './sandbox/detect.js';
import { linuxExecutableRoots } from './sandbox/linux-sandbox.js';
import { pinExistingLinuxProfilePath } from './sandbox/linux-profile-path.js';
import type { SandboxPlatform, SandboxType } from './sandbox/types.js';
import type { ChildFdInput } from './child-fd-input.js';
import { normalizeSandboxBoundaryPath } from './sandbox-boundary-path.js';
import type { FilesystemWorkerClient } from './filesystem-worker/client.js';
import {
  BASH_REQUIRED_BOUNDARY_DESCRIPTION,
  bashBoundaryIntentSchema,
  preflightDeclaredSandboxBoundary,
  preprocessBashBoundaryDeclaration,
  refineBashBoundaryDeclaration,
  sandboxBoundaryExpansionSchema,
  selectedBashBoundaryExpansion,
} from './sandbox-boundary-declaration.js';

// Generous wall-clock cap for the ripgrep-backed Grep tool. A search should be
// near-instant; this only bounds a pathological hang now that the stream
// watchdog is paused during tool execution.
const GREP_TIMEOUT_MS = 120_000;

/** Text file lines one Read returns when the caller does not ask for a limit. */
const DEFAULT_READ_LINE_LIMIT = 2_000;
/** Grep result lines returned when the caller does not ask for a limit. */
const DEFAULT_GREP_HEAD_LIMIT = 250;
/** Matching lines ripgrep may report per file in `content` mode. */
const GREP_MAX_COUNT_PER_FILE = 50;
/** Paths one Glob call returns, after the recency ordering. */
const GLOB_RESULT_LIMIT = 200;

/**
 * The validated Grep arguments.
 *
 * The flag-shaped keys (`-i`, `-n`, `-A`, `-B`, `-C`) are the names ripgrep
 * itself uses, which is what a model already knows; they are legal object keys
 * and legal JSON Schema property names, so the tool surface can speak ripgrep
 * rather than invent a second vocabulary for the same switches.
 */
interface GrepToolInput {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly type?: string;
  readonly output_mode?: GrepOutputMode;
  readonly '-i'?: boolean;
  readonly '-n'?: boolean;
  readonly '-A'?: number;
  readonly '-B'?: number;
  readonly context?: number;
  readonly '-C'?: number;
  readonly head_limit?: number;
  readonly offset?: number;
  readonly multiline?: boolean;
}

/**
 * Which files a session has looked at, so Write can refuse to destroy content
 * the model has never seen.
 *
 * The tools are built once per composer and shared by every session that runs
 * through it, so the ledger is keyed by session and can never be a field on the
 * tool object. It is a cache, not an authority: forgetting an entry costs one
 * extra Read, so both dimensions are bounded and evict least-recently-used —
 * a long-lived host must not accumulate a set per session forever.
 */
const MAX_LEDGER_SESSIONS = 256;
const MAX_LEDGER_PATHS_PER_SESSION = 2048;

class SessionFileSightLedger {
  private readonly sessions = new Map<string, Set<string>>();

  /** Record that `path` (canonical) came back through a file tool in this session. */
  note(sessionId: string | undefined, path: string | undefined): void {
    if (!sessionId || !path) return;
    const seen = this.touch(sessionId);
    // Re-inserting moves the path to the end, which is what makes the eviction
    // below least-recently-used rather than first-seen.
    seen.delete(path);
    seen.add(path);
    evictOldest(seen, MAX_LEDGER_PATHS_PER_SESSION);
  }

  has(sessionId: string | undefined, path: string | undefined): boolean {
    if (!sessionId || !path) return false;
    return this.sessions.get(sessionId)?.has(path) === true;
  }

  private touch(sessionId: string): Set<string> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, existing);
      return existing;
    }
    const created = new Set<string>();
    this.sessions.set(sessionId, created);
    evictOldest(this.sessions, MAX_LEDGER_SESSIONS);
    return created;
  }
}

function evictOldest(entries: Map<string, unknown> | Set<string>, limit: number): void {
  while (entries.size > limit) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
  }
}

/**
 * The canonical spelling a file tool's ledger entry is keyed by. The backends
 * answer with realpath'd targets, so the pre-call lookup has to canonicalise
 * the same way or every spelling of one file would look like a different file.
 */
function canonicalFilePath(cwd: string, path: string): string {
  return canonicalExistingPath(isAbsolute(path) ? path : resolvePath(cwd, path));
}

/**
 * The filesystem worker answered with a well-formed result of a different
 * operation than the one that was requested.
 *
 * Naming the worker told the model about an internal component it cannot
 * address, and the original wording read like an argument complaint — on Edit
 * the likeliest reaction was another `old_string` guess, which can never fix
 * this. But the replacement has to be careful about two things it cannot say.
 *
 * It cannot say the write did not land. Real failures throw; this branch fires
 * on a mislabelled success, and a mislabelled success is still a success as far
 * as the disk is concerned. "Nothing was written to disk" is a claim about a
 * file this code did not look at.
 *
 * And it cannot phrase a failed read as an empty one. "Grep could not be
 * completed inside Copilot, so no matches were produced" reads as a search that
 * ran and found nothing, and a model that takes it that way concludes the
 * pattern is absent from the repository — the opposite of what happened.
 *
 * So a read says no result came back, and says what that does not mean. A write
 * says Copilot cannot tell what happened to the file, and sends the model to look
 * rather than to retry a call that may have already taken effect.
 *
 * Neither may name Bash. Read, Glob and Grep are the entire tool set of a
 * `local_read` child (`agent-catalog.ts`), and `buildToolsForAgentDefinition`
 * hands that child those three tools and nothing else. "Use Bash to do the same
 * work" is, for the caller most likely to be running a bare Grep, an
 * instruction it cannot carry out — a dead end dressed as a way out. The
 * fallback is therefore offered on a condition the model can check for itself,
 * and the sentence ends on a move that is available to every caller.
 *
 * The worker-protocol violation itself still has to reach an operator, so it
 * travels as the `cause`: out of the model's sight, in every log and stack.
 */
function mismatchedWorkerResult(tool: string): Error {
  return new Error(`Filesystem worker returned a mismatched ${tool} result.`);
}

function internalFilesystemReadFailure(tool: string, missing: string, notMeaning: string): Error {
  return new Error(
    `${tool} could not be completed inside Copilot, so ${missing}. ` +
      `This is an internal failure, not a problem with your arguments, and it does not mean ${notMeaning}. ` +
      `Retry the same ${tool} call once. If it fails again, stop calling ${tool}: do the same ` +
      `work with a shell tool if you have one, and otherwise report that ${tool} is failing inside Copilot.`,
    { cause: mismatchedWorkerResult(tool) },
  );
}

function internalFilesystemWriteFailure(tool: string, subject: string, extra?: string): Error {
  return new Error(
    `${tool} could not be completed inside Copilot. Copilot cannot tell whether ${subject}, ` +
      `so treat the file as being in an unknown state. ` +
      `This is an internal failure, not a problem with your arguments${extra ? ` — ${extra}` : ''}. ` +
      `Read the file to find out what it now contains before writing to it again.`,
    { cause: mismatchedWorkerResult(tool) },
  );
}

export interface BuildBuiltinToolsOptions {
  shellRuns?: ShellRunLauncher;
  runtimeResources?: RuntimeResourceReader;
  attachmentResources?: {
    readAttachmentResource(
      sessionId: string,
      artifactId: string,
      abortSignal: AbortSignal,
    ): Promise<ToolResultContent>;
  };
  backgroundTasks?: BackgroundTaskStopper;
  ptyControls?: PtyControlWriter;
  executor?: WorkspaceExecutor;
  /**
   * Turn-scoped shell resolution that runs Bash commands. Defaults to the
   * process-wide detected shell. A broken saved preference rides along as
   * `setupError` and fails closed at the Bash boundary.
   */
  shell?: TurnShellPlan;
  /** Host-only environment overlay for a pre-bound Plugin Shell invocation. */
  shellEnvironment?: Readonly<Record<string, string>>;
  permissionProfile?: PermissionProfile;
  sandboxManager?: SandboxManager;
  /** Sandboxed worker used for all local filesystem tools. */
  filesystemWorker?: Pick<FilesystemWorkerClient, 'execute'>;
  /** Test/embedding override. Production callers use the current process platform. */
  sandboxPlatform?: SandboxPlatform;
  snapshotImage?: (input: {
    sessionId: string;
    ownerId: string;
    bytes: Uint8Array;
    mimeType: string;
  }) => Promise<Extract<StorageRef, { kind: 'session_context' }>>;
  releaseImageSnapshot?: (input: { sessionId: string; refId: string }) => Promise<void>;
}

export function buildBuiltinTools(options: BuildBuiltinToolsOptions = {}): MakaTool[] {
  const executor = options.executor ?? createLocalWorkspaceExecutor();
  const filesystem = createBoundaryFilesystemExecutor({
    workspace: executor,
    ...(options.filesystemWorker ? { worker: options.filesystemWorker } : {}),
    ...(options.permissionProfile ? { permissionProfile: options.permissionProfile } : {}),
  });
  const executionFacts = executor.facts;
  const acceptsResourceRefs = Boolean(options.runtimeResources || options.attachmentResources);
  const fileSight = new SessionFileSightLedger();
  const readDescription = [
    'Reads a file from the local filesystem.',
    '',
    '- `file_path` must be an absolute path, or a path relative to the session cwd; how far outside the cwd it may reach is decided by the session permissions.',
    `- Reads up to ${DEFAULT_READ_LINE_LIMIT} lines by default.`,
    '- When you already know which part of the file you need, only read that part with `offset` and `limit`. This can be important for larger files.',
    '- Results are returned using cat -n format, with line numbers starting at 1',
    ...(options.snapshotImage
      ? [
          '- Reads images (PNG, JPEG, GIF, WebP) and presents them visually rather than as text; line offsets do not apply to them.',
        ]
      : []),
    ...(acceptsResourceRefs
      ? [
          '- Pass `ref` instead of `file_path` to read a whole runtime resource — a background task named by Bash, an attachment named in the conversation. Provide exactly one of `file_path` and `ref`.',
        ]
      : []),
    '- Reading a directory, a missing file, or a path the session permissions do not cover returns an error rather than content; an empty file returns a note. Use Bash `ls` for a listing.',
    '- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and their result already states the new state.',
  ].join('\n');
  const filePathField = z
    .string()
    .describe(
      'The absolute path to the file to read; a path relative to the session cwd is also accepted',
    );
  const offsetField = z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The line number to start reading from, counted from 0. Only provide if the file is too large to read at once',
    )
    .optional();
  const limitField = z
    .number()
    .int()
    .positive()
    .describe(
      `The number of lines to read (default ${DEFAULT_READ_LINE_LIMIT}). Only provide if the file is too large to read at once`,
    )
    .optional();
  const refField = z
    .string()
    .describe('A runtime resource ref provided in the conversation or returned by another tool');
  const fileReadParameters = z
    .object({
      file_path: filePathField,
      offset: offsetField,
      limit: limitField,
    })
    .strict();
  const runtimeResourceReadParameters = z
    .object({
      ref: refField,
    })
    .strict();
  // Some providers serialize every optional field with a default. Normalize
  // only empty fields that cannot carry intent, then let the strict union keep
  // rejecting genuinely ambiguous file-and-resource requests.
  const normalizeProviderReadInput = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const input = value as Record<string, unknown>;
    const ref = input.ref;
    const path = input.file_path;
    if (typeof ref === 'string' && ref.trim() !== '') {
      if (typeof path !== 'string' || path.trim() !== '') return value;
      return Object.fromEntries(
        Object.entries(input).filter(
          ([key]) => key !== 'file_path' && key !== 'offset' && key !== 'limit',
        ),
      );
    }
    if (typeof ref !== 'string' || ref.trim() !== '') return value;
    return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'ref'));
  };
  const strictReadParameters = z.preprocess(
    normalizeProviderReadInput,
    z
      .union([fileReadParameters, runtimeResourceReadParameters])
      .describe(
        'Read a file with file_path, or a whole runtime resource with ref; provide exactly one',
      ),
  );
  // Provider-facing schema: a single top-level object with every field optional.
  // Anthropic rejects a tool definition whose input schema carries a top-level
  // `anyOf`, so the file-vs-ref exclusivity is stated in the field descriptions
  // here and enforced authoritatively by the strict union in `validate` below
  // (see #1228 — a union-generated `anyOf` had been leaking onto the wire).
  const providerReadParameters = z
    .object({
      file_path: filePathField
        .describe(
          'The absolute path to the file to read; a path relative to the session cwd is also accepted. Provide either file_path (optionally with offset/limit) or ref, never both.',
        )
        .optional(),
      offset: offsetField,
      limit: limitField,
      ref: refField
        .describe(
          'A runtime resource ref provided in the conversation or returned by another tool. Provide ref on its own, without file_path/offset/limit; omit it (or leave it empty) when reading a file.',
        )
        .optional(),
    })
    .describe(
      'Read a file with file_path (optionally offset/limit), or a whole runtime resource with ref; provide exactly one of file_path or ref.',
    );
  const providerReadSchema = zodSchema(providerReadParameters);
  const readParameters = acceptsResourceRefs
    ? jsonSchema(async () => await providerReadSchema.jsonSchema, {
        validate: async (value) => {
          const result = await strictReadParameters.safeParseAsync(value);
          return result.success
            ? { success: true, value: result.data }
            : { success: false, error: result.error };
        },
      })
    : fileReadParameters;
  const shell = options.shell ?? { plan: defaultShellPlan() };
  const sandboxPlatform = options.sandboxPlatform ?? process.platform;
  const bashTools = options.shellRuns
    ? [
        buildManagedBashTool(options.shellRuns, {
          executionFacts,
          shell,
          ...(options.sandboxManager
            ? {
                transformCommand: ({ command, pty, requiredBoundary, ctx }) => {
                  const transformed = sandboxCommand(
                    options.sandboxManager!,
                    options.permissionProfile,
                    sandboxPlatform,
                    command,
                    pty,
                    ctx,
                    requiredBoundary,
                    'background_command',
                  );
                  if (!options.shellEnvironment) return transformed;
                  return {
                    ...(transformed ?? { cwd: ctx.cwd }),
                    env: {
                      ...process.env,
                      ...transformed?.env,
                      ...options.shellEnvironment,
                    },
                  };
                },
              }
            : options.shellEnvironment
              ? {
                  transformCommand: ({ ctx }) => ({
                    cwd: ctx.cwd,
                    env: { ...process.env, ...options.shellEnvironment },
                  }),
                }
              : {}),
        }),
      ]
    : [
        buildExecutorBashTool(executor, shell, {
          ...(options.permissionProfile ? { permissionProfile: options.permissionProfile } : {}),
          ...(options.sandboxManager ? { sandboxManager: options.sandboxManager } : {}),
          sandboxPlatform,
        }),
      ];
  const backgroundTools = [
    ...(options.backgroundTasks ? [buildStopBackgroundTaskTool(options.backgroundTasks)] : []),
    ...(options.ptyControls ? [buildWriteStdinTool(options.ptyControls)] : []),
  ];
  const applyPatchTool = {
    name: TOOL_NAMES.applyPatch,
    activityKind: 'edit',
    categoryHint: 'file_write',
    description: [
      "Applies one or more file changes as a patch, in the active provider's patch format.",
      '',
      '- Each operation creates, updates or deletes one file; they are applied in the order given.',
      '- An operation whose context does not match the file on disk is rejected and the batch stops there — the result names how far it got, so a partial application is reported rather than hidden.',
      '- Paths follow the same session-permission rules as Write and Edit.',
      '- Returns what was applied; the files are then current in your context, so do not Read them back.',
    ].join('\n'),
    parameters: openAiApplyPatchInputSchema,
    providerTool: { kind: 'openai-apply-patch' },
    executionFacts,
    impl: async (input, ctx) => {
      if (typeof input !== 'string') {
        const applied = await filesystem.applyPatch({
          operation: input.operation,
          ...filesystemCall(ctx),
        });
        fileSight.note(ctx.sessionId, canonicalFilePath(ctx.cwd, input.operation.path));
        return applied;
      }
      const operations = parseCodexV4aPatch(input);
      return await executeApplyPatchOperations(
        operations,
        async (operation) => {
          await filesystem.applyPatch({ operation, ...filesystemCall(ctx) });
          fileSight.note(ctx.sessionId, canonicalFilePath(ctx.cwd, operation.path));
        },
        ctx.abortSignal,
      );
    },
  } satisfies MakaTool;
  const tools: MakaTool[] = [
    ...bashTools,
    ...backgroundTools,
    {
      name: TOOL_NAMES.read,
      activityKind: 'read',
      description: readDescription,
      parameters: readParameters,
      executionFacts,
      ...(options.releaseImageSnapshot
        ? {
            compensateDurableOutcomeCommitFailure: async (input: {
              readonly result: unknown;
              readonly sessionId: string;
            }) => {
              const result = input.result;
              if (
                !result ||
                typeof result !== 'object' ||
                (result as { kind?: unknown }).kind !== 'image'
              ) {
                return;
              }
              const ref = (result as { ref?: unknown }).ref;
              if (
                !isStorageRef(ref) ||
                ref.kind !== 'session_context' ||
                ref.sessionId !== input.sessionId
              ) {
                return;
              }
              await options.releaseImageSnapshot!({
                sessionId: ref.sessionId,
                refId: ref.refId,
              });
            },
          }
        : {}),
      impl: async (input, ctx) => {
        const { cwd, sessionId, abortSignal } = ctx;
        if ('ref' in input) {
          const { ref } = input;
          if (classifyRuntimeResourceRef(ref) !== 'runtime') {
            throw new Error(`Unsupported runtime resource ref: ${ref}`);
          }
          const attachment = parseAttachmentResourceRef(ref);
          if (attachment) {
            if (!options.attachmentResources) {
              throw new Error('Attachment resources are not available in this toolset');
            }
            return await options.attachmentResources.readAttachmentResource(
              sessionId,
              attachment.artifactId,
              abortSignal,
            );
          }
          if (!options.runtimeResources)
            throw new Error('Runtime resources are not available in this toolset');
          return await options.runtimeResources.readRuntimeResource(sessionId, ref, abortSignal);
        }

        const { file_path: path } = input as { file_path?: string };
        if (typeof path !== 'string' || path === '') {
          throw new Error(
            'Read requires file_path (the file to read) or ref (a runtime resource).',
          );
        }
        const { offset, limit } = input as { offset?: number; limit?: number };
        const runtimeRef = classifyRuntimeResourceRef(path);
        if (runtimeRef === 'unsupported')
          throw new Error(`Unsupported runtime resource ref: ${path}`);
        if (runtimeRef === 'runtime') {
          throw new Error('Runtime resources must be read with the ref parameter, not file_path');
        }
        const result = await filesystem.execute({
          operation: {
            kind: 'read',
            path,
            ...(offset !== undefined ? { offset } : {}),
            // An unbounded Read of an unknown file can spend a whole context
            // window on content the caller never asked for, so the default is a
            // window and `offset` is how the rest is reached.
            limit: limit ?? DEFAULT_READ_LINE_LIMIT,
          },
          ...filesystemCall(ctx),
        });
        if (result.kind === 'read_image') {
          if (!options.snapshotImage)
            throw new Error('Read image snapshots are not available in this toolset.');
          if (!ctx.operationId) {
            throw new Error('Read image snapshots require a durable tool operation identity.');
          }
          const ref = await options.snapshotImage({
            sessionId,
            ownerId: ctx.operationId,
            bytes: result.bytes,
            mimeType: result.mimeType,
          });
          fileSight.note(sessionId, canonicalFilePath(cwd, path));
          return { kind: 'image' as const, mimeType: result.mimeType, ref };
        }
        if (result.kind !== 'read')
          throw internalFilesystemReadFailure(
            'Read',
            'no file content came back',
            'the file is empty or missing',
          );
        // The session has now seen this file, so a later Write may replace it.
        // The read result carries no path, so the request is canonicalised the
        // same way the backends canonicalise their targets.
        fileSight.note(sessionId, canonicalFilePath(cwd, path));
        return { content: result.content };
      },
      toModelOutput: ({ input, output }) => readToolResultToModelOutput(input, output),
    },
    ...(executor.applyPatch ? [applyPatchTool] : []),
    {
      name: TOOL_NAMES.write,
      activityKind: 'edit',
      description: [
        'Writes a file to the local filesystem, overwriting if one exists.',
        '',
        "When to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. For partial changes, use Edit instead.",
      ].join('\n'),
      parameters: z.object({
        file_path: z
          .string()
          .describe(
            'The absolute path to the file to write; a path relative to the session cwd is also accepted. Parent directories must already exist.',
          ),
        content: z.string().describe('The content to write to the file'),
      }),
      executionFacts,
      impl: async (input, ctx) => {
        const { file_path: path } = input as { file_path?: string };
        if (typeof path !== 'string' || path === '')
          throw new Error('Write requires file_path (the file to write).');
        const { content } = input as { content: string };
        const result = await filesystem.execute({
          operation: {
            kind: 'write',
            path,
            content,
            // Whether this call may replace an existing file is a fact about
            // the session, which only this layer knows; the backends enforce
            // it at the point where "new vs existing" is established.
            allowOverwrite: fileSight.has(ctx.sessionId, canonicalFilePath(ctx.cwd, path)),
          },
          ...filesystemCall(ctx),
        });
        if (result.kind !== 'write')
          throw internalFilesystemWriteFailure('Write', 'the file was written');
        fileSight.note(ctx.sessionId, result.path);
        if (result.diff !== undefined)
          return { kind: 'file_diff' as const, paths: [result.path], diff: result.diff };
        return { kind: 'file_write' as const, path: result.path, bytes: result.bytes };
      },
      toModelOutput: ({ output }) => fileWriteToolResultToModelOutput('Write', output),
    },
    {
      name: TOOL_NAMES.edit,
      activityKind: 'edit',
      description: [
        'Performs exact string replacement in a file.',
        '',
        '- You must Read the file in this conversation before editing, or the call will fail.',
        '- `old_string` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (line number + tab) before matching.',
        '- If the exact text is not found, a limited whitespace/indentation-tolerant match is tried; when that is ambiguous the edit fails — Read again and copy the exact text.',
        '- `replace_all: true` replaces every occurrence instead.',
      ].join('\n'),
      parameters: z.object({
        file_path: z
          .string()
          .describe(
            'The absolute path to the file to modify; a path relative to the session cwd is also accepted.',
          ),
        old_string: z.string().describe('The text to replace'),
        new_string: z
          .string()
          .describe('The text to replace it with (must be different from old_string)'),
        replace_all: z
          .boolean()
          .optional()
          .default(false)
          .describe('Replace all occurrences of old_string (default false)'),
      }),
      executionFacts,
      impl: async (input, ctx) => {
        const { file_path: path } = input as { file_path?: string };
        if (typeof path !== 'string' || path === '')
          throw new Error('Edit requires file_path (the file to modify).');
        const { old_string, new_string, replace_all } = input as {
          old_string: string;
          new_string: string;
          replace_all?: boolean;
        };
        const result = await filesystem.execute({
          operation: {
            kind: 'edit',
            path,
            oldString: old_string,
            newString: new_string,
            ...(replace_all ? { replaceAll: true } : {}),
            // Same ledger, and the same reason, as Write's read-before-overwrite
            // guard: an edit written from a remembered shape rather than the
            // file's current text lands on text that is no longer there. Only
            // this layer knows what the session has seen; the backends enforce
            // it once the path has been resolved.
            allowEdit: fileSight.has(ctx.sessionId, canonicalFilePath(ctx.cwd, path)),
          },
          ...filesystemCall(ctx),
        });
        if (result.kind !== 'edit')
          throw internalFilesystemWriteFailure(
            'Edit',
            'the edit was applied',
            'a different old_string will not help',
          );
        fileSight.note(ctx.sessionId, result.path);
        if (result.diff !== undefined)
          return { kind: 'file_diff' as const, paths: [result.path], diff: result.diff };
        return {
          ok: result.ok,
          path: result.path,
          replacements: result.replacements,
          matchedVia: result.matchedVia,
          startLine: result.startLine,
          endLine: result.endLine,
        };
      },
      toModelOutput: ({ output }) => fileWriteToolResultToModelOutput('Edit', output),
    },
    {
      name: TOOL_NAMES.glob,
      activityKind: 'search',
      description: [
        'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
        '',
        `- Matches \`pattern\` case-insensitively against the paths under \`path\` (default: the session cwd).`,
        `- Returns one absolute path per line, MOST RECENTLY MODIFIED LAST and capped at ${GLOB_RESULT_LIMIT} — the cap keeps the newest matches. A capped result says so, so narrow the pattern or the path when you need the rest.`,
        '- Returns "No files found" when nothing matches; a missing search root, or one the session permissions do not cover, fails with the reason.',
        '- Whether the pattern or `path` may leave the session cwd is decided by the session permissions; a pattern that climbs out of it is rejected.',
        '- Use it when you know the shape of a filename. Use Grep when you know what is inside the file.',
      ].join('\n'),
      parameters: z.object({
        pattern: z.string().describe('The glob pattern to match files against, e.g. "**/*.txt".'),
        path: z
          .string()
          .optional()
          .describe(
            'The directory to search in. Omit it for the session working directory; do not pass "undefined" or "null". How far outside the cwd it may reach is decided by the session permissions.',
          ),
      }),
      executionFacts,
      impl: async ({ pattern, path: searchRoot }, ctx) => {
        const result = await filesystem.execute({
          operation: {
            kind: 'glob',
            path: searchRoot ?? '.',
            pattern,
            limit: GLOB_RESULT_LIMIT,
          },
          ...filesystemCall(ctx),
        });
        if (result.kind !== 'glob')
          throw internalFilesystemReadFailure(
            'Glob',
            'no file list came back',
            'no files match the pattern',
          );
        return { files: result.files, ...(result.truncated ? { truncated: true } : {}) };
      },
      toModelOutput: ({ output }) => globToolResultToModelOutput(output),
    },
    {
      name: TOOL_NAMES.grep,
      activityKind: 'search',
      description: [
        'Content search built on ripgrep. Prefer this over `grep`/`rg` via Bash — results integrate with the permission UI and file links.',
        '',
        '- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape literal braces (`interface\\{\\}`).',
        '- Filter with `glob` (e.g. "**/*.tsx") or `type` (e.g. "js", "py", "rust").',
        '- `output_mode`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".',
        '- `multiline: true` for patterns that span lines.',
        `- Results are capped: \`head_limit\` lines (default ${DEFAULT_GREP_HEAD_LIMIT}), and an internal ceiling of ${GREP_HARD_LINE_CAP} lines that \`head_limit: 0\` does not lift. A capped result says how many lines were dropped; \`offset\` pages past them.`,
        '- Returns plain text, or "No matches found". A missing path, or one the session permissions do not cover, fails with the reason.',
      ].join('\n'),
      parameters: z.object({
        pattern: z
          .string()
          .describe('The regular expression pattern to search for in file contents'),
        path: z
          .string()
          .optional()
          .describe(
            'File or directory to search in; absolute or relative. Defaults to the session cwd.',
          ),
        glob: z
          .string()
          .optional()
          .describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}"); maps to rg --glob'),
        type: z
          .string()
          .optional()
          .describe(
            'File type to search (e.g. "js", "py", "rust", "go"); maps to rg --type. More efficient than glob for standard file types.',
          ),
        output_mode: z
          .enum(GREP_OUTPUT_MODES)
          .optional()
          .describe(
            'Output mode: "content" shows matching lines as path:line:text, "files_with_matches" shows only file paths (default), "count" shows per-file occurrence counts.',
          ),
        '-i': z.boolean().optional().describe('Case insensitive search (rg -i)'),
        '-n': z
          .boolean()
          .optional()
          .describe(
            'Show line numbers in output (rg -n). Requires output_mode: "content"; on by default there.',
          ),
        '-A': z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Number of lines to show after each match (rg -A). Requires output_mode: "content".',
          ),
        '-B': z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Number of lines to show before each match (rg -B). Requires output_mode: "content".',
          ),
        context: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Number of lines to show before and after each match (rg -C)'),
        '-C': z.number().int().nonnegative().optional().describe('Alias for context.'),
        head_limit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            `Limit output to the first N result lines (default ${DEFAULT_GREP_HEAD_LIMIT}). 0 removes your limit but the internal ceiling of ${GREP_HARD_LINE_CAP} lines still applies.`,
          ),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Skip the first N result lines, to page past a capped result.'),
        multiline: z
          .boolean()
          .optional()
          .describe(
            'Enable multiline mode where . matches newlines and patterns can span lines (default: false)',
          ),
      }),
      executionFacts,
      impl: async (input, ctx) => {
        const { pattern, path, glob, type, output_mode, context, head_limit, offset, multiline } =
          input as GrepToolInput;
        const ignoreCase = input['-i'];
        const lineNumbers = input['-n'];
        const bothWays = input['-C'] ?? context;
        const after = input['-A'] ?? bothWays;
        const before = input['-B'] ?? bothWays;
        const mode = output_mode ?? 'files_with_matches';
        // `head_limit: 0` is "no limit of mine", not "no limit at all": one
        // search must not be able to spend a whole context window.
        const requested = head_limit ?? DEFAULT_GREP_HEAD_LIMIT;
        const limit =
          requested === 0 ? GREP_HARD_LINE_CAP : Math.min(requested, GREP_HARD_LINE_CAP);
        // Self-bound: ripgrep finishes in well under a second normally, but a
        // pathological tree (network mount, /proc, a FIFO) could hang it. The
        // stream watchdog no longer caps tool execution, so each spawning tool
        // must carry its own wall-clock timeout and honour the turn's abort.
        const result = await filesystem.execute({
          operation: {
            kind: 'grep',
            path: path ?? '.',
            pattern,
            ...(glob ? { glob } : {}),
            ...(type ? { type } : {}),
            outputMode: mode,
            ...(ignoreCase !== undefined ? { ignoreCase } : {}),
            // Context and line numbers are `content` concepts; ripgrep rejects
            // them beside -l/-c, so they are dropped rather than forwarded.
            ...(mode === 'content'
              ? {
                  ...(after !== undefined ? { after } : {}),
                  ...(before !== undefined ? { before } : {}),
                  ...(lineNumbers !== undefined ? { lineNumbers } : {}),
                }
              : {}),
            ...(multiline !== undefined ? { multiline } : {}),
            maxCountPerFile: GREP_MAX_COUNT_PER_FILE,
            limit,
            ...(offset !== undefined ? { offset } : {}),
            timeoutMs: GREP_TIMEOUT_MS,
          },
          ...filesystemCall(ctx),
        });
        if (result.kind !== 'grep')
          throw internalFilesystemReadFailure(
            'Grep',
            'no search result came back',
            'the pattern is absent',
          );
        return {
          matches: result.matches,
          mode: result.mode ?? mode,
          ...(result.truncated ? { truncated: true, omitted: result.omitted ?? 0 } : {}),
        };
      },
      toModelOutput: ({ output }) => grepToolResultToModelOutput(output),
    },
  ];
  return tools;
}

/** The per-call context every file tool hands to the filesystem authority. */
function filesystemCall(
  ctx: MakaToolContext,
): Pick<FilesystemExecuteInput, 'cwd' | 'executionBoundary' | 'permissionMode' | 'abortSignal'> {
  return {
    cwd: ctx.cwd,
    ...(ctx.executionBoundary ? { executionBoundary: ctx.executionBoundary } : {}),
    ...(ctx.permissionMode ? { permissionMode: ctx.permissionMode } : {}),
    ...(ctx.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
  };
}

interface ExecutorBashSandboxOptions {
  permissionProfile?: PermissionProfile;
  sandboxManager?: SandboxManager;
  sandboxPlatform: SandboxPlatform;
}

function buildExecutorBashTool(
  executor: WorkspaceExecutor,
  shell: TurnShellPlan,
  sandboxOptions: ExecutorBashSandboxOptions,
): MakaTool {
  return {
    name: TOOL_NAMES.bash,
    activityKind: 'command',
    description: bashToolDescription(shell, [
      '- The command runs to completion and the result is what it printed. A failure leads with an `Exit code N` line; a command that printed nothing returns "(no output)".',
      '- A timeout, a cancellation or a non-zero exit fails the call and carries the captured output with it.',
      '- `description` is what the user reads in place of the raw command.',
      '- Read, Glob, Grep and Edit do the same work as cat/ls/find/sed with bounded output and the session boundary applied — reach for them first.',
      '- Enforced by the current session sandbox boundary.',
    ]),
    parameters: preprocessBashBoundaryDeclaration(
      z
        .object({
          command: z.string().describe('The command to execute'),
          timeout: z
            .number()
            .int()
            .positive()
            .max(600_000)
            .optional()
            .describe('Optional timeout in milliseconds (max 600000)'),
          description: bashDescriptionField,
          boundary_intent: bashBoundaryIntentSchema,
          required_boundary: sandboxBoundaryExpansionSchema
            .optional()
            .describe(BASH_REQUIRED_BOUNDARY_DESCRIPTION),
        })
        .strict()
        .superRefine(refineBashBoundaryDeclaration),
    ),
    toModelOutput: ({ output }) => bashToolResultToModelOutput(output),
    executionFacts: executor.facts,
    impl: async (input, ctx) => {
      const { command, timeout: requestedTimeout } = input;
      throwIfShellSetupFailed(shell);
      const normalizedRequiredBoundary = await preflightDeclaredSandboxBoundary(
        selectedBashBoundaryExpansion(input),
        ctx,
      );
      const { cwd, abortSignal, emitOutput } = ctx;
      const timeout = requestedTimeout ?? 120_000;
      if (
        !sandboxOptions.sandboxManager &&
        ctx.executionBoundary?.kind === 'managed' &&
        profileRequiresSandbox(ctx.executionBoundary.profile)
      ) {
        throw new SandboxCommandError({
          domain: 'command',
          stage: 'capability',
          reason: 'requires_bypass',
          recoverable: false,
          profileName: ctx.executionBoundary.profile.name ?? ctx.executionBoundary.profile.type,
          message:
            'Managed Bash execution is unavailable because a command sandbox cannot be enforced.',
        });
      }
      const transformed = sandboxOptions.sandboxManager
        ? sandboxCommand(
            sandboxOptions.sandboxManager,
            sandboxOptions.permissionProfile,
            sandboxOptions.sandboxPlatform,
            command,
            false,
            ctx,
            normalizedRequiredBoundary,
          )
        : undefined;
      let successful = false;
      try {
        const result = await executor.exec({
          command,
          cwd: transformed?.cwd ?? cwd,
          ...(transformed?.argv ? { argv: transformed.argv } : {}),
          ...(transformed?.env ? { env: transformed.env } : {}),
          ...(transformed?.fdInputs ? { fdInputs: transformed.fdInputs } : {}),
          timeoutMs: timeout,
          ...(abortSignal ? { abortSignal } : {}),
          emitOutput,
          shell: shell.plan,
        });
        const executionResult = {
          ...result,
          ...(transformed?.sandboxType ? { sandboxType: transformed.sandboxType } : {}),
          ...(transformed?.profileName ? { profileName: transformed.profileName } : {}),
          sandboxed:
            transformed?.sandboxType === 'macos-seatbelt' || transformed?.sandboxType === 'linux',
        };
        if (executionResult.timedOut)
          throw terminalError(`Command timed out after ${timeout}ms`, executionResult, 124);
        if (executionResult.aborted) throw terminalError('Command aborted', executionResult, 130);
        if (executionResult.exitCode !== 0) {
          throw terminalError(
            `Command failed with exit code ${executionResult.exitCode}`,
            executionResult,
            executionResult.exitCode,
          );
        }
        successful = true;
        return shapeTerminalResult({ cwd, command, result: executionResult });
      } finally {
        transformed?.onCompletion?.({ successful });
      }
    },
  };
}

function sandboxCommand(
  manager: SandboxManager,
  explicitProfile: PermissionProfile | undefined,
  platform: SandboxPlatform,
  command: string,
  pty: boolean,
  ctx: MakaToolContext,
  requiredBoundary?: SandboxBoundaryExpansion,
  domain: 'command' | 'background_command' = 'command',
):
  | {
      argv?: readonly string[];
      cwd: string;
      env?: NodeJS.ProcessEnv;
      fdInputs?: readonly ChildFdInput[];
      sandboxType?: SandboxType;
      profileName?: string;
      onCompletion?: (outcome: { successful: boolean }) => void;
    }
  | undefined {
  const cwd = canonicalExistingPath(ctx.cwd);
  const boundary = ctx.executionBoundary;
  if (boundary?.kind === 'bypass' || boundary?.kind === 'external') return undefined;
  const effective =
    boundary?.kind === 'managed'
      ? { profile: boundary.profile, workspaceRoots: [cwd] }
      : effectivePermissionProfile(explicitProfile, ctx.permissionMode ?? 'ask', cwd);
  const env = { ...process.env };
  if (pty) {
    if (profileRequiresSandbox(effective.profile)) {
      throw new SandboxCommandError({
        domain,
        stage: 'capability',
        reason: boundary ? 'requires_bypass' : 'pty_sandbox_unavailable',
        recoverable: false,
        profileName: effective.profile.name ?? effective.profile.type,
        message:
          'PTY Bash is unavailable while the active permission profile requires command sandboxing.',
      });
    }
    return undefined;
  }
  // The Windows broker sandboxes the purpose-built filesystem worker (an
  // AppContainer-compatible executable), but it cannot launch an arbitrary
  // shell: cmd.exe/pwsh fail DLL initialization (STATUS_DLL_INIT_FAILED,
  // 0xC0000142) inside a capability-less AppContainer, and the POSIX `/bin/sh`
  // this path emits is not a launchable Windows executable at all. Bash command
  // sandboxing is therefore unavailable on win32 in this milestone. Route it
  // through the shared "command sandbox unavailable" contract rather than
  // handing the broker an unlaunchable manifest: fail closed when the profile
  // requires a sandbox, otherwise return undefined so the caller runs the
  // command through the detected Windows shell (unsandboxed), exactly as an
  // explicit bypass boundary already does.
  const commandSandboxUnavailable =
    platform === 'win32' || !manager.canEnforce({ profile: effective.profile, platform });
  if (commandSandboxUnavailable) {
    if (profileRequiresSandbox(effective.profile)) {
      const selection = manager.selectInitial({
        profile: effective.profile,
        platform,
      });
      throw new SandboxCommandError({
        domain,
        stage: selection.ok ? 'capability' : 'selection',
        reason: selection.ok ? 'backend_not_available' : selection.reason,
        backend: selection.sandboxType,
        recoverable: false,
        profileName: effective.profile.name ?? effective.profile.type,
        message: `Command sandbox is required but unavailable on platform ${platform}.`,
      });
    }
    return undefined;
  }

  let preparedProfile: PreparedLinuxProfilePaths = {
    paths: [],
    unavailablePaths: [],
  };
  try {
    preparedProfile = prepareLinuxBashProfilePaths(
      platform,
      effective.profile,
      effective.workspaceRoots,
      requiredBoundary,
    );
  } catch {
    throw new SandboxCommandError({
      domain,
      stage: 'validation',
      reason: 'sandbox_path_changed',
      backend: 'linux',
      recoverable: false,
      profileName: effective.profile.name ?? effective.profile.type,
      message: 'An approved sandbox path could not be pinned safely.',
    });
  }
  const onCompletion = preparedProfilePathCompletion(preparedProfile.paths);

  let result: ReturnType<SandboxManager['transform']>;
  try {
    result = manager.transform({
      platform,
      command: {
        program: '/bin/sh',
        args: ['-c', command],
        cwd,
        env,
        profile: effective.profile,
        pathContext: {
          workspaceRoots: effective.workspaceRoots,
          tmpdir: tmpdir(),
          ...(platform === 'win32' ? {} : { slashTmp: '/tmp' }),
          ...(platform === 'darwin'
            ? {
                executableRoots: macosRuntimeExecutableRoots(process.execPath),
              }
            : {}),
          ...(platform === 'linux'
            ? {
                minimalRoots: linuxExecutableRoots({
                  execPath: process.execPath,
                  path: env.PATH,
                }),
                ...(preparedProfile.paths.length > 0
                  ? {
                      pinnedProfilePaths: preparedProfile.paths.map((path) => ({
                        path: path.path,
                        access: path.access,
                        fd: path.childFd,
                        sourceFd: path.sourceFd,
                        releaseSource: path.releaseSource,
                      })),
                    }
                  : {}),
                ...(preparedProfile.unavailablePaths.length > 0
                  ? {
                      unavailableProfilePaths: preparedProfile.unavailablePaths,
                    }
                  : {}),
              }
            : {}),
        },
      },
    });
  } catch (error) {
    onCompletion?.({ successful: false });
    throw error;
  }
  if (!result.ok) {
    onCompletion?.({ successful: false });
    throw new SandboxCommandError({
      domain,
      stage: 'transform',
      reason: result.reason,
      backend: result.sandboxType,
      recoverable: false,
      profileName: effective.profile.name ?? effective.profile.type,
      message: result.message ?? `Sandbox transform failed: ${result.reason}`,
    });
  }
  return {
    argv: result.exec.argv,
    cwd: result.exec.cwd,
    ...(result.exec.env ? { env: { ...result.exec.env } } : {}),
    ...(result.exec.fdInputs ? { fdInputs: result.exec.fdInputs } : {}),
    sandboxType: result.exec.sandboxType,
    profileName: result.exec.effectiveProfile.name ?? result.exec.effectiveProfile.type,
    ...(onCompletion ? { onCompletion } : {}),
  };
}

interface PreparedProfilePath {
  readonly path: string;
  readonly access: 'read' | 'write';
  readonly created: boolean;
  readonly sourceFd: number;
  readonly releaseSource: () => void;
  readonly childFd: number;
  readonly device: bigint;
  readonly inode: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface PreparedLinuxProfilePaths {
  readonly paths: readonly PreparedProfilePath[];
  readonly unavailablePaths: readonly string[];
}

function prepareLinuxBashProfilePaths(
  platform: SandboxPlatform,
  profile: PermissionProfile,
  workspaceRoots: readonly string[],
  requiredBoundary?: SandboxBoundaryExpansion,
): PreparedLinuxProfilePaths {
  if (
    platform !== 'linux' ||
    profile.type !== 'managed' ||
    profile.fileSystem.kind !== 'restricted'
  ) {
    return { paths: [], unavailablePaths: [] };
  }
  const activeExactPaths = new Set(
    (requiredBoundary?.filesystem?.entries ?? []).flatMap((entry) =>
      entry.scope === 'exact' ? [entry.path] : [],
    ),
  );
  const candidates = new Map<string, { access: 'read' | 'write'; match: 'exact' | 'subtree' }>();
  for (const entry of profile.fileSystem.entries) {
    if (entry.access === 'deny') continue;
    if (entry.kind === 'special') {
      if (entry.special !== ':workspace_roots') continue;
      for (const workspaceRoot of workspaceRoots) {
        const existing = candidates.get(workspaceRoot);
        candidates.set(
          workspaceRoot,
          existing?.access === 'write' ? existing : { access: entry.access, match: 'subtree' },
        );
      }
      continue;
    }
    const match = entry.match ?? 'subtree';
    if (match === 'exact' && !activeExactPaths.has(entry.path)) continue;
    const existing = candidates.get(entry.path);
    candidates.set(
      entry.path,
      existing?.access === 'write' ? existing : { access: entry.access, match },
    );
  }
  const prepared: PreparedProfilePath[] = [];
  const unavailablePaths: string[] = [];
  try {
    for (const [target, { access, match }] of candidates) {
      const existing = (() => {
        try {
          return lstatSync(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
      })();
      if (!existing) {
        if (match !== 'exact' || access !== 'write') {
          unavailablePaths.push(target);
          continue;
        }
        const fd = openMissingExactWriteTarget(target);
        let sourceOpen = true;
        const releaseSource = () => {
          if (!sourceOpen) return;
          sourceOpen = false;
          closeSync(fd);
        };
        try {
          // A deliberately old marker distinguishes a successful no-op from an
          // intentional empty write, which updates mtime/ctime even at size zero.
          futimesSync(fd, 1, 1);
          const metadata = fstatSync(fd, { bigint: true });
          prepared.push({
            path: target,
            access,
            created: true,
            sourceFd: fd,
            releaseSource,
            childFd: 4 + prepared.length,
            device: metadata.dev,
            inode: metadata.ino,
            mtimeNs: metadata.mtimeNs,
            ctimeNs: metadata.ctimeNs,
          });
        } catch (error) {
          releaseSource();
          throw error;
        }
        continue;
      }
      const pinned = pinExistingLinuxProfilePath({
        path: target,
        access,
        targetType: match === 'exact' ? 'file' : 'directory',
        childFd: 4 + prepared.length,
      });
      if (!pinned) throw new Error(`Approved sandbox path disappeared: ${target}`);
      prepared.push({ ...pinned, created: false });
    }
    return { paths: prepared, unavailablePaths };
  } catch (error) {
    completePreparedProfilePaths(prepared);
    throw error;
  }
}

/** @internal Exported for the Linux parent-swap regression test. */
export function openMissingExactWriteTarget(path: string, afterParentPinned?: () => void): number {
  const parent = dirname(path);
  if (realpathSync(parent) !== parent) throw new Error('Exact write target parent changed.');

  const createFlags =
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0);
  if (process.platform !== 'linux') return openSync(path, createFlags, 0o666);

  const linuxConstants = constants as typeof constants & { O_PATH?: number };
  const parentFlags =
    (linuxConstants.O_PATH ?? constants.O_RDONLY) |
    (constants.O_DIRECTORY ?? 0) |
    (constants.O_NOFOLLOW ?? 0);
  const parentFd = openSync(parent, parentFlags);
  try {
    const pinnedParent = `/proc/self/fd/${parentFd}`;
    afterParentPinned?.();
    if (realpathSync(pinnedParent) !== parent) {
      throw new Error('Exact write target parent changed after pinning.');
    }
    return openSync(`${pinnedParent}/${basename(path)}`, createFlags, 0o666);
  } finally {
    closeSync(parentFd);
  }
}

function preparedProfilePathCompletion(
  paths: readonly PreparedProfilePath[],
): ((outcome: { successful: boolean }) => void) | undefined {
  if (paths.length === 0) return undefined;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    completePreparedProfilePaths(paths);
  };
}

function completePreparedProfilePaths(paths: readonly PreparedProfilePath[]): void {
  for (const target of paths) {
    try {
      target.releaseSource();
    } catch {
      // Launch cleanup is best effort; the close-once owner prevents fd-number reuse bugs.
    }
    if (!target.created) continue;
    try {
      const metadata = lstatSync(target.path, { bigint: true });
      const untouched = metadata.mtimeNs === target.mtimeNs && metadata.ctimeNs === target.ctimeNs;
      if (
        metadata.isFile() &&
        metadata.dev === target.device &&
        metadata.ino === target.inode &&
        metadata.size === 0n &&
        untouched
      ) {
        unlinkSync(target.path);
      }
    } catch {
      // The target was already removed or changed; never delete an unverified replacement.
    }
  }
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function macosRuntimeExecutableRoots(execPath: string): readonly string[] {
  return [
    ...linuxExecutableRoots({ execPath }),
    ...(execPath.startsWith('/opt/homebrew/') ? ['/opt/homebrew'] : []),
    ...(execPath.startsWith('/usr/local/') ? ['/usr/local'] : []),
  ];
}

function effectivePermissionProfile(
  explicitProfile: PermissionProfile | undefined,
  permissionMode: NonNullable<MakaToolContext['permissionMode']>,
  cwd: string,
): { profile: PermissionProfile; workspaceRoots: readonly string[] } {
  const canonicalCwd = canonicalExistingPath(cwd);
  if (explicitProfile) return { profile: explicitProfile, workspaceRoots: [canonicalCwd] };
  const compiled = compilePermissionProfile({
    mode: permissionMode,
    cwd: canonicalCwd,
  });
  return { profile: compiled.profile, workspaceRoots: compiled.workspaceRoots };
}

function terminalError(
  message: string,
  result: Pick<WorkspaceExecResult, 'stdout' | 'stderr' | 'stdoutTruncated' | 'stderrTruncated'> & {
    sandboxType?: SandboxType;
    sandboxed?: boolean;
    profileName?: string;
  },
  code: number,
): Error {
  const sandboxDenied = isLikelySandboxDenial({
    stdout: result.stdout,
    stderr: result.stderr,
    sandboxed: result.sandboxed === true,
  });
  const error = sandboxDenied
    ? new SandboxCommandError({
        domain: 'command',
        stage: 'operation',
        reason: 'sandbox_denial',
        backend: result.sandboxType,
        recoverable: true,
        profileName: result.profileName,
        message,
      })
    : new Error(message);
  Object.assign(error, {
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    code,
    ...(result.sandboxType ? { sandboxType: result.sandboxType } : {}),
    sandboxed: result.sandboxed === true,
    ...(sandboxDenied ? { reason: 'sandbox_denial', recoverable: true } : {}),
  });
  return error;
}

export function classifyRuntimeResourceRef(path: string): 'runtime' | 'file' | 'unsupported' {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return path.trimStart().toLowerCase().startsWith('maka:') ? 'unsupported' : 'file';
  }
  if (url.protocol !== 'maka:') return 'file';
  if (
    url.hostname !== 'runtime' ||
    url.username ||
    url.password ||
    url.port ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    return 'unsupported';
  }
  return 'runtime';
}
