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
import { isProviderSandboxBoundaryAttempt } from '../ai-sdk-tool-repair.js';

test('a boundary attempt is RequestSandboxBoundary as registered, or a Bash that declares expand', () => {
  // The tool is PascalCase; lower-casing the call's name before comparing
  // made every RequestSandboxBoundary call invisible to the denial backstop.
  assert.equal(
    isProviderSandboxBoundaryAttempt({ toolName: 'RequestSandboxBoundary', input: '{}' }),
    true,
  );
  assert.equal(
    isProviderSandboxBoundaryAttempt({
      toolName: 'Bash',
      input: JSON.stringify({ command: 'ls', boundary_intent: 'expand' }),
    }),
    true,
  );
  assert.equal(
    isProviderSandboxBoundaryAttempt({
      toolName: 'Bash',
      input: JSON.stringify({ command: 'ls', boundary_intent: 'current' }),
    }),
    false,
  );
  assert.equal(isProviderSandboxBoundaryAttempt({ toolName: 'Read', input: '{}' }), false);
});
