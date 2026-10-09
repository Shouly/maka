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

// Where a record names a saved tool output, and how that name moves.
//
// A tool result too long to show is saved under the Host's state root, in
// `tool-results/<sessionId>/<name>.txt`, and a background command's output in
// `tasks/<sessionId>/<id>.output`. The records name those files by absolute
// path: a Bash result's `savedOutput.path`, a background task's `outputFile`,
// and the sentence the model was shown, in an MCP result and in the model's
// own view of a result. A copy of a Session into another folder or onto
// another state root rewrites those names, and only those: a tool call's
// arguments stay as they were made, since their hash authenticates the call.

import type { ToolResultContent } from './events.js';
import type {
  DurableProjectionJson,
  DurableToolResultProjection,
} from './durable-tool-result-projection.js';
import { markPersisted } from './persisted-value.js';
import type { RuntimeEvent } from './runtime-event.js';
import { decodePersistedToolResultContent } from './tool-result-record-schema.js';

/** The state root folder saved tool results are kept in, one folder per Session. */
export const TOOL_RESULTS_DIRECTORY = 'tool-results';
/** The state root folder background command output is kept in, one folder per Session. */
export const TASK_OUTPUTS_DIRECTORY = 'tasks';

/** A saved file's own name: `<name>.txt` for a tool result, `<id>.output` for a task. */
export const SAVED_OUTPUT_FILE_NAME = /^[A-Za-z0-9_-]{1,128}\.(?:txt|output)$/u;

/** Answers a text with every saved-output path in it replaced, or the same text. */
export type SavedOutputPathRewrite = (text: string) => string;

const identity: SavedOutputPathRewrite = (text) => text;

/**
 * A rewrite of every path in a text naming a saved file directly in one of
 * `folders`. `replace` answers the path to put in its place, or undefined to
 * leave it. A path is matched whole: not when it continues another path, and
 * not past its file name.
 */
export function savedOutputPathRewrite(
  folders: readonly string[],
  replace: (path: string) => string | undefined,
): SavedOutputPathRewrite {
  const unique = [...new Set(folders)].filter((folder) => folder.length > 0);
  if (unique.length === 0) return identity;
  // Longest first, so a folder never matches as the start of a longer one.
  const alternatives = unique
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_./\\\\-])(?:${alternatives})[\\\\/][A-Za-z0-9_-]{1,128}\\.(?:txt|output)(?![A-Za-z0-9_-])`,
    'gu',
  );
  return (text) =>
    unique.some((folder) => text.includes(folder))
      ? text.replace(pattern, (path) => replace(path) ?? path)
      : text;
}

/** The rewrite that moves each path `paths` names to the path it maps to. */
export function savedOutputPathMapRewrite(
  paths: ReadonlyMap<string, string>,
): SavedOutputPathRewrite {
  if (paths.size === 0) return identity;
  return savedOutputPathRewrite(
    [...paths.keys()].map((path) => path.slice(0, Math.max(0, lastSeparator(path)))),
    (path) => paths.get(path),
  );
}

/** Every saved-output path a rewrite would see, by running it with a recorder. */
export function savedOutputPathRecorder(
  folders: readonly string[],
  found: Set<string>,
): SavedOutputPathRewrite {
  return savedOutputPathRewrite(folders, (path) => {
    found.add(path);
    return undefined;
  });
}

/**
 * The places a tool result names a saved output: a Bash result's saved file,
 * a background task's output file, and the text of a plain or JSON result
 * (an MCP result saved to a file is the sentence that names it).
 */
export function rewriteToolResultContentSavedOutputPaths(
  content: ToolResultContent,
  rewrite: SavedOutputPathRewrite,
): ToolResultContent {
  switch (content.kind) {
    case 'user_file_delivery': {
      const files = content.files.map((file) => {
        const path = rewrite(file.path);
        return path === file.path ? file : { ...file, path };
      });
      return files.every((file, index) => file === content.files[index])
        ? content
        : { ...content, files };
    }
    case 'terminal': {
      if (!content.savedOutput) return content;
      const path = rewrite(content.savedOutput.path);
      return path === content.savedOutput.path
        ? content
        : { ...content, savedOutput: { ...content.savedOutput, path } };
    }
    case 'shell_run': {
      if (content.outputFile === undefined) return content;
      const outputFile = rewrite(content.outputFile);
      return outputFile === content.outputFile ? content : { ...content, outputFile };
    }
    case 'text': {
      const text = rewrite(content.text);
      return text === content.text ? content : { ...content, text };
    }
    case 'json': {
      const value = rewriteJsonStrings(content.value, rewrite);
      return value === content.value ? content : { ...content, value };
    }
    default:
      return content;
  }
}

/** A result no tool result shape describes: every string in it. */
export function rewriteOpaqueSavedOutputPaths(
  value: unknown,
  rewrite: SavedOutputPathRewrite,
): unknown {
  return rewriteJsonStrings(value, rewrite);
}

/** What the model was shown of a result: its text, its JSON, and its text parts. */
export function rewriteDurableToolResultProjectionSavedOutputPaths(
  projection: DurableToolResultProjection,
  rewrite: SavedOutputPathRewrite,
): DurableToolResultProjection {
  switch (projection.kind) {
    case 'text': {
      const text = rewrite(projection.text);
      return text === projection.text ? projection : { ...projection, text };
    }
    case 'json': {
      const value = rewriteJsonStrings(projection.value, rewrite) as DurableProjectionJson;
      return value === projection.value ? projection : { ...projection, value };
    }
    case 'content': {
      let changed = false;
      const parts = projection.parts.map((part) => {
        if (part.kind !== 'text') return part;
        const text = rewrite(part.text);
        if (text === part.text) return part;
        changed = true;
        return { ...part, text };
      });
      return changed ? { ...projection, parts } : projection;
    }
    default:
      return projection;
  }
}

/**
 * The places a RuntimeEvent names a saved output: a tool result (its result
 * and what the model was shown of it) and a text, such as the notification
 * that a background command finished. A tool call is left alone.
 */
export function rewriteRuntimeEventSavedOutputPaths(
  event: RuntimeEvent,
  rewrite: SavedOutputPathRewrite,
): RuntimeEvent {
  const content = event.content;
  if (content?.kind === 'text') {
    const text = rewrite(content.text);
    return text === content.text ? event : { ...event, content: { ...content, text } };
  }
  if (content?.kind !== 'function_response') return event;
  const result = rewriteFunctionResponseResult(content.result, rewrite);
  const modelProjection =
    content.modelProjection === undefined
      ? undefined
      : rewriteDurableToolResultProjectionSavedOutputPaths(content.modelProjection, rewrite);
  if (result === content.result && modelProjection === content.modelProjection) return event;
  return {
    ...event,
    content: {
      ...content,
      result,
      ...(modelProjection === undefined ? {} : { modelProjection }),
    },
  };
}

/** A function response's result: a tool result where it decodes as one, opaque where not. */
export function rewriteFunctionResponseResult(
  value: unknown,
  rewrite: SavedOutputPathRewrite,
): unknown {
  let content: ToolResultContent;
  try {
    content = decodePersistedToolResultContent(markPersisted<ToolResultContent>(value));
  } catch {
    return rewriteOpaqueSavedOutputPaths(value, rewrite);
  }
  const rewritten = rewriteToolResultContentSavedOutputPaths(content, rewrite);
  return rewritten === content ? value : rewritten;
}

function rewriteJsonStrings(value: unknown, rewrite: SavedOutputPathRewrite): unknown {
  if (typeof value === 'string') return rewrite(value);
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = rewriteJsonStrings(item, rewrite);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (value !== null && typeof value === 'object') {
    let changed = false;
    const entries = Object.entries(value).map(([key, item]) => {
      const next = rewriteJsonStrings(item, rewrite);
      if (next !== item) changed = true;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  }
  return value;
}

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}

function escapeRegExp(text: string): string {
  // Only syntax characters: a Unicode pattern refuses any other escape.
  return text.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&');
}
