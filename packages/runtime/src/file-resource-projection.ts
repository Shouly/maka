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

import { formatAttachmentResourceRef } from '@maka/core/attachments';
import type { StorageRef, ToolResultContent } from '@maka/core/events';
import { taskOutputResourceRef, toolResultStorageRefs } from '@maka/core/file-resources';
import { parseShellRunResourceRef } from './shell-run-contract.js';
import {
  collectConversationCopyChildNotifications,
  collectConversationCopyTaskOutputNotifications,
  type FileNotificationEvent,
} from './conversation-copy-notifications.js';
import { decodeCanonicalToolResultContent } from '@maka/core/tool-result-record-schema';
import type { ToolResultOutput } from './model-protocol.js';

/** A real execution file. Durable identity stays inside the resource boundary. */
export interface PreparedFile {
  readonly path: string;
  readonly name: string;
  readonly source: string;
  readonly sizeBytes: number;
  readonly mimeType?: string;
  readonly summary?: string;
}

/** Bound to the requesting Session and its executor, never to a historical owner. */
export type ModelFilePathResolver = (
  ref: string,
) => Promise<{ ok: true; file: PreparedFile; readOnly: boolean } | { ok: false; reason: string }>;

export interface ModelFileBinding {
  readonly ref: string;
}

export function modelFileBinding(ref: StorageRef): ModelFileBinding | undefined {
  const resource = formatAttachmentResourceRef(ref);
  return resource && ref.kind === 'session_file' ? { ref: resource } : undefined;
}

/** Only declared dependencies are resolved. Text is never an authority to fetch a resource. */
export function toolResultFileBindings(value: unknown): readonly ModelFileBinding[] {
  let content: ToolResultContent;
  try {
    content = decodeCanonicalToolResultContent(value);
  } catch {
    return [];
  }
  const files = toolResultStorageRefs(content, '').flatMap((ref) => {
    const binding = modelFileBinding(ref);
    return binding ? [binding] : [];
  });
  if (content.kind === 'shell_run' && content.outputRef) files.push({ ref: content.outputRef });
  return files;
}

/** Host-authored notification envelopes already have a structured task/child authority. */
export function notificationFileBindings(
  event: FileNotificationEvent,
): readonly ModelFileBinding[] {
  if (
    event.partial ||
    event.role !== 'user' ||
    event.content?.kind !== 'text' ||
    event.content.origin?.kind !== 'background_task' ||
    (event.author !== 'system' && event.author !== 'host')
  )
    return [];
  const task = parseShellRunResourceRef(event.content.origin.ref);
  const outputs = new Set(collectConversationCopyTaskOutputNotifications([event]));
  if (task) outputs.add(task.shellRunId);
  return [
    ...[...outputs].map((id) => ({ ref: taskOutputResourceRef(id) })),
    ...collectConversationCopyChildNotifications([event]).flatMap((notification) =>
      notification.artifactIds.map((id) => ({
        ref: formatAttachmentResourceRef({
          kind: 'session_file',
          sessionId: notification.childSessionId,
          relativePath: id,
        })!,
      })),
    ),
  ];
}

/**
 * Bind the durable receipt to this request's execution environment. Never writes
 * back to the ledger, changes call arguments, or rewrites assistant prose/checkpoints.
 * A path is emitted only after its bytes exist in that execution environment.
 */
export async function projectFileResourcePaths(
  output: ToolResultOutput,
  bindings: readonly ModelFileBinding[],
  resolve: ModelFilePathResolver | undefined,
): Promise<ToolResultOutput> {
  if (bindings.length === 0) return output;
  const replacements = new Map<string, string>();
  const notes: string[] = [];
  const seen = new Set<string>();
  let hasPaths = false;
  for (const binding of bindings) {
    if (seen.has(binding.ref)) continue;
    seen.add(binding.ref);
    const result = resolve
      ? await resolve(binding.ref)
      : { ok: false as const, reason: 'This execution environment does not provide files.' };
    if (result.ok) {
      hasPaths = true;
      replacements.set(binding.ref, result.file.path);
      const { path, ...metadata } = result.file;
      notes.push(
        `File: ${JSON.stringify({ ...metadata, file_path: path, readOnly: result.readOnly })}`,
      );
    } else {
      replacements.set(binding.ref, '[file unavailable]');
      notes.push(`File unavailable: ${result.reason}`);
    }
  }
  const text = (value: string): string => {
    for (const [ref, path] of [...replacements].sort(([a], [b]) => b.length - a.length)) {
      // ID prefixes are not the same identity, and $ in an actual filename is
      // literal data, never a replacement-string directive.
      value = value.replaceAll(ref, (_match, offset: number, source: string) =>
        /[A-Za-z0-9_/-]/u.test(source.charAt(offset + ref.length)) ? ref : path,
      );
    }
    return value;
  };
  const footer = [
    ...notes,
    hasPaths
      ? 'These are ordinary filesystem paths for Read(file_path), Grep, Bash or Python. readOnly reflects the executor policy; OS permissions also apply. Execution copies are rebuildable: copy to the working directory before editing. Old paths are never redirected to another snapshot; use the current file information supplied by the system.'
      : 'Do not substitute a working file or invent a path for unavailable saved bytes.',
  ].join('\n');
  if (output.type === 'text' || output.type === 'error-text') {
    return { ...output, value: `${text(output.value)}\n\n${footer}` };
  }
  if (output.type === 'content') {
    return {
      ...output,
      value: [
        ...output.value.map((part) =>
          part.type === 'text' ? { ...part, text: text(part.text) } : part,
        ),
        { type: 'text', text: footer },
      ],
    };
  }
  // Preserve arbitrary structured results rather than reinterpret their fields.
  if (output.type === 'json' || output.type === 'error-json') {
    return { type: 'text', value: `${text(JSON.stringify(output.value))}\n\n${footer}` };
  }
  return output;
}
