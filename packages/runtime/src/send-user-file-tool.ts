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

import { basename, extname, isAbsolute, resolve } from 'node:path';
import { isRenderableDeliveryPreview } from '@maka/core/artifacts';
import type { ArtifactKind, ArtifactRecord } from '@maka/core/artifacts';
import type { ToolResultContent } from '@maka/core/events';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';

import type { PermissionProfile } from '@maka/core/permission-profile';

import {
  createBoundaryFilesystemExecutor,
  type FilesystemExecutor,
  type FilesystemResult,
} from './filesystem-executor.js';
import type { FilesystemWorkerClient } from './filesystem-worker/client.js';
import type { ToolResultOutput } from './model-protocol.js';
import { sandboxErrorMetadata, SandboxCommandError } from './sandbox/errors.js';
import type { ToolArtifactCandidate } from './tool-artifacts.js';
import type { MakaTool, MakaToolContext } from './tool-runtime.js';
import { createLocalWorkspaceExecutor, type WorkspaceExecutor } from './workspace-executor.js';

/**
 * Refusal for a `SendUserFile` call on a surface that has no Artifact store.
 *
 * ToolRuntime injects `recordArtifacts` whenever an artifact recorder is wired,
 * so this answers only an embedder that composes the tool without one. It is
 * worded for a model because a model is still the caller.
 */
export const SEND_USER_FILE_UNAVAILABLE =
  'SendUserFile is not available on this surface, so no file reached the user. ' +
  'Retrying will fail the same way — tell the user where the file is on disk instead.';

// The reference's wording, verbatim, with two deviations Maka cannot avoid:
// its `proactive` clause promises a phone push, which no Maka surface sends,
// and its `display` clause closes with "same as before this parameter existed",
// a fact about the reference client's own history and not about this one.
export const SEND_USER_FILE_DESCRIPTION = [
  "Send files to the user. Use this for any file the user would want to see — a generated diagram, a report, a screenshot, a built artifact — and you want it surfaced, not just mentioned. Send deliverables as they are produced, not batched at the end of the task: a complete draft or a meaningfully updated version of the thing the user asked for is worth sending mid-task, so they can follow progress and redirect early. Do NOT send routine working files — scratch files, debug output, partial fragments, or every incremental save of something you're still actively editing; each call renders a file card in the conversation, and a stream of cards for one file is noise. Re-send a file only when it has meaningfully changed since the last send. Paths can be absolute or relative to the current working directory.",
  '',
  'Add a `caption` when a one-liner of context helps ("the failing case is row 42", "before vs after"). Skip it if the file speaks for itself.',
  '',
  "Set `status` on every call. Use `proactive` when you're initiating — the user is away and this should reach them on its own (build artifact ready, report generated). Use `normal` when replying to something the user just said.",
  '',
  "Set `display` to choose how the file is presented. Use `'render'` when the user should see the content inline in the side panel right now — a chart, a rendered HTML page, a diagram, an image. Use `'attach'` when the file is something they'll save and open elsewhere — source code, a spreadsheet, a document for another app — and an inline preview would just be noise. Leave it unset to let the client decide by file type.",
  '',
  "Files must already exist on the local filesystem — the tool sends files, it doesn't fetch URLs or render content. When unsure of a path, verify with ls first; absolute paths avoid ambiguity about the working directory.",
  '',
  'Example: SendUserFile({ files: ["report.md"], caption: "Here\'s the report.", status: "normal" })',
].join('\n');

export type SendUserFileArgs = {
  files: string[];
  status: 'normal' | 'proactive';
  caption?: string;
  display?: 'render' | 'attach';
};

type SendUserFileResult = Extract<ToolResultContent, { kind: 'user_file_delivery' }>;

/**
 * What SendUserFile needs to resolve a path: the same filesystem authority the
 * built-in file tools run on, so what may be delivered is exactly what `Read`
 * may open. The three composition inputs are the ones `buildBuiltinTools`
 * takes, so a host hands this builder the same options object; `filesystem`
 * short-circuits that for an embedder (or a test) that already has one.
 */
export interface SendUserFileToolDeps {
  filesystem?: Pick<FilesystemExecutor, 'execute'>;
  executor?: WorkspaceExecutor;
  filesystemWorker?: Pick<FilesystemWorkerClient, 'execute'>;
  permissionProfile?: PermissionProfile;
}

export function buildSendUserFileTool(
  deps: SendUserFileToolDeps = {},
): MakaTool<SendUserFileArgs, SendUserFileResult> {
  const filesystem =
    deps.filesystem ??
    createBoundaryFilesystemExecutor({
      workspace: deps.executor ?? createLocalWorkspaceExecutor(),
      ...(deps.filesystemWorker ? { worker: deps.filesystemWorker } : {}),
      ...(deps.permissionProfile ? { permissionProfile: deps.permissionProfile } : {}),
    });
  return {
    name: TOOL_NAMES.sendUserFile,
    description: SEND_USER_FILE_DESCRIPTION,
    parameters: z
      .object({
        // No `maxItems` and no caption `maxLength`: the reference has neither,
        // and its own report makes the point that the real limit on a batch is
        // the reader's card noise, not a number the schema can pick.
        files: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'File paths (absolute or relative to cwd) to send to the user. Always pass an array, even for a single file.',
          ),
        status: z
          .enum(['normal', 'proactive'])
          .describe(
            "Use 'proactive' when you're surfacing a file the user hasn't asked for and needs to see now — a generated artifact, a completed report. Use 'normal' when replying to something the user just said.",
          ),
        caption: z.string().optional().describe('Optional short caption for the file(s).'),
        display: z.enum(['render', 'attach']).optional().describe(
          // NOT "defaults to render". Omitting it defers to the file type,
          // which is what the reference says and what the impl below does.
          "How the client should present the file. 'render' opens it inline in the side panel (for HTML, SVG, Mermaid, images, PDFs — anything the user wants to look at now). 'attach' shows a download card only, no inline preview (for deliverables the user will save and open elsewhere). Omit to let the client decide by file type — renderable types render and everything else attaches.",
        ),
      })
      .strict(),
    impl: async (args, ctx): Promise<SendUserFileResult> => {
      const recordArtifacts = ctx.recordArtifacts;
      if (!recordArtifacts) throw new Error(SEND_USER_FILE_UNAVAILABLE);
      const caption = args.caption?.trim();
      const candidates: ToolArtifactCandidate[] = [];
      const paths: string[] = [];
      // Every path is admitted before anything is recorded, so a bad path in
      // the list cannot leave a half-delivered set of cards behind.
      for (const requested of args.files) {
        const path = resolveDeliveryPath(ctx.cwd, requested);
        await admitDeliveryPath(filesystem, requested, ctx);
        const mimeType = deliveryMimeType(path);
        candidates.push({
          kind: deliveryArtifactKind(path, mimeType),
          name: basename(path),
          ...(mimeType ? { mimeType } : {}),
          source: 'user_delivery',
          ...(caption ? { summary: caption } : {}),
          sourcePath: path,
        });
        paths.push(path);
      }
      // Unset means "decide by file type", as in the reference. The FIRST file
      // decides, because it is the one the pane opens — a flag that said
      // `render` while the pane showed a listing would be the two disagreeing.
      const display =
        args.display ??
        (candidates[0] && isRenderableDeliveryPreview(candidates[0]) ? 'render' : 'attach');
      const records = await recordArtifacts(candidates);
      const aligned = alignRecordsToCandidates(candidates, records);
      const undelivered = aligned.flatMap((record, index) =>
        record ? [] : [args.files[index] ?? paths[index] ?? 'file'],
      );
      if (undelivered.length > 0) throw notAttachedError(undelivered);
      return {
        kind: 'user_file_delivery',
        status: args.status,
        ...(caption ? { caption } : {}),
        display,
        files: aligned.map((record, index) => ({
          artifactId: record!.id,
          name: record!.name,
          path: paths[index]!,
          kind: record!.kind,
          ...(record!.mimeType ? { mimeType: record!.mimeType } : {}),
          sizeBytes: record!.sizeBytes,
        })),
      };
    },
    toModelOutput: ({ output }): ToolResultOutput => ({
      type: 'text',
      value: sendUserFileModelText(output),
    }),
  };
}

/**
 * What the model is told after a delivery: how many files landed, and the id
 * each path became, so a later tool can name the same file.
 *
 * `file_uuid` is the reference's own label, and it is literally true here — an
 * Artifact id IS a uuid, minted per DELIVERY rather than per file, so sending
 * the same path twice hands back two different ones.
 */
export function sendUserFileModelText(output: unknown): string {
  const files = deliveredFiles(output);
  if (!files) return 'Files delivered to user.';
  const header = `${files.length} file${files.length === 1 ? '' : 's'} delivered to user.`;
  return [header, ...files.map((file) => `  ${file.path} → file_uuid: ${file.artifactId}`)].join(
    '\n',
  );
}

function deliveredFiles(output: unknown): SendUserFileResult['files'] | undefined {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return undefined;
  const result = output as Partial<SendUserFileResult>;
  if (result.kind !== 'user_file_delivery' || !Array.isArray(result.files)) return undefined;
  return result.files;
}

function resolveDeliveryPath(cwd: string, requested: string): string {
  return isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested);
}

/**
 * Three questions, asked under the same authority `Read` answers to: is the
 * path there, is it a file, and is it inside what the session permits. It ASKS
 * rather than opens — an admission check has no use for the contents.
 *
 * It used to open the file the way `Read` does and throw the bytes away, which
 * bought the boundary check at the price of the whole file: read and decoded
 * before `limit` narrowed anything, on every delivery, on top of the read the
 * Artifact store does next. A file past Node's 512MB string ceiling failed
 * here with a message about strings, and a FIFO never came back at all,
 * because opening one to read waits for a writer.
 *
 * The boundary still refuses through the same path, so the refusal still
 * carries `sandbox_boundary_required` and its expansion, and
 * RequestSandboxBoundary can still follow it.
 */
async function admitDeliveryPath(
  filesystem: Pick<FilesystemExecutor, 'execute'>,
  requested: string,
  ctx: MakaToolContext,
): Promise<void> {
  let metadata: FilesystemResult;
  try {
    metadata = await filesystem.execute({
      operation: { kind: 'metadata', path: requested },
      cwd: ctx.cwd,
      ...(ctx.executionBoundary ? { executionBoundary: ctx.executionBoundary } : {}),
      ...(ctx.permissionMode ? { permissionMode: ctx.permissionMode } : {}),
      ...(ctx.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
    });
  } catch (error) {
    throw deliveryPathError(requested, ctx.cwd, error);
  }
  // A directory, a FIFO, a socket, a device — one answer for all of them, and
  // it is the answer the reference gives.
  if (metadata.kind !== 'metadata' || metadata.targetType !== 'file') {
    throw new Error(`Attachment "${requested}" is not a regular file.`);
  }
}

/**
 * The reference's first refusal, word for word. The second one — not a regular
 * file — is decided from the metadata itself, in `admitDeliveryPath`, so only
 * "it is not there" arrives here as a thrown error.
 *
 * The cwd rides along because it is the only thing that makes a RELATIVE
 * path's failure readable. What arrives is the filesystem layer's own errno
 * line; the code is not carried separately (every one of them is
 * `filesystem_error`), so the errno prefix is what there is to read.
 *
 * A boundary refusal is not one of the reference's two. It keeps its own
 * wording and, more importantly, its machine-readable metadata: the boundary
 * reason and the expansion it needs are what RequestSandboxBoundary reads, and
 * they survive only on the thrown error itself, never through a `cause`.
 */
function deliveryPathError(requested: string, cwd: string, error: unknown): Error {
  const metadata = sandboxErrorMetadata(error);
  if (metadata) {
    return new SandboxCommandError({
      ...metadata,
      message: `SendUserFile could not deliver ${requested}: ${failureReason(error)}`,
    });
  }
  const reason = failureReason(error);
  if (/^ENOENT\b/u.test(reason)) {
    return new Error(
      `Attachment "${requested}" does not exist. Current working directory: ${cwd}.`,
    );
  }
  return new Error(`SendUserFile could not deliver ${requested}: ${reason}`, { cause: error });
}

function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  return message.length > 0 ? message : 'the file could not be opened.';
}

function notAttachedError(files: readonly string[]): Error {
  return new Error(
    `SendUserFile could not attach ${files.join(', ')} to the conversation, so nothing was delivered for ${files.length === 1 ? 'it' : 'them'}. ` +
      'A delivered file has to live inside the session working directory and be small enough to store. ' +
      'Copy the file into the working directory, or tell the user where it is on disk instead.',
  );
}

/**
 * Match recorded Artifacts back to the candidates that asked for them.
 *
 * The recorder publishes candidates in order and skips the ones it cannot store,
 * so walking both lists together identifies exactly which files were dropped —
 * which a length comparison alone cannot do when two deliveries share a name.
 */
function alignRecordsToCandidates(
  candidates: readonly ToolArtifactCandidate[],
  records: readonly ArtifactRecord[],
): Array<ArtifactRecord | undefined> {
  const aligned: Array<ArtifactRecord | undefined> = [];
  let cursor = 0;
  for (const candidate of candidates) {
    const record = records[cursor];
    if (record && record.name === candidate.name) {
      aligned.push(record);
      cursor += 1;
    } else {
      aligned.push(undefined);
    }
  }
  return aligned;
}

/** An image MIME decides `image`; otherwise the extension names the kind. */
function deliveryArtifactKind(path: string, mimeType: string | undefined): ArtifactKind {
  if (mimeType?.startsWith('image/')) return 'image';
  switch (extname(path).toLowerCase()) {
    case '.pdf':
      return 'pdf';
    case '.html':
    case '.htm':
      return 'html';
    case '.diff':
    case '.patch':
      return 'diff';
    default:
      return 'file';
  }
}

function deliveryMimeType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.diff':
    case '.patch':
      return 'text/x-diff';
    default:
      return undefined;
  }
}
