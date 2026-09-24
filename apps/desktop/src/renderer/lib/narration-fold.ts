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

// Whether a text block the model wrote between tool calls is narration, which
// folds into the run, or words for the reader, which stand as prose.
//
// The reference's classifier, ported as it ships: a logistic regression over
// the text's shape (length, lines, lists, a trailing colon or question mark, a
// "let me…"/"now…" opening) and its place in the turn (first text or not, how
// many calls came before it, whether reasoning led into it). The feature
// definitions, the standardisation constants, the weights, the bias and the
// threshold are copied, not tuned — a text scoring below the threshold folds.
//
// Only texts with a later call or text in the same reply are scored; the tail
// has nothing after it yet and stays shown (the final answer, or the line the
// model is writing right now, which the reference also shows early).

/** One block of a reply, as the classifier sees it. */
export type NarrationEvent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool_use' }
  | { readonly kind: 'thinking' };

/** A text scoring below this folds into the run. */
export const NARRATION_SHOW_THRESHOLD = 0.10735388526449063;

const CONTINUATION =
  /^\s*(now|next|next,|let me|let's|i'll|i will|first|first,|then|then,|ok|okay|alright|checking|looking|running|trying|good|great|perfect|interesting|hmm|wait|actually|time to|going to|starting|continuing|proceeding|before|after that|also|and|so)\b[,:]?/i;

/** A tail this short (in UTF-8 bytes) reads as a continuation. */
const SHORT_TAIL_BYTES = 11;

type Features = Record<string, number>;

const WEIGHTS: Readonly<Record<string, { mu: number; sd: number; w: number }>> = {
  ends_with_colon: { mu: 0.2648171500630517, sd: 0.4413285601531415, w: -0.09393777879356614 },
  ends_with_ellipsis: { mu: 0, sd: 1, w: 0 },
  ends_with_question: {
    mu: 0.0016813787305590584,
    sd: 0.040978745260328776,
    w: 0.32956751845650506,
  },
  first_word_is_verb_ing: {
    mu: 0.032366540563261874,
    sd: 0.17700880742038105,
    w: 0.09656726836202009,
  },
  followed_by_tool_call: {
    mu: 0.9936948297604036,
    sd: 0.07917101621966222,
    w: -0.035304062313921206,
  },
  has_bullets: { mu: 0.02437999159310635, sd: 0.15425825735157178, w: -0.050711008972480376 },
  has_code_fence: { mu: 0, sd: 1, w: 0 },
  has_heading: { mu: 8406893652795292e-19, sd: 0.028988546658490932, w: 0.005413155230004535 },
  has_link: { mu: 4203446826397646e-19, sd: 0.02050230920261824, w: 0.003663808379189478 },
  has_table: { mu: 0.002101723413198823, sd: 0.04580598360605948, w: 0.02978709195305296 },
  idx_text_in_turn: { mu: 2.3076923076923075, sd: 3.0384949097465355, w: -0.33831095320395443 },
  is_first_text_in_turn: {
    mu: 0.3333333333333333,
    sd: 0.47150362822843306,
    w: 0.6827546313306055,
  },
  n_chars: { mu: 130.20050441361917, sd: 560.9132996781615, w: 3.5189593644600485 },
  n_newlines: { mu: 0.46027742749054223, sd: 7.323447493240329, w: 0.25860316778246273 },
  n_tool_uses_before_in_turn: {
    mu: 23.437578814627994,
    sd: 22.43511793129783,
    w: -0.8612643549103961,
  },
  n_tools_since_last_text: {
    mu: 7.372425388818831,
    sd: 10.005381880311246,
    w: -0.2747372005541958,
  },
  n_words: { mu: 21.6775956284153, sd: 84.49829603949048, w: 3.736265901036949 },
  preceded_by_thinking: {
    mu: 0.41067675493905004,
    sd: 0.4920600909069021,
    w: 0.2784610260283084,
  },
  starts_with_continuation: {
    mu: 0.48213535098781,
    sd: 0.4997858045900412,
    w: -0.6312233072341642,
  },
};

const BIAS = -3.568243721480921;

/**
 * A text's own features, cached by its content: a live turn is regrouped on
 * every token, and a text whose decision is fixed would otherwise be split and
 * matched again each time. Bounded, because only the live turn's texts repeat.
 */
const FEATURES_BY_TEXT = new Map<string, Features>();
const FEATURES_CACHE_LIMIT = 512;

function textFeatures(text: string): Features {
  const cached = FEATURES_BY_TEXT.get(text);
  if (cached) return cached;
  const features = computeTextFeatures(text);
  if (FEATURES_BY_TEXT.size >= FEATURES_CACHE_LIMIT) FEATURES_BY_TEXT.clear();
  FEATURES_BY_TEXT.set(text, features);
  return features;
}

function computeTextFeatures(text: string): Features {
  const lines = text.split('\n');
  const trimmed = text.trim();
  return {
    n_chars: text.length,
    n_words: (trimmed.match(/\S+/g) ?? []).length,
    n_newlines: lines.length - 1,
    has_code_fence: +/```/.test(text),
    has_bullets: +lines.some((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line)),
    has_heading: +lines.some((line) => /^#{1,4}\s+/.test(line)),
    has_table: +(lines.filter((line) => /\|.*\|/.test(line)).length >= 2),
    has_link: +/https?:\/\//.test(text),
    ends_with_question: +/\?\s*$/.test(trimmed),
    ends_with_colon: +/:\s*$/.test(trimmed),
    ends_with_ellipsis: +/(\.\.\.|…)\s*$/.test(trimmed),
    starts_with_continuation: +CONTINUATION.test(trimmed),
    first_word_is_verb_ing: +/^\s*\w+ing\b/i.test(trimmed),
  };
}

function withinUtf8Bytes(text: string, limit: number): boolean {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (bytes > limit) return false;
  }
  return true;
}

/** A tail is scored as if it were still going: the most narration-like reading. */
function tailFeatures(text: string, features: Features): Features {
  const trimmed = text.trim();
  const tail: Features = { ...features, ends_with_colon: 1, ends_with_question: 0, has_bullets: 1 };
  if (withinUtf8Bytes(trimmed, SHORT_TAIL_BYTES)) tail.starts_with_continuation = 1;
  if (/^\w*$/.test(trimmed)) tail.first_word_is_verb_ing = 0;
  return tail;
}

export function narrationScore(features: Features): number {
  let sum = BIAS;
  for (const [name, { mu, sd, w }] of Object.entries(WEIGHTS)) {
    sum += w * (((features[name] ?? 0) - mu) / sd);
  }
  return 1 / (1 + Math.exp(-sum));
}

export interface NarrationScores {
  /** Every text with a later call or text in the reply, by event index. */
  readonly decided: ReadonlyMap<number, number>;
  /** The last text, when it has nothing after it and `withTail` asked for it. */
  readonly tail?: { readonly index: number; readonly score: number };
}

export function scoreNarration(
  events: readonly NarrationEvent[],
  withTail = false,
): NarrationScores {
  const decided = new Map<number, number>();
  let tail: NarrationScores['tail'];
  // callsBefore[i]: tool calls strictly before event i.
  const callsBefore = [0];
  for (let index = 0; index < events.length; index++) {
    callsBefore.push(callsBefore[index]! + +(events[index]!.kind === 'tool_use'));
  }
  let textIndex = -1;
  let previousText = -1;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    if (event.kind !== 'text') continue;
    textIndex++;
    let next = -1;
    let nextIsCall = 0;
    for (let later = index + 1; later < events.length; later++) {
      const kind = events[later]!.kind;
      if (kind === 'tool_use' || kind === 'text') {
        next = later;
        nextIsCall = +(kind === 'tool_use');
        break;
      }
    }
    if (next >= 0 || withTail) {
      const base = textFeatures(event.text);
      const features: Features = {
        ...(next >= 0 ? base : tailFeatures(event.text, base)),
        idx_text_in_turn: textIndex,
        is_first_text_in_turn: +(textIndex === 0),
        n_tool_uses_before_in_turn: callsBefore[index]!,
        n_tools_since_last_text: callsBefore[index]! - callsBefore[previousText + 1]!,
        followed_by_tool_call: next >= 0 ? nextIsCall : 1,
        preceded_by_thinking: +(index > 0 && events[index - 1]!.kind === 'thinking'),
      };
      const score = narrationScore(features);
      if (next >= 0) decided.set(index, score);
      else tail = { index, score };
    }
    previousText = index;
  }
  return tail ? { decided, tail } : { decided };
}
