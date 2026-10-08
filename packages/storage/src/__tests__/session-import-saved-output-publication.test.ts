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
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSessionStore } from '../session-store.js';
import { importSessionBundleState } from '../session-bundle-policy.js';

interface Fixture {
  base: string;
  bundleStateRoot: string;
  stateRoot: string;
  sessionId: string;
  sourceFolder: string;
  targetFolder: string;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'maka-import-output-publication-')));
  try {
    const bundleStateRoot = join(base, 'bundle');
    const stateRoot = join(base, 'target');
    await mkdir(stateRoot);
    const sessions = createSessionStore(bundleStateRoot);
    let sessionId: string;
    try {
      sessionId = (
        await sessions.create({
          cwd: bundleStateRoot,
          llmConnectionSlug: 'test',
          model: 'test',
          permissionMode: 'ask',
          name: 'Saved outputs',
        })
      ).id;
    } finally {
      await sessions.close?.();
    }
    const sourceFolder = join(bundleStateRoot, 'tool-results', sessionId);
    await mkdir(sourceFolder, { recursive: true });
    await run({
      base,
      bundleStateRoot,
      stateRoot,
      sessionId,
      sourceFolder,
      targetFolder: join(stateRoot, 'tool-results', sessionId),
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test('saved outputs publish privately and an identical file left before import is accepted', async () => {
  await withFixture(async (fixture) => {
    await writeFile(join(fixture.sourceFolder, 'existing.txt'), 'existing');
    await writeFile(join(fixture.sourceFolder, 'new.txt'), 'complete output');
    await mkdir(fixture.targetFolder, { recursive: true, mode: 0o700 });
    const existing = join(fixture.targetFolder, 'existing.txt');
    await writeFile(existing, 'existing', { mode: 0o600 });
    const before = await stat(existing);
    const result = await importSessionBundleState(fixture);
    assert.deepEqual(result.sessionIds, [fixture.sessionId]);
    assert.equal((await stat(existing)).ino, before.ino);
    const saved = join(fixture.targetFolder, 'new.txt');
    assert.equal(await readFile(saved, 'utf8'), 'complete output');
    assert.deepEqual((await readdir(fixture.targetFolder)).sort(), ['existing.txt', 'new.txt']);
    if (process.platform !== 'win32') assert.equal((await stat(saved)).mode & 0o777, 0o600);
  });
});

test('a later database failure removes only newly published outputs and a retry succeeds', async () => {
  await withFixture(async (fixture) => {
    await writeFile(join(fixture.sourceFolder, 'existing.txt'), 'existing');
    await writeFile(join(fixture.sourceFolder, 'new.txt'), 'complete output');
    await mkdir(fixture.targetFolder, { recursive: true });
    const existing = join(fixture.targetFolder, 'existing.txt');
    await writeFile(existing, 'existing');
    const database = new DatabaseSync(join(fixture.bundleStateRoot, 'runtime.sqlite'));
    try {
      database.exec('PRAGMA foreign_keys = OFF');
      database
        .prepare(`INSERT INTO core_agent_run_events
        (session_id, run_id, sequence, event_id, event_type, event_ts, record_json)
        VALUES (?, 'absent-run', 0, 'orphan', 'history_compact_checkpoint_recorded', 1, '{}')`)
        .run(fixture.sessionId);
      await assert.rejects(importSessionBundleState(fixture), { code: 'conflict' });
      assert.equal(await readFile(existing, 'utf8'), 'existing');
      await assert.rejects(lstat(join(fixture.targetFolder, 'new.txt')), { code: 'ENOENT' });
      const target = new DatabaseSync(join(fixture.stateRoot, 'runtime.sqlite'), {
        readOnly: true,
      });
      try {
        assert.equal(target.prepare('SELECT COUNT(*) AS n FROM session_metadata').get()?.n, 0);
      } finally {
        target.close();
      }
      database.prepare('DELETE FROM core_agent_run_events WHERE event_id = ?').run('orphan');
      await importSessionBundleState(fixture);
      assert.equal(
        await readFile(join(fixture.targetFolder, 'new.txt'), 'utf8'),
        'complete output',
      );
    } finally {
      database.close();
    }
  });
});

test('a conflicting saved output is preserved and no Session is published', async () => {
  await withFixture(async (fixture) => {
    await writeFile(join(fixture.sourceFolder, 'result.txt'), 'incoming');
    await mkdir(fixture.targetFolder, { recursive: true });
    await writeFile(join(fixture.targetFolder, 'result.txt'), 'existing different bytes');
    await assert.rejects(importSessionBundleState(fixture), { code: 'conflict' });
    assert.equal(
      await readFile(join(fixture.targetFolder, 'result.txt'), 'utf8'),
      'existing different bytes',
    );
    const database = new DatabaseSync(join(fixture.stateRoot, 'runtime.sqlite'), {
      readOnly: true,
    });
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM session_metadata').get()?.n, 0);
    } finally {
      database.close();
    }
  });
});

for (const kind of ['root', 'session'] as const) {
  test(`saved output import refuses a ${kind} directory linked outside the state root`, async () => {
    await withFixture(async (fixture) => {
      await writeFile(join(fixture.sourceFolder, 'result.txt'), 'incoming');
      const outside = join(fixture.base, 'outside');
      await mkdir(outside);
      const linkPath =
        kind === 'root' ? join(fixture.stateRoot, 'tool-results') : fixture.targetFolder;
      if (kind === 'session') await mkdir(join(fixture.stateRoot, 'tool-results'));
      await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(importSessionBundleState(fixture), /escapes the Storage Root/u);
      assert.deepEqual(await readdir(outside), []);
    });
  });
}
