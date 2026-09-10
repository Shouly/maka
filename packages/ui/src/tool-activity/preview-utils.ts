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

import type { UiLocale } from '@maka/core/ui-locale';
import { getToolActivityCopy } from './copy.js';

export const TOOL_LINE_CAP = 500;

/**
 * Cap a block of tool output at `TOOL_LINE_CAP` lines.
 *
 * Which END is kept is the caller's to say, because the two are not
 * interchangeable. A diff or a file preview is read from the top, so it keeps
 * its head. A command's output is watched at the BOTTOM — the line that just
 * arrived, the error it ended on — so keeping the head freezes the panel on
 * the opening banner of a long run and puts the part the user is waiting for
 * permanently out of reach.
 *
 * Stated at every call site rather than defaulted: the default WAS the head,
 * and the two views of a running command drifted apart under it — one capped
 * each end — because neither had to say which it meant.
 */
export function capLines(text: string, keep: 'head' | 'tail'): { body: string; capped: number } {
  const lines = text.split('\n');
  if (lines.length <= TOOL_LINE_CAP) return { body: text, capped: 0 };
  return {
    body: (keep === 'tail' ? lines.slice(-TOOL_LINE_CAP) : lines.slice(0, TOOL_LINE_CAP)).join(
      '\n',
    ),
    capped: lines.length - TOOL_LINE_CAP,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || ms < 0) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatUserVisibleToolText(text: string, locale: UiLocale): string {
  return text.replace(/\bUser denied permission(?: request)?\b|用户已拒绝权限请求/g, getToolActivityCopy(locale).permissionDenied);
}

/** One concise default summary of a tool failure: cap both characters and
 *  logical lines so a multi-line validation error cannot grow the banner to
 *  the ~2631px the issue tracked (a 240-char slice kept newlines, so 180 lines
 *  still rendered ~161 lines). The full redacted text stays in the disclosure
 *  for copy. */
export function summarizeErrorText(text: string): string {
  const MAX_CHARS = 240;
  const MAX_LINES = 4;
  const lines = text.split('\n');
  if (text.length <= MAX_CHARS && lines.length <= MAX_LINES) return text;
  const trimmed = lines.slice(0, MAX_LINES).join('\n').slice(0, MAX_CHARS);
  return `${trimmed}…`;
}
