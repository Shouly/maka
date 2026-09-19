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

// The static layer of the main-session system prompt, pinned as a golden
// file. A wording change is a diff of prose in
// `resources/prompts/*.md`, regenerated into the catalog and then into this
// file; the test fails on any drift between the three. Refresh the golden with
// `MAKA_UPDATE_GOLDEN=1` after reviewing the diff.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PROMPT_CONDITIONS,
  assembleMainSessionSystemPrompt,
  mainSessionStaticPromptSections,
} from '../system-prompt/main-session-prompt.js';

const EVERY_CONDITION: ReadonlySet<string> = new Set(PROMPT_CONDITIONS);

// dist/__tests__ → src/__tests__/golden: the golden lives beside the source so
// a review reads it next to the Markdown it pins.
const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  '__tests__',
  'golden',
  'main-session-static-prompt.txt',
);

test('the static prompt layer matches its golden file', () => {
  const actual = `${assembleMainSessionSystemPrompt([], {}, EVERY_CONDITION)}\n`;
  if (process.env.MAKA_UPDATE_GOLDEN === '1') writeFileSync(goldenPath, actual, 'utf8');
  const expected = readFileSync(goldenPath, 'utf8');
  assert.equal(actual, expected, 'static prompt drifted; review and run with MAKA_UPDATE_GOLDEN=1');
});

test('a conditional section is present only when its capability is', () => {
  const withMemory = assembleMainSessionSystemPrompt([], {}, new Set(['memory']));
  const without = assembleMainSessionSystemPrompt([]);
  assert.match(withMemory, /^<memory_filesystem>$/mu);
  assert.doesNotMatch(without, /<memory_filesystem>/u);
  // Everything unconditional is in both, in the same order.
  assert.equal(
    without,
    withMemory.replace(
      /\n\n<memory_filesystem>[\s\S]*<\/memory_filesystem>\n\nMemory files are size-capped[^\n]*/u,
      '',
    ),
  );
});

test('static sections are ordered, unique and non-empty', () => {
  const sections = mainSessionStaticPromptSections(EVERY_CONDITION);
  assert.ok(sections.length >= 6);
  const ids = sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (let index = 1; index < sections.length; index += 1) {
    assert.ok(sections[index - 1]!.order < sections[index]!.order, 'orders ascend');
  }
  for (const section of sections) assert.ok(section.body.trim().length > 0, section.id);
  assert.equal(ids[0], 'copilot-behavior');
});

test('every tag a section opens, it closes, in order', () => {
  // A blunt check, earned: a search-and-replace keyed on `<user_wellbeing>`
  // once matched the mention of that tag INSIDE `<chatting_with_person>` and
  // swallowed everything from there to the real closing tag — three blocks and
  // two closing tags gone, and every other test still green.
  const text = assembleMainSessionSystemPrompt([], {}, EVERY_CONDITION);
  const open: string[] = [];
  // An opening tag may carry attributes (`<example_group title="…">`).
  for (const [, closing, name] of text.matchAll(/^<(\/?)([a-z_]+)(?: [^>]*)?>$/gmu)) {
    if (closing) assert.equal(open.pop(), name, `mismatched </${name}>`);
    else open.push(name!);
  }
  assert.deepEqual(open, [], 'every opened tag is closed');
});

test('host fragments follow the static layer and empties are dropped', () => {
  const text = assembleMainSessionSystemPrompt(['', undefined, 'Project instructions']);
  assert.match(text, /^The assistant is Copilot\.\n\n<copilot_behavior>/u);
  // One file per top-level block, so the agentic half arrives whole.
  assert.match(text, /<agentic_behavior>\n\n<situation>/u);
  assert.match(text, /<\/how_a_task_runs>\n<\/agentic_behavior>/u);
  assert.match(text, /<workspace_and_tools>/u);
  assert.match(text, /Project instructions$/u);
  assert.doesNotMatch(text, /\n\n\n/u);
});
