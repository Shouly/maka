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
import test from 'node:test';
import { isFirstPartyToolName, TOOL_NAMES, TOOL_SEARCH_PROVIDER_NAME } from '../tool-names.js';

const PROVIDER_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;

test('every canonical name is a valid provider tool name and unique', () => {
  const names = Object.values(TOOL_NAMES);
  for (const name of names) assert.match(name, PROVIDER_TOOL_NAME);
  assert.equal(new Set(names).size, names.length);
  assert.match(TOOL_SEARCH_PROVIDER_NAME, PROVIDER_TOOL_NAME);
  assert.ok(!names.includes(TOOL_SEARCH_PROVIDER_NAME as never));
});

test('first-party names are PascalCase except protocol-owned spellings', () => {
  for (const name of Object.values(TOOL_NAMES)) {
    if (name === TOOL_NAMES.applyPatch) continue;
    assert.match(name, /^[A-Z][A-Za-z0-9]*$/u, name);
  }
});

test('first-party names are recognised and foreign names are not', () => {
  for (const name of Object.values(TOOL_NAMES)) assert.ok(isFirstPartyToolName(name), name);
  assert.ok(!isFirstPartyToolName('mcp__docs__read'));
  assert.ok(!isFirstPartyToolName(TOOL_SEARCH_PROVIDER_NAME));
});
