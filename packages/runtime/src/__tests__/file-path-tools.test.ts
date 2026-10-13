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
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildBuiltinTools } from '../builtin-tools.js';
import { buildSendUserFileTool } from '../send-user-file-tool.js';
import type { MakaToolContext } from '../tool-runtime.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'maka-file-tool-paths-'));
  const source = join(root, 'file-views', 'source', 'task-outputs', 'job', 'file-job.output');
  const branch = join(root, 'file-views', 'branch', 'task-outputs', 'job', 'file-job.output');
  for (const path of [source, branch]) await mkdir(dirname(path), { recursive: true });
  await writeFile(source, 'live output\n');
  await writeFile(branch, 'frozen output\n');
  const tools = buildBuiltinTools();
  let turn = 0;
  const context = (sessionId: string): MakaToolContext => ({
    sessionId,
    turnId: `turn-${++turn}`,
    toolCallId: 'call',
    cwd: root,
    executionBoundary: { kind: 'bypass', revision: 0 },
    abortSignal: new AbortController().signal,
    emitOutput() {},
  });
  return {
    root,
    source,
    branch,
    context,
    tool: (name: string) => tools.find((tool) => tool.name === name)!,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('Read and Grep use the literal path in every Session, including a path resembling a saved view', async () => {
  const f = await fixture();
  try {
    for (const sessionId of ['source', 'branch', 'unrelated']) {
      for (const path of [f.source, relative(f.root, f.source)]) {
        const read = (await f
          .tool('Read')
          .impl({ file_path: path, offset: 1, limit: 1 }, f.context(sessionId))) as {
          content: string;
        };
        assert.equal(read.content, 'live output');
        const grep = await f
          .tool('Grep')
          .impl({ path, pattern: 'live', output_mode: 'content' }, f.context(sessionId));
        assert.match(JSON.stringify(grep), /live output/);
        assert.doesNotMatch(JSON.stringify(grep), /frozen output/);
      }
      assert.equal(
        (
          (await f.tool('Read').impl({ file_path: f.branch }, f.context(sessionId))) as {
            content: string;
          }
        ).content,
        'frozen output\n',
      );
    }
    const native = await promisify(execFile)(process.execPath, [
      '-e',
      'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',
      f.source,
    ]);
    assert.equal(native.stdout, 'live output\n');
    await rm(f.source);
    await assert.rejects(
      async () => f.tool('Read').impl({ file_path: f.source }, f.context('branch')),
      /ENOENT|not found|does not exist/,
    );
    assert.equal(await readFile(f.branch, 'utf8'), 'frozen output\n');
  } finally {
    await f.close();
  }
});

test('SendUserFile captures the bytes at the supplied path, not a Session-dependent resource', async () => {
  const f = await fixture();
  try {
    const captured: Uint8Array[] = [];
    const context: MakaToolContext = {
      ...f.context('branch'),
      recordArtifacts: async (candidates) =>
        Promise.all(
          candidates.map(async (candidate, index) => {
            assert.equal(candidate.reuseArtifactId, undefined);
            const bytes = await candidate.readContent!();
            captured.push(bytes);
            return {
              id: `delivery-${index}`,
              sessionId: 'branch',
              turnId: 'turn',
              createdAt: 1,
              name: candidate.name,
              kind: candidate.kind,
              source: 'user_delivery' as const,
              sizeBytes: bytes.length,
              relativePath: 'private/blob',
            };
          }),
        ),
    };
    await writeFile(f.source, 'changed execution bytes\n');
    await buildSendUserFileTool().impl({ files: [f.source], status: 'normal' }, context);
    assert.equal(Buffer.from(captured[0]!).toString(), await readFile(f.source, 'utf8'));
    assert.equal(await readFile(f.branch, 'utf8'), 'frozen output\n');
  } finally {
    await f.close();
  }
});

test('file writes use filesystem authority rather than a saved-path mutation exception', async () => {
  const f = await fixture();
  try {
    await f.tool('Write').impl({ file_path: f.source, content: 'written\n' }, f.context('branch'));
    assert.equal(await readFile(f.source, 'utf8'), 'written\n');
    await f
      .tool('Edit')
      .impl(
        { file_path: relative(f.root, f.source), old_string: 'written', new_string: 'edited' },
        f.context('branch'),
      );
    assert.equal(await readFile(f.source, 'utf8'), 'edited\n');
    assert.equal(await readFile(f.branch, 'utf8'), 'frozen output\n');
  } finally {
    await f.close();
  }
});

test('external execution without an adapter cannot read existing Host files even with a valid Host cwd', async () => {
  const f = await fixture();
  try {
    const ctx = {
      ...f.context('source'),
      cwd: f.root,
      executionBoundary: { kind: 'external' as const, revision: 0 },
    };
    for (const [name, args] of [
      ['Read', { file_path: f.source }],
      ['Grep', { path: f.source, pattern: 'live' }],
    ] as const)
      await assert.rejects(
        async () => f.tool(name).impl(args, ctx),
        /external|executor|boundary|cwd/i,
      );
    await assert.rejects(
      async () =>
        buildSendUserFileTool().impl(
          { files: [f.source], status: 'normal' },
          {
            ...ctx,
            recordArtifacts: async () => {
              throw new Error('must not publish');
            },
          },
        ),
      /external|executor|boundary|cwd/i,
    );
  } finally {
    await f.close();
  }
});
