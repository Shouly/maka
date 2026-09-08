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
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { APP_ICONS } from '@maka/core/settings';

const ART = new URL('../apps/desktop/assets/app-icons/', import.meta.url);
test('only the current bundled icon ships; custom artwork belongs to user data', async () => {
  assert.deepEqual(APP_ICONS, ['relx']);
  assert.deepEqual(
    (await readdir(ART)).filter((name) => name.endsWith('.png')),
    ['relx.png'],
  );
});
test('the current SVG, PNG and ICNS reproduce from the brand source and CSS tokens', () => {
  const generator = fileURLToPath(new URL('./generate-relx-icon.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
