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
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { FileChangeTrackerRegistry, type SessionFileChangeTracker } from './file-change-tracker.js';
import { binaryExtensionOf, readBinaryFileMessage } from './binary-extensions.js';
import { isSupportedImagePath } from './image-file.js';
import {
  applyNotebookEdit,
  isNotebookPath,
  parseNotebook,
  renderNotebookForRead,
  serializeNotebook,
} from './notebook.js';
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
import { GLOB_RESULT_LIMIT, respellSearchLine, splitAbsoluteGlobPattern } from './search-plan.js';
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
import { sandboxedEnvironment } from './sandbox/sandbox-environment.js';
import { isLikelySandboxDenial } from './sandbox/detect.js';
import { linuxExecutableRoots } from './sandbox/linux-sandbox.js';
import { materializeApprovedWriteDirectories } from './sandbox-boundary-path.js';
import { pinExistingLinuxProfilePath } from './sandbox/linux-profile-path.js';
import type { SandboxPlatform, SandboxType } from './sandbox/types.js';
import type { ChildFdInput } from './child-fd-input.js';
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

/** Grep result lines returned when the caller does not ask for a limit. */
const DEFAULT_GREP_HEAD_LIMIT = 250;

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
  readonly '-o'?: boolean;
  readonly '-A'?: number;
  readonly '-B'?: number;
  readonly context?: number;
  readonly '-C'?: number;
  readonly head_limit?: number;
  readonly offset?: number;
  readonly multiline?: boolean;
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
 * Failures as the file tools answer them. A refusal before anything ran is
 * wrapped in `<tool_use_error>` — every Write and Edit failure, and Read's
 * binary-file refusal; everything else is the bare message.
 */
function wrappedToolError(message: string): string {
  return `<tool_use_error>${message}</tool_use_error>`;
}

function bareToolError(message: string): string {
  return message;
}

function readErrorToModelText(message: string): string {
  return message.startsWith('This tool cannot read binary files.')
    ? wrappedToolError(message)
    : message;
}

/** Edit's answer for a path with no file, from either backend. */
function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('File does not exist.');
}

/** A write that landed on a directory, from either backend. */
function isDirectoryTargetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as NodeJS.ErrnoException).code === 'EISDIR' || /\bEISDIR\b/.test(error.message);
}

/**
 * A leading `~` in a path argument is the user's home. Models write
 * `~/notes.md` the way people do, and taken literally it names a directory
 * called `~` under the cwd — where a Write would quietly land.
 */
function expandHomePath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
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
  /**
   * Which files each session has read and written, and whether they still are
   * as the model last saw them. Shared with the session's backend, which
   * reports the changes on tool results; defaults to a registry of this tool
   * set's own.
   */
  fileChanges?: FileChangeTrackerRegistry;
  /** Sandboxed worker the file tools run through under a managed boundary. */
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
  const fileChanges = options.fileChanges ?? new FileChangeTrackerRegistry();
  const trackerFor = (sessionId: string | undefined): SessionFileChangeTracker | undefined =>
    sessionId ? fileChanges.forSession(sessionId) : undefined;
  const readDescription = [
    'Reads a file from the local filesystem.',
    '',
    '- `file_path` must be an absolute path.',
    '- Reads up to 2000 lines by default.',
    '- When you already know which part of the file you need, only read that part. This can be important for larger files.',
    '- Results are returned using cat -n format, with line numbers starting at 1',
    // The reference also reads PDFs by page; Maka has no PDF renderer, so a
    // PDF is refused as a binary file and `pages` does not exist.
    '- Reads images (PNG, JPG, …) and presents them visually. Reads Jupyter notebooks (.ipynb) as cells with outputs.',
    // Maka's own: attachments are runtime resources, read by ref.
    ...(acceptsResourceRefs
      ? [
          '- Pass `ref` instead of `file_path` to read a whole runtime resource — an attachment named in the conversation. A background command is read by its output file path, like any other file. Provide exactly one of `file_path` and `ref`.',
        ]
      : []),
    '- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.',
    '- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.',
  ].join('\n');
  const filePathField = z.string().describe('The absolute path to the file to read');
  const offsetField = z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The line number to start reading from. Only provide if the file is too large to read at once',
    )
    .optional();
  const limitField = z
    .number()
    .int()
    .positive()
    .describe('The number of lines to read. Only provide if the file is too large to read at once.')
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
          'The absolute path to the file to read. Provide either file_path (optionally with offset/limit) or ref, never both.',
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
                  // A sandboxed command keeps the environment the sandbox
                  // chose for it; only an unsandboxed one inherits the host's.
                  return {
                    ...(transformed ?? { cwd: ctx.cwd }),
                    env: {
                      ...(transformed?.env ?? process.env),
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
      // A leading ~ is the home directory here as it is for Write and Edit.
      if (typeof input !== 'string') {
        const operation = { ...input.operation, path: expandHomePath(input.operation.path) };
        const applied = await filesystem.applyPatch({ operation, ...filesystemCall(ctx) });
        await trackerFor(ctx.sessionId)?.noteWritten(canonicalFilePath(ctx.cwd, operation.path));
        return applied;
      }
      const operations = parseCodexV4aPatch(input).map((operation) => ({
        ...operation,
        path: expandHomePath(operation.path),
      }));
      return await executeApplyPatchOperations(
        operations,
        async (operation) => {
          await filesystem.applyPatch({ operation, ...filesystemCall(ctx) });
          await trackerFor(ctx.sessionId)?.noteWritten(canonicalFilePath(ctx.cwd, operation.path));
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

        const { file_path: requestedPath } = input as { file_path?: string };
        if (typeof requestedPath !== 'string' || requestedPath === '') {
          throw new Error(
            'Read requires file_path (the file to read) or ref (a runtime resource).',
          );
        }
        const path = expandHomePath(requestedPath);
        const { offset, limit } = input as { offset?: number; limit?: number };
        const runtimeRef = classifyRuntimeResourceRef(path);
        if (runtimeRef === 'unsupported')
          throw new Error(`Unsupported runtime resource ref: ${path}`);
        if (runtimeRef === 'runtime') {
          throw new Error('Runtime resources must be read with the ref parameter, not file_path');
        }
        // A binary format is refused by its name, before the file is looked at.
        const binary = binaryExtensionOf(path);
        if (binary && !isSupportedImagePath(path)) {
          throw new Error(readBinaryFileMessage(binary));
        }
        const notebook = isNotebookPath(path);
        const tracker = trackerFor(sessionId);
        const canonical = canonicalFilePath(cwd, path);
        // The range as the call asked for it, to recognise the same Read again.
        const range = notebook ? 'notebook' : `${offset ?? ''}:${limit ?? ''}`;
        if (await tracker?.isRepeatRead(canonical, ctx.turnId, range)) {
          return { unchanged: true as const };
        }
        const result = await filesystem.execute({
          operation: {
            kind: 'read',
            path,
            // A notebook is shown whole, as its cells.
            ...(!notebook && offset !== undefined ? { offset } : {}),
            ...(!notebook && limit ? { limit } : {}),
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
          await tracker?.noteRead(canonical);
          return { kind: 'image' as const, mimeType: result.mimeType, ref };
        }
        if (result.kind !== 'read')
          throw internalFilesystemReadFailure(
            'Read',
            'no file content came back',
            'the file is empty or missing',
          );
        // The read result carries no path, so the request is canonicalised the
        // same way the backends canonicalise their targets.
        await tracker?.noteRead(canonical, { turnId: ctx.turnId, range });
        if (notebook) {
          const parsed = parseNotebook(result.content);
          if (parsed) return { content: renderNotebookForRead(parsed), notebook: true as const };
        }
        return {
          content: result.content,
          startLine: result.startLine,
          totalLines: result.totalLines,
          ...(result.beyondEnd ? { beyondEnd: true as const } : {}),
        };
      },
      toModelOutput: ({ input, output }) => readToolResultToModelOutput(input, output),
      errorToModelText: readErrorToModelText,
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
          .describe('The absolute path to the file to write (must be absolute, not relative)'),
        content: z.string().describe('The content to write to the file'),
      }),
      executionFacts,
      impl: async (input, ctx) => {
        const { file_path: requestedPath } = input as { file_path?: string };
        if (typeof requestedPath !== 'string' || requestedPath === '')
          throw new Error('Write requires file_path (the file to write).');
        const path = expandHomePath(requestedPath);
        const { content } = input as { content: string };
        const tracker = trackerFor(ctx.sessionId);
        const canonical = canonicalFilePath(ctx.cwd, path);
        // A file that changed since the session last read it is written from a
        // shape that is no longer there: refuse until a Read refreshes it. A
        // file the session never read is written without asking.
        await tracker?.assertUnchanged(canonical);
        let result: Awaited<ReturnType<typeof filesystem.execute>>;
        try {
          result = await filesystem.execute({
            operation: { kind: 'write', path, content },
            ...filesystemCall(ctx),
          });
        } catch (error) {
          if (!isDirectoryTargetError(error)) throw error;
          throw new Error(
            `${requestedPath} is a directory, not a file. To create a file inside it, include the file name in file_path.`,
          );
        }
        if (result.kind !== 'write')
          throw internalFilesystemWriteFailure('Write', 'the file was written');
        await tracker?.noteWritten(result.path);
        // The model is answered with the path as it wrote it.
        if (result.diff !== undefined) {
          return {
            kind: 'file_diff' as const,
            paths: [result.path],
            diff: result.diff,
            shownPath: requestedPath,
          };
        }
        return {
          kind: 'file_write' as const,
          path: result.path,
          bytes: result.bytes,
          created: result.created,
          shownPath: requestedPath,
        };
      },
      toModelOutput: ({ output }) => fileWriteToolResultToModelOutput('Write', output),
      errorToModelText: wrappedToolError,
    },
    {
      name: TOOL_NAMES.edit,
      activityKind: 'edit',
      description: [
        'Performs exact string replacement in a file.',
        '',
        '- You must Read the file in this conversation before editing, or the call will fail.',
        '- `old_string` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (line number + tab) before matching.',
        '- `replace_all: true` replaces every occurrence instead.',
      ].join('\n'),
      parameters: z.object({
        file_path: z.string().describe('The absolute path to the file to modify'),
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
        const { file_path: requestedPath } = input as { file_path?: string };
        if (typeof requestedPath !== 'string' || requestedPath === '')
          throw new Error('Edit requires file_path (the file to modify).');
        const path = expandHomePath(requestedPath);
        const { old_string, new_string, replace_all } = input as {
          old_string: string;
          new_string: string;
          replace_all?: boolean;
        };
        if (isNotebookPath(path)) {
          throw new Error('File is a Jupyter Notebook. Use the NotebookEdit to edit this file.');
        }
        const tracker = trackerFor(ctx.sessionId);
        const canonical = canonicalFilePath(ctx.cwd, path);
        // Read or not, the edit applies: old_string has to be in the file as
        // it is now. A file that changed since the session read it is edited
        // all the same, and the receipt says the rest of it may be news.
        const modifiedSinceRead = (await tracker?.isChangedSince(canonical)) === true;
        let result: Awaited<ReturnType<typeof filesystem.execute>>;
        try {
          result = await filesystem.execute({
            operation: {
              kind: 'edit',
              path,
              oldString: old_string,
              newString: new_string,
              ...(replace_all ? { replaceAll: true } : {}),
            },
            ...filesystemCall(ctx),
          });
        } catch (error) {
          // An empty old_string creates the file it names.
          if (old_string !== '' || !isMissingFileError(error)) throw error;
          const written = await filesystem.execute({
            operation: { kind: 'write', path, content: new_string },
            ...filesystemCall(ctx),
          });
          if (written.kind !== 'write')
            throw internalFilesystemWriteFailure('Edit', 'the file was created');
          await tracker?.noteWritten(written.path);
          return written.diff !== undefined
            ? {
                kind: 'file_diff' as const,
                paths: [written.path],
                diff: written.diff,
                shownPath: requestedPath,
              }
            : {
                kind: 'file_write' as const,
                path: written.path,
                bytes: written.bytes,
                created: true,
                shownPath: requestedPath,
              };
        }
        if (result.kind !== 'edit')
          throw internalFilesystemWriteFailure(
            'Edit',
            'the edit was applied',
            'a different old_string will not help',
          );
        await tracker?.noteWritten(result.path);
        const receipt = {
          shownPath: requestedPath,
          ...(modifiedSinceRead ? { modifiedSinceRead: true as const } : {}),
        };
        if (result.diff !== undefined)
          return {
            kind: 'file_diff' as const,
            paths: [result.path],
            diff: result.diff,
            ...receipt,
          };
        return {
          ok: result.ok,
          path: result.path,
          replacements: result.replacements,
          matchedVia: result.matchedVia,
          startLine: result.startLine,
          endLine: result.endLine,
          ...receipt,
        };
      },
      toModelOutput: ({ input, output }) => fileWriteToolResultToModelOutput('Edit', output, input),
      errorToModelText: wrappedToolError,
    },
    {
      name: TOOL_NAMES.notebookEdit,
      activityKind: 'edit',
      categoryHint: 'file_write',
      description: [
        'Replaces, inserts, or deletes a single cell in a Jupyter notebook (.ipynb file).',
        '',
        'Usage:',
        '- You must use the Read tool on the notebook in this conversation before editing — this tool will fail otherwise.',
        '- `notebook_path` must be an absolute path.',
        '- `cell_id` is the `id` attribute shown in the Read tool\'s `<cell id="...">` output. It is required for `replace` and `delete`.',
        '- `edit_mode` defaults to `replace`. Use `insert` to add a new cell after the cell with the given `cell_id` (or at the beginning of the notebook if `cell_id` is omitted) — `cell_type` is required when inserting. Use `delete` to remove the cell.',
      ].join('\n'),
      parameters: z.object({
        notebook_path: z
          .string()
          .describe(
            'The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)',
          ),
        new_source: z.string().describe('The new source for the cell'),
        cell_id: z
          .string()
          .optional()
          .describe(
            'The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.',
          ),
        cell_type: z
          .enum(['code', 'markdown'])
          .optional()
          .describe(
            'The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.',
          ),
        edit_mode: z
          .enum(['replace', 'insert', 'delete'])
          .optional()
          .describe('The type of edit to make (replace, insert, delete). Defaults to replace.'),
      }),
      executionFacts,
      impl: async (input, ctx) => {
        const { notebook_path, new_source, cell_id, cell_type, edit_mode } = input as {
          notebook_path: string;
          new_source: string;
          cell_id?: string;
          cell_type?: 'code' | 'markdown';
          edit_mode?: 'replace' | 'insert' | 'delete';
        };
        const path = expandHomePath(notebook_path);
        if (!isNotebookPath(path)) {
          throw new Error(
            'File must be a Jupyter notebook (.ipynb file). For editing other file types, use the Edit tool.',
          );
        }
        const tracker = trackerFor(ctx.sessionId);
        const canonical = canonicalFilePath(ctx.cwd, path);
        // The one file tool that insists on a Read first: a cell id is only
        // ever known from the Read's rendering of the notebook.
        if (tracker && !tracker.has(canonical)) {
          throw new Error('File has not been read yet. Read it first before writing to it.');
        }
        await tracker?.assertUnchanged(canonical);
        const read = await filesystem.execute({
          operation: { kind: 'read', path },
          ...filesystemCall(ctx),
        });
        if (read.kind !== 'read')
          throw internalFilesystemReadFailure(
            'NotebookEdit',
            'no notebook came back',
            'the notebook is missing',
          );
        const notebook = parseNotebook(read.content);
        if (!notebook) throw new Error('File is not a valid Jupyter notebook.');
        const edited = applyNotebookEdit(notebook, {
          cellId: cell_id,
          newSource: new_source,
          cellType: cell_type,
          editMode: edit_mode,
        });
        const written = await filesystem.execute({
          operation: { kind: 'write', path, content: serializeNotebook(edited.notebook) },
          ...filesystemCall(ctx),
        });
        if (written.kind !== 'write')
          throw internalFilesystemWriteFailure('NotebookEdit', 'the notebook was written');
        await tracker?.noteWritten(written.path);
        return edited.message;
      },
      toModelOutput: ({ output }) =>
        typeof output === 'string' ? { type: 'text', value: output } : undefined,
      errorToModelText: wrappedToolError,
    },
    {
      name: TOOL_NAMES.glob,
      activityKind: 'search',
      description:
        'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
      parameters: z.object({
        pattern: z.string().describe('The glob pattern to match files against'),
        path: z
          .string()
          .optional()
          .describe(
            'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
          ),
      }),
      executionFacts,
      impl: async ({ pattern, path: searchRoot }, ctx) => {
        // Under strict decoding a model cannot leave an optional field out
        // and sends the empty string; that is the default, not a path.
        const search = splitAbsoluteGlobPattern(pattern) ?? {
          root: searchRoot === undefined || searchRoot === '' ? '.' : expandHomePath(searchRoot),
          pattern,
        };
        const result = await filesystem.execute({
          operation: {
            kind: 'glob',
            path: search.root,
            pattern: search.pattern,
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
        // Joined onto the root as it was written, so `/tmp` stays `/tmp`
        // rather than the `/private/tmp` the search resolved it to.
        const root = resolvePath(ctx.cwd, search.root);
        const omitted = result.total - result.files.length;
        return {
          files: result.files.map((file) => join(root, file)),
          cwd: ctx.cwd,
          ...(omitted > 0 ? { truncated: true, omitted } : {}),
        };
      },
      toModelOutput: ({ output }) => globToolResultToModelOutput(output),
      errorToModelText: bareToolError,
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
      ].join('\n'),
      parameters: z.object({
        pattern: z
          .string()
          .describe('The regular expression pattern to search for in file contents'),
        path: z
          .string()
          .optional()
          .describe(
            'File or directory to search in (rg PATH). Defaults to current working directory.',
          ),
        glob: z
          .string()
          .optional()
          .describe('Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob'),
        type: z
          .string()
          .optional()
          .describe(
            'File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.',
          ),
        output_mode: z
          .enum(GREP_OUTPUT_MODES)
          .optional()
          .describe(
            'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
          ),
        '-i': z.boolean().optional().describe('Case insensitive search (rg -i)'),
        '-n': z
          .boolean()
          .optional()
          .describe(
            'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
          ),
        '-o': z
          .boolean()
          .optional()
          .describe(
            'Print only the matched (non-empty) parts of each matching line, one match per output line (rg -o / --only-matching). Requires output_mode: "content", ignored otherwise. Defaults to false.',
          ),
        '-A': z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
          ),
        '-B': z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
          ),
        '-C': z.number().int().nonnegative().optional().describe('Alias for context.'),
        context: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
          ),
        multiline: z
          .boolean()
          .optional()
          .describe(
            'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
          ),
        head_limit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly — large result sets waste context).',
          ),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.',
          ),
      }),
      executionFacts,
      impl: async (input, ctx) => {
        const { pattern, path, glob, type, output_mode, context, head_limit, offset, multiline } =
          input as GrepToolInput;
        const ignoreCase = input['-i'];
        const lineNumbers = input['-n'];
        const onlyMatching = input['-o'];
        const bothWays = input['-C'] ?? context;
        const after = input['-A'] ?? bothWays;
        const before = input['-B'] ?? bothWays;
        const mode = output_mode ?? 'files_with_matches';
        // `head_limit: 0` is no limit at all.
        const limit = head_limit === 0 ? undefined : (head_limit ?? DEFAULT_GREP_HEAD_LIMIT);
        const searchRoot = path === undefined ? '.' : expandHomePath(path);
        // Self-bound: ripgrep finishes in well under a second normally, but a
        // pathological tree (network mount, /proc, a FIFO) could hang it. The
        // stream watchdog no longer caps tool execution, so each spawning tool
        // must carry its own wall-clock timeout and honour the turn's abort.
        const result = await filesystem.execute({
          operation: {
            kind: 'grep',
            path: searchRoot,
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
                  ...(onlyMatching !== undefined ? { onlyMatching } : {}),
                }
              : {}),
            ...(multiline !== undefined ? { multiline } : {}),
            ...(limit !== undefined ? { limit } : {}),
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
        // Spelled as the call wrote its root, as Glob's paths are.
        const root = resolvePath(ctx.cwd, searchRoot);
        const resolvedRoot = canonicalExistingPath(root);
        return {
          matches: result.matches.map((line) => respellSearchLine(line, resolvedRoot, root)),
          cwd: ctx.cwd,
          mode: result.mode ?? mode,
          ...(result.truncated ? { truncated: true, omitted: result.omitted ?? 0 } : {}),
          // The paging the answer states: the limit when it cut the list, and
          // the offset it started from.
          ...(result.truncated && limit !== undefined ? { limit } : {}),
          ...(offset ? { offset } : {}),
          ...(result.countTotal ? { countTotal: result.countTotal } : {}),
        };
      },
      toModelOutput: ({ output }) => grepToolResultToModelOutput(output),
      errorToModelText: bareToolError,
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
  const env = sandboxedEnvironment(process.env);
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

  // An approved directory may not exist yet: the Linux mount below needs it to,
  // and the command is about to write into it on every platform.
  materializeApprovedWriteDirectories(effective.profile);
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
