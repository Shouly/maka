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

// What a block of reasoning is called on screen: its first line.
//
// The reference names a reasoning step, and a run that is nothing but one
// block of reasoning, by the block's summary, else by its first line that has
// any words in it once markdown is taken off (a fence, a heading mark, a list
// marker, a quote mark, a link's target, backticks and asterisks), cut at 200
// characters. It falls back to "Thought for Ns", and only then to "Thought
// process". The helpers are ported as they ship.
//
// Maka has neither the summary (claude.ai generates it; the model does not)
// nor per-block timing, so the first line is the label and "Thought process"
// the fallback.

/** The reference's cut, in UTF-16 units, before the ellipsis. */
const HEADLINE_MAX = 200;

const FENCE = /^```[\w-]*\s*$/;
const HEADING = /^#{1,6}\s+/;
const LIST_MARKER = /^(?:[-*+]|\d{1,3}\.)\s+/;
const QUOTE = /^>\s*/;
const LINK = /\[([^\]]*)\]\([^)\s]*\)/g;
const EMPHASIS = /[`*]+/g;
/** Characters that draw nothing: a line of only these has no words. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}⠀￼]/gu;

/** A line with its markdown taken off, or `''` when nothing readable is left. */
function cleanLine(line: string): string {
  const cleaned = line
    .trim()
    .replace(FENCE, '')
    .replace(HEADING, '')
    .replace(LIST_MARKER, '')
    .replace(QUOTE, '')
    .replace(LINK, '$1')
    .replace(EMPHASIS, '')
    .trim();
  return cleaned.replace(INVISIBLE, '').trim() === '' ? '' : cleaned;
}

function cut(text: string): string {
  if (text.length <= HEADLINE_MAX) return text;
  let head = text.slice(0, HEADLINE_MAX);
  // Never end on half of a surrogate pair.
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return `${head}…`;
}

/**
 * The first line of `text` that has words in it, with its markdown taken off
 * and cut at 200 characters; `undefined` when no line has any.
 */
export function reasoningHeadline(text: string): string | undefined {
  // Line by line rather than `split`: a live step re-renders on every token,
  // and the answer is almost always on the first line of a long text.
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const cleaned = cleanLine(text.slice(start, end));
    if (cleaned !== '') return cut(cleaned);
    start = end + 1;
  }
  return undefined;
}
