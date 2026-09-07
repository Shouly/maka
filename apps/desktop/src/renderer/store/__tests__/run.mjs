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

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const output = await mkdtemp(join(tmpdir(), 'maka-renderer-state-'));
try {
  const entries = [
    'renderer-state.test.ts',
    'phase2-state.test.ts',
    'phase3-state.test.ts',
    'phase4-state.test.ts',
    'composer-state.test.ts',
    'presentation.test.tsx',
  ].map((name) => fileURLToPath(new URL(name, import.meta.url)));
  const files = [
    'renderer-state.test.mjs',
    'phase2-state.test.mjs',
    'phase3-state.test.mjs',
    'phase4-state.test.mjs',
    'composer-state.test.mjs',
    'presentation.test.mjs',
  ].map((name) => join(output, name));
  await build({
    entryPoints: entries,
    outdir: output,
    outExtension: { '.js': '.mjs' },
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: 'inline',
  });
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
