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

import { TOOL_INPUT_PREVIEW_MAX_CHARS } from '@maka/core/events';
import { projectToolArgsPreview } from '@maka/core/tool-quiet-preview';
import { readPartialJson } from './partial-json.js';

/**
 * A tool call's arguments while the model is writing them — the input side of
 * `tool-output-stream.ts`.
 *
 * The two streams differ in the one way that decides everything here. Output is
 * a list of chunks, so a lost chunk costs its own text and nothing else. Input
 * is ONE JSON document cut into fragments and concatenated, so a lost fragment
 * does not read as a gap: it reads as a different, well-formed call. Each
 * fragment therefore says where it belongs, and one that does not start where
 * the text ends is a hole that ends the stream.
 */
export interface LiveToolInput {
  /** The arguments as far as they have arrived, never past the reading bound. */
  text: string;
  /**
   * What the row may show of `text` so far — `projectToolArgsPreview`'s output,
   * the same gate the settled row goes through, so the two never disagree and
   * a credential in a Write body never reaches the screen.
   */
  preview?: unknown;
  /** Set once a fragment was lost. Nothing more is folded in or read. */
  broken?: true;
}

export function openToolInput(): LiveToolInput {
  return { text: '' };
}

/**
 * Fold one fragment in. Returns the same input when the fragment adds nothing —
 * a replay, or anything arriving after the stream broke.
 *
 * Reading stops at `TOOL_INPUT_PREVIEW_MAX_CHARS` while the fragments go on
 * arriving: reading means re-reading everything received so far each time one
 * lands, the square of the length, on the thread drawing the transcript —
 * measured at 1.4s across half a megabyte. The bound is where reading stops,
 * not a cut: the fragment that crosses it is kept whole. The row stops
 * following on a head that already names the call, and `tool_start` brings the
 * arguments whole.
 */
export function applyToolInputFragment(
  current: LiveToolInput,
  fragment: { offset: number; delta: string },
  toolName: string,
): LiveToolInput {
  if (current.broken) return current;
  // Nothing new: a resend of what the text already covers, or anything at all
  // once the reading has stopped. Stopping keeps the whole fragment that crossed
  // the bound rather than cutting it — a cut would put `text` out of step with
  // the offsets that follow, and every one of them would read as a hole.
  if (
    fragment.offset + fragment.delta.length <= current.text.length ||
    current.text.length >= TOOL_INPUT_PREVIEW_MAX_CHARS
  ) {
    return current;
  }
  // A hole stops the text being continued; it does not make what came before it
  // wrong. The reading keeps what the valid prefix said — dropping it would take
  // the row's name away and, with it, whether the row can be opened.
  if (fragment.offset > current.text.length) return { ...current, broken: true };
  const text = current.text + fragment.delta.slice(current.text.length - fragment.offset);
  // The raw reading never leaves this function.
  const preview = projectToolArgsPreview(toolName, readPartialJson(text).value);
  return { text, ...(preview === undefined ? {} : { preview }) };
}
