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

// How much of a text artifact the preview is allowed to draw.
//
// Ported unchanged from the pre-rewrite `artifact-preview.tsx`. Two bounds,
// not one, because they answer different questions: `DISPLAY` is how much text
// reaches the DOM at all, `HIGHLIGHT` is how much of that is worth handing to
// Prism — syntax highlighting is superlinear in the file, so a 200KB minified
// bundle would freeze the pane long before it ran out of memory. The remainder
// between them is still shown, as plain monospace, so the preview never
// silently truncates what it decided not to colour.
//
// The prefix is cut on a UTF-8 boundary and then on a line boundary, in that
// order: cutting mid-codepoint prints a replacement character, and cutting
// mid-line makes the highlighter mis-tokenize the last row it draws.

export const ARTIFACT_TEXT_DISPLAY_LIMIT_BYTES = 256 * 1024;
export const ARTIFACT_TEXT_HIGHLIGHT_LIMIT_BYTES = 64 * 1024;
export const ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT = 1_000;
export const ARTIFACT_DIFF_LINE_LIMIT = 500;

export interface BoundedPreviewText {
  /** Everything the preview may render, plain or highlighted. */
  displayText: string;
  /** The leading part cheap enough to highlight. */
  highlightedText: string;
  /** `displayText` minus `highlightedText`; rendered plain. */
  plainRemainder: string;
  hasPlainRemainder: boolean;
  /** True when the artifact is larger than the display bound. */
  isDisplayTruncated: boolean;
}

export function boundPreviewText(text: string): BoundedPreviewText {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const displayText = decoder.decode(utf8Prefix(bytes, ARTIFACT_TEXT_DISPLAY_LIMIT_BYTES));
  const highlightCandidate = decoder.decode(utf8Prefix(bytes, ARTIFACT_TEXT_HIGHLIGHT_LIMIT_BYTES));
  const lineBreak = highlightCandidate.lastIndexOf('\n');
  let highlightedText =
    bytes.length > ARTIFACT_TEXT_HIGHLIGHT_LIMIT_BYTES && lineBreak > 0
      ? highlightCandidate.slice(0, lineBreak + 1)
      : highlightCandidate;
  const highlightLines = highlightedText.split('\n');
  if (highlightLines.length > ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT) {
    highlightedText = `${highlightLines.slice(0, ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT).join('\n')}\n`;
  }
  const plainRemainder = displayText.slice(highlightedText.length);
  return {
    displayText,
    highlightedText,
    plainRemainder,
    hasPlainRemainder: plainRemainder.length > 0,
    isDisplayTruncated: bytes.length > ARTIFACT_TEXT_DISPLAY_LIMIT_BYTES,
  };
}

function utf8Prefix(bytes: Uint8Array, limit: number): Uint8Array {
  let end = Math.min(bytes.length, limit);
  if (end === bytes.length) return bytes;
  // Walk back off continuation bytes (10xxxxxx) so the cut lands on a
  // codepoint boundary rather than inside one.
  while (end > 0 && (bytes[end] ?? 0) >>> 6 === 0b10) end -= 1;
  return bytes.subarray(0, end);
}

export function capPreviewLines(
  text: string,
  limit: number,
): { text: string; hiddenLines: number } {
  const lines = text.split('\n');
  if (lines.length <= limit) return { text, hiddenLines: 0 };
  return { text: lines.slice(0, limit).join('\n'), hiddenLines: lines.length - limit };
}

/** `<a href=…>` clicks are inert inside the preview's sandbox; count them to say so. */
export function countExternalLinks(html: string): number {
  return (html.match(/<a\s[^>]*href=/giu) ?? []).length;
}

/** A `.md` artifact opens rendered; everything else opens as source. */
export function isMarkdownArtifactName(name: string): boolean {
  return /\.(?:md|markdown)$/iu.test(name);
}
