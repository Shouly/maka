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
import { describe, it } from 'node:test';

import { isSensitiveEnvName, sandboxedEnvironment } from '../sandbox/sandbox-environment.js';

describe('sandboxedEnvironment', () => {
  it('withholds every variable whose name says it holds a credential', () => {
    for (const name of [
      'OPENAI_API_KEY',
      'GITHUB_TOKEN',
      'npm_config_secret',
      'AwsSecretAccessKey',
    ]) {
      assert.equal(isSensitiveEnvName(name), true, name);
    }
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'SSH_AUTH_SOCK', 'KEYBOARD']) {
      assert.equal(isSensitiveEnvName(name), name === 'KEYBOARD', name);
    }
    assert.deepEqual(
      sandboxedEnvironment({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', GH_TOKEN: 't', LANG: 'C' }),
      { PATH: '/bin', LANG: 'C' },
    );
  });
});
