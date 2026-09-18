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

/**
 * Which providers can hold a tool's schema on the wire without putting it in
 * the model's context — and so let `ToolSearch` stop rewriting the request's
 * tool block on every activation.
 *
 * Without this, availability is expressed by NOT SENDING a schema. The tool
 * block is the first thing in the prompt prefix, so every activation moves it
 * and the cached prefix dies with it — the search spends on cache misses what
 * it saves on schemas. With it, every schema is sent once and stays put;
 * whether the model can see one is the provider's `defer_loading` plus the
 * references the connector hands back.
 *
 * Deliberately opt-in and conservative. A wrong "supported" is a 400 on a real
 * turn; a wrong "unsupported" is the behaviour Maka already ships. A provider
 * or model this cannot positively identify gets the existing path.
 */

import type { ResolvedModelRuntime } from './model-runtime.js';

/** The wire dialect that carries the deferral, once one is available. */
export type NativeToolDeferral = 'anthropic' | 'openai-responses';

/**
 * Anthropic tool search landed with Claude Opus 4.5 and Sonnet 4.5; Opus 4.1
 * and older refuse it.
 *
 * Matched positively, by family and version, never by excluding the old ids. A
 * `providerType: 'anthropic'` connection can point at any base URL, and a
 * gateway or a fixture answers to a model name this cannot have heard of — an
 * exclusion list would call every one of those new enough and send them a
 * parameter they may not know, which is the 400 this module exists to avoid.
 * Unrecognised means unsupported, and unsupported means the path Maka already
 * shipped.
 */
function anthropicServesToolSearch(modelId: string): boolean {
  // The minor is one or two digits: a dated snapshot such as
  // `claude-sonnet-4-20250514` carries an eight-digit date in that position,
  // and reading it as a minor would call the oldest models the newest.
  const opusLine = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:[-.]|$)/u.exec(modelId);
  if (opusLine) {
    const major = Number(opusLine[1]);
    const minor = opusLine[2] === undefined ? 0 : Number(opusLine[2]);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
    if (major > 4) return true;
    return major === 4 && minor >= 5;
  }
  // The Fable and Mythos lines are tool-search capable from their first release.
  return /^claude-(?:fable|mythos)-\d/u.test(modelId);
}

export function resolveNativeToolDeferral(
  runtime: Pick<ResolvedModelRuntime, 'wire' | 'adapter'>,
  modelId: string,
): NativeToolDeferral | undefined {
  const id = modelId.trim().toLowerCase();
  if (id === '') return undefined;
  if (runtime.adapter.kind === 'anthropic') {
    return anthropicServesToolSearch(id) ? 'anthropic' : undefined;
  }
  // OpenAI's Responses endpoint, and Codex's — the same wire through the same
  // SDK call, differing only in base URL and headers. Codex validates both
  // parameters rather than ignoring them: openai/codex#19486 (Apr 2026) is its
  // own backend answering `Invalid Value: 'tools.defer_loading'. Deferred tools
  // require tools.tool_search.`, and Codex turns the pair on by itself once
  // tool descriptions pass ~10% of the window. (An earlier report through a
  // third-party proxy, Feb 2026, got `Unknown parameter` — the endpoint gained
  // the feature between the two.)
  //
  // That error is also the rule this mode has to keep: a deferred tool without
  // a declared `tool_search` beside it is a 400, which is why the connector is
  // declared as that tool whenever anything here is deferred.
  //
  // `open-responses` is a second implementation of the shape and an
  // OpenAI-compatible chat endpoint is not the Responses API at all — neither
  // carries `defer_loading`, and a schema deferred where nothing can point at
  // it would be hidden for good.
  if (
    runtime.wire === 'openai-responses' &&
    (runtime.adapter.kind === 'openai' || runtime.adapter.kind === 'openai-codex')
  ) {
    return openAiServesToolSearch(id) ? 'openai-responses' : undefined;
  }
  return undefined;
}

/**
 * OpenAI serves tool search on the Responses API from gpt-5.4 on. The major and
 * minor are read as numbers rather than matched as text, so a later model
 * qualifies without an edit here; anything that does not parse is refused,
 * because refusing costs only the existing behaviour.
 */
function openAiServesToolSearch(modelId: string): boolean {
  const match = /^gpt-(\d+)(?:\.(\d+))?/u.exec(modelId);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 5) return true;
  return major === 5 && minor >= 4;
}
