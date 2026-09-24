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

// The lines a Read returns, counted the way the Read tool numbers them: a
// file is its text split on '\n', so a file that ends in a newline has an
// empty last line, and a CRLF file keeps its '\r' here for the caller to drop
// when it prints. `offset` is the number of the first line shown — 0 reads as
// 1 — and a missing or zero `limit` runs to the end.

/** The most text one Read may return: 256KB. */
export const READ_MAX_CONTENT_BYTES = 256 * 1024;

export interface TextLineWindow {
  /** The lines shown, joined with '\n', exactly as they are in the file. */
  readonly content: string;
  /** Number of the first line shown, from 1. */
  readonly startLine: number;
  /** Lines in the file; 0 for an empty file. */
  readonly totalLines: number;
  /** `offset` named a line past the end, so nothing is shown. */
  readonly beyondEnd: boolean;
}

export function readTextLineWindowFacts(
  content: string,
  offset?: number,
  limit?: number,
): TextLineWindow {
  if (content === '') return { content: '', startLine: 1, totalLines: 0, beyondEnd: false };
  let totalLines = 1;
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) {
    totalLines++;
  }
  const startLine = Math.max(1, Math.trunc(offset ?? 1) || 1);
  if (startLine > totalLines) return { content: '', startLine, totalLines, beyondEnd: true };
  const count = limit && limit > 0 ? Math.trunc(limit) : totalLines;
  const endLine = Math.min(totalLines, startLine + count - 1);
  if (startLine === 1 && endLine === totalLines) {
    return { content, startLine, totalLines, beyondEnd: false };
  }
  let from = 0;
  for (let line = 1; line < startLine; line++) from = content.indexOf('\n', from) + 1;
  let to = from;
  for (let line = startLine; line <= endLine; line++) {
    const newline = content.indexOf('\n', to);
    to = newline === -1 ? content.length : newline + 1;
  }
  // The window's last newline ends its last line; it is not part of the text.
  const text = content.slice(from, to);
  return {
    content: endLine < totalLines && text.endsWith('\n') ? text.slice(0, -1) : text,
    startLine,
    totalLines,
    beyondEnd: false,
  };
}

/**
 * The size refusal, in the reference's words: `File content (517.2KB) exceeds
 * maximum allowed size (256KB). …`.
 */
export function readTooLargeMessage(bytes: number): string {
  return `File content (${formatFileSize(bytes)}) exceeds maximum allowed size (${formatFileSize(READ_MAX_CONTENT_BYTES)}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`;
}

/** `517.2KB`, `256KB`, `1.5MB` — one decimal, a trailing `.0` dropped. */
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  const fixed = (value: number) => value.toFixed(1).replace(/\.0$/, '');
  if (kb < 1024) return `${fixed(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${fixed(mb)}MB`;
  return `${fixed(mb / 1024)}GB`;
}
