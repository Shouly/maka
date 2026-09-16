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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleMainSessionSystemPrompt } from '../system-prompt/main-session-prompt.js';
import {
  formatKnowledgeCutoff,
  renderKnowledgeCutoffSection,
} from '../system-prompt/knowledge-cutoff-prompt.js';

test('main-session prompt closes on the outcome rather than narrating each step', () => {
  const prompt = assembleMainSessionSystemPrompt(['Project instructions']);

  // The reference states this once, as a closing rule. It deliberately does
  // not ask for narration before or between tool calls.
  assert.match(prompt, /When done: one or two sentences on the outcome\./);
  assert.match(prompt, /Do not recap every step/);
  assert.doesNotMatch(prompt, /progress update before the first non-trivial tool call/);
  assert.doesNotMatch(prompt, /ProgressUpdate/);
  assert.match(prompt, /Project instructions$/);
});

test('the knowledge cutoff is interpolated, and its absence leaves no hole', () => {
  const withCutoff = assembleMainSessionSystemPrompt([], {
    knowledge_cutoff_section: renderKnowledgeCutoffSection('2026-05-05'),
  });
  assert.match(withCutoff, /<knowledge_cutoff>/);
  assert.match(withCutoff, /is May 5, 2026\./);
  assert.doesNotMatch(withCutoff, /\{knowledge_cutoff_section\}/);

  // An unknown cutoff still states the behaviour; it never names a date.
  const unknown = assembleMainSessionSystemPrompt([], {
    knowledge_cutoff_section: renderKnowledgeCutoffSection(undefined),
  });
  assert.match(unknown, /Copilot has a reliable knowledge cutoff date/);

  // A substitution that is not supplied collapses to nothing rather than
  // printing the placeholder at the model.
  const empty = assembleMainSessionSystemPrompt([], { knowledge_cutoff_section: undefined });
  assert.doesNotMatch(empty, /\{knowledge_cutoff_section\}/);
  assert.doesNotMatch(empty, /\n\n\n/);
});

test('a month-only cutoff reads as a month, and an unparsable one passes through', () => {
  assert.equal(formatKnowledgeCutoff('2025-05'), 'May 2025');
  assert.equal(formatKnowledgeCutoff('2025-05-31'), 'May 31, 2025');
  assert.equal(formatKnowledgeCutoff('early 2025'), 'early 2025');
});
