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

// The interactive tool surface — every first-party tool's name, description
// and JSON schema as the provider receives them — pinned as a golden file, so a
// change to what the model is told about a tool is a reviewed diff rather than
// a surprise. Refresh with `MAKA_UPDATE_GOLDEN=1` after reviewing the diff.
//
// The Bash description carries the host shell dialect sentence, which differs
// on Windows, so the test is recorded on POSIX only.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDefaultRuntimePolicy } from '@maka/core/runtime-policy';
import { requestCompositionToolSchemas } from '@maka/runtime/request-shape';
import type { SessionTaskToolStore } from '@maka/runtime/session-task-tools';
import { createInteractiveRunComposer } from '../server/interactive-run-composer.js';
import type { HostMemoryCoordinator } from '../server/memory-coordinator.js';
import type { HostSkillCatalogCoordinator } from '../server/skill-catalog-coordinator.js';

const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  '__tests__',
  'golden',
  'tool-surface.json',
);

test('the interactive tool surface matches its golden file', {
  skip: process.platform === 'win32',
}, () => {
  const composer = createInteractiveRunComposer({
    runtimePolicy: { revision: 0, policy: createDefaultRuntimePolicy() },
    skills: {
      readCanonicalModelInventory: async () => ({ inventory: [] }),
    } as unknown as HostSkillCatalogCoordinator,
    memory: {
      readPromptProjection: async () => ({ revision: null }),
    } as unknown as HostMemoryCoordinator,
    sessionTask: {} as SessionTaskToolStore,
    builtinTools: {},
  });
  const tools = [...composer.tools].sort((left, right) => left.name.localeCompare(right.name));
  const surface = requestCompositionToolSchemas(
    tools,
    tools.map((tool) => tool.name),
  );
  const actual = `${JSON.stringify(surface, null, 2)}\n`;
  if (process.env.MAKA_UPDATE_GOLDEN === '1') writeFileSync(goldenPath, actual, 'utf8');
  const expected = readFileSync(goldenPath, 'utf8');
  assert.equal(
    actual,
    expected,
    'tool surface drifted; review the diff and run with MAKA_UPDATE_GOLDEN=1',
  );
});
