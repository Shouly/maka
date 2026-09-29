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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPLORE_AGENT_DEFINITION } from '../agent-catalog.js';
import {
  CHILD_AGENT_INSTRUCTION_SOURCES,
  CHILD_AGENT_MEMORY_READ_ONLY,
  CHILD_AGENT_NOTES,
  assembleChildAgentSystemPrompt,
} from '../system-prompt/child-agent-prompt.js';
import { promptSection } from '../system-prompt/main-session-prompt.js';

test("a child's prompt is its role card over the base every type shares", () => {
  const prompt = assembleChildAgentSystemPrompt({
    roleCard: EXPLORE_AGENT_DEFINITION.systemPrompt,
    memory: true,
    fragments: ['<workspace_instructions>…</workspace_instructions>'],
  });
  const memoryRules = promptSection('user-memory')?.body;
  assert.ok(memoryRules);
  assert.equal(
    prompt,
    [
      EXPLORE_AGENT_DEFINITION.systemPrompt,
      CHILD_AGENT_INSTRUCTION_SOURCES,
      CHILD_AGENT_NOTES,
      memoryRules,
      CHILD_AGENT_MEMORY_READ_ONLY,
      '<workspace_instructions>…</workspace_instructions>',
    ].join('\n\n'),
  );
  // The main session's behaviour sections stay with the main session.
  assert.doesNotMatch(prompt, /<copilot_behavior>|<agentic_behavior>/u);
  assert.match(CHILD_AGENT_NOTES, /Hand back findings directly with SubagentHandback/u);
  assert.doesNotMatch(CHILD_AGENT_NOTES, /final assistant message/u);
});

test('without memory a child reads neither the rules nor the note that narrows them', () => {
  const prompt = assembleChildAgentSystemPrompt({ roleCard: 'Role.', memory: false });
  assert.equal(prompt, ['Role.', CHILD_AGENT_INSTRUCTION_SOURCES, CHILD_AGENT_NOTES].join('\n\n'));
});
