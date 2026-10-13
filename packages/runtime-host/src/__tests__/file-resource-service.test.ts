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
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { taskOutputResourceRef } from '@maka/core/file-resources';
import {
  shellRunOutputFilePath,
  taskOutputRoot,
  writeShellRunOutputFile,
  purgeSessionShellRunOutputFiles,
} from '@maka/runtime/shell-run-output-file';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { createSqliteShellRunStore } from '@maka/storage/shell-run-store';
import { acquireOperationalStateDatabase } from '@maka/storage/operational-state-store';
import {
  createHostFileEnvironmentPreparation,
  createHostModelFilePathResolver,
} from '../server/file-resource-model-paths.js';
import { createHostFileResourceService } from '../server/file-resource-service.js';

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'maka-file-resource-service-'));
  const capability = await resolveStorageRoot({ path: temporary, kind: 'interactive' });
  const owner = await tryAcquireInteractiveRootOwner(capability);
  assert.ok(owner);
  const root = capability.canonicalPath;
  const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
  const shellRuns = createSqliteShellRunStore(root);
  const taskRoot = taskOutputRoot(root);
  const service = createHostFileResourceService({ artifacts, shellRuns, taskOutputRoot: taskRoot });
  const sessions = new Set<string>();
  return {
    root,
    artifacts,
    shellRuns,
    service,
    taskRoot,
    async bytes(sessionId: string, ref: string) {
      const file = await service.materialize(sessionId, ref);
      assert.ok(file);
      return readFile(file.path, 'utf8');
    },
    async task(sessionId: string, shellRunId: string, stdout: string) {
      sessions.add(sessionId);
      const record = await shellRuns.createShellRun({
        sessionId,
        shellRunId,
        sourceTurnId: 'producer-turn',
        sourceToolCallId: 'call',
        cwd: root,
        command: 'build',
        status: 'running',
        background: true,
        startedAt: 1,
        updatedAt: 1,
        revision: 1,
        outputFile: shellRunOutputFilePath(taskRoot, sessionId, shellRunId),
        output: {
          mode: 'pipes',
          stdout,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          redacted: false,
        },
      });
      await writeShellRunOutputFile(record);
      return record;
    },
    async close() {
      for (const sessionId of sessions) await purgeSessionShellRunOutputFiles(taskRoot, sessionId);
      shellRuns.close();
      artifacts.close();
      await owner.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

const ref = 'maka://runtime/attachments/file';

test('preparation requires membership; a previously exposed ordinary file is not an authorization API', async () => {
  const f = await fixture();
  try {
    await f.artifacts.create({
      id: 'file',
      sessionId: 'source',
      turnId: 'turn',
      name: 'file.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'owned content',
    });
    const file = await f.service.materialize('source', ref);
    assert.ok(file);
    assert.equal('relativePath' in file, false);
    assert.equal('id' in file, false);
    assert.equal(await readFile(file.path, 'utf8'), 'owned content');
    assert.equal(await f.service.materialize('unrelated', ref), undefined);
    await f.artifacts.purgeSessionArtifacts('source');
    await f.artifacts.collectGarbage({ maxPaths: 100 });
    assert.equal(await f.service.materialize('source', ref), undefined);
    // Revoking management authority cannot revoke bytes already copied onto a
    // Full-access filesystem. Session deletion separately purges its views.
    assert.equal(await readFile(file.path, 'utf8'), 'owned content');
  } finally {
    await f.close();
  }
});

test('namespace restoration leaves missing sources unavailable without blocking other files', async () => {
  const f = await fixture();
  try {
    const missing = await f.artifacts.create({
      id: 'missing',
      sessionId: 'source',
      turnId: 'turn',
      name: 'missing.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'lost bytes',
    });
    await f.artifacts.create({
      id: 'file',
      sessionId: 'source',
      turnId: 'turn',
      name: 'file.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'available bytes',
    });
    await rm(join(f.root, 'artifacts', missing.relativePath));
    await f.service.restoreSessionFiles('source');
    const file = await f.service.materialize('source', ref);
    assert.ok(file);
    assert.equal(await readFile(file.path, 'utf8'), 'available bytes');
    await assert.rejects(f.service.materialize('source', 'maka://runtime/attachments/missing'));
  } finally {
    await f.close();
  }
});

for (const damage of ['directory', 'symlink'] as const) {
  test(`a ${damage} in one execution copy neither blocks a request nor redirects a write; restoration retries it`, {
    skip: damage === 'symlink' && process.platform === 'win32',
  }, async () => {
    const f = await fixture();
    try {
      for (const id of ['broken', 'healthy'])
        await f.artifacts.create({
          id,
          sessionId: 'source',
          turnId: 'turn',
          name: `${id}.txt`,
          kind: 'file',
          source: 'user_delivery',
          content: id,
        });
      const brokenRef = 'maka://runtime/attachments/broken';
      const broken = (await f.service.materialize('source', brokenRef))!;
      await rm(broken.path);
      const outside = join(f.root, 'unrelated.txt');
      await writeFile(outside, 'untouched');
      if (damage === 'directory') await mkdir(broken.path);
      else await symlink(outside, broken.path);
      const boundary = async () => ({ kind: 'bypass' as const, revision: 1 });
      const resolve = createHostModelFilePathResolver({
        sessionId: 'source',
        cwd: f.root,
        readBoundary: boundary,
        materialize: f.service.materialize,
      });
      const prepare = createHostFileEnvironmentPreparation({
        viewRoot: f.service.sessionViewRoot('source'),
        resolve,
        readBoundary: boundary,
        transferredFileRefs: () => f.service.transferredFileRefs('source'),
        restoreSessionFiles: () => f.service.restoreSessionFiles('source'),
      });
      const notice = await prepare([]);
      assert.ok(notice, 'file preparation must not prevent the turn injection');
      assert.equal((await resolve(brokenRef)).ok, false);
      assert.equal(await readFile(outside, 'utf8'), 'untouched');
      assert.equal(await f.bytes('source', 'maka://runtime/attachments/healthy'), 'healthy');
      assert.deepEqual(await f.artifacts.readTextInSession('source', 'broken'), {
        ok: true,
        text: 'broken',
      });
      // A healthy file is not prepared again when retrying just the failed view.
      const healthy = (await f.service.materialize(
        'source',
        'maka://runtime/attachments/healthy',
      ))!;
      await rm(healthy.path);
      await rm(broken.path, { recursive: true, force: true });
      await Promise.all([
        f.service.restoreSessionFiles('source'),
        f.service.restoreSessionFiles('source'),
      ]);
      assert.equal(await readFile(broken.path, 'utf8'), 'broken');
      await assert.rejects(readFile(healthy.path), { code: 'ENOENT' });
    } finally {
      await f.close();
    }
  });
}

test('restoration does not swallow storage failures and can retry after they are repaired', async () => {
  const f = await fixture();
  try {
    await f.artifacts.create({
      id: 'file',
      sessionId: 'source',
      turnId: 'turn',
      name: 'file.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'bytes',
    });
    const failure = new Error('Invalid immutable Artifact metadata');
    let broken = true;
    const service = createHostFileResourceService({
      artifacts: {
        ...f.artifacts,
        getRecordInSession: async (...args) => {
          if (broken) throw failure;
          return f.artifacts.getRecordInSession(...args);
        },
      },
      shellRuns: f.shellRuns,
      taskOutputRoot: f.taskRoot,
    });
    await assert.rejects(service.restoreSessionFiles('source'), (error) => error === failure);
    broken = false;
    await service.restoreSessionFiles('source');
    const file = (await service.materialize('source', ref))!;
    assert.equal(await readFile(file.path, 'utf8'), 'bytes');
  } finally {
    await f.close();
  }
});

test('restoration distinguishes ordinary copy failures from I/O corruption and retries both', async (t) => {
  const f = await fixture();
  try {
    const record = await f.artifacts.create({
      id: 'file',
      sessionId: 'source',
      turnId: 'turn',
      name: 'file.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'bytes',
    });
    const copyFile = fsPromises.copyFile;
    let code: string | undefined = 'ENOSPC';
    t.mock.method(fsPromises, 'copyFile', async (...args: Parameters<typeof copyFile>) => {
      if (code) throw Object.assign(new Error('injected copy failure'), { code });
      return copyFile(...args);
    });
    syncBuiltinESMExports();
    await f.service.restoreSessionFiles('source');
    assert.deepEqual(await f.artifacts.readTextInSession('source', record.id), {
      ok: true,
      text: 'bytes',
    });
    code = 'EIO';
    await assert.rejects(f.service.restoreSessionFiles('source'), { code: 'EIO' });
    code = undefined;
    await f.service.restoreSessionFiles('source');
    assert.equal(await f.bytes('source', ref), 'bytes');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await f.close();
  }
});

test('an invalid Blob is not classified as an unavailable execution cache', async () => {
  const f = await fixture();
  try {
    const record = await f.artifacts.create({
      id: 'file',
      sessionId: 'source',
      turnId: 'turn',
      name: 'file.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'bytes',
    });
    const blob = join(f.root, 'artifacts', record.relativePath);
    await rm(blob);
    await mkdir(blob);
    await assert.rejects(
      f.service.restoreSessionFiles('source'),
      /File resource must be a regular file/,
    );
  } finally {
    await f.close();
  }
});

test('restoring a large Session uses keyset pages and point reads, never per-file membership revisions', async (t) => {
  const f = await fixture();
  const lease = acquireOperationalStateDatabase(f.root);
  try {
    const count = 450;
    const base = await f.artifacts.create({
      id: 'file-0',
      sessionId: 'source',
      turnId: 'turn',
      name: 'file.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'bytes',
    });
    await f.artifacts.createBatch(
      Array.from({ length: count - 1 }, (_, i) => ({
        id: `file-${i + 1}`,
        sessionId: base.sessionId,
        turnId: base.turnId,
        name: base.name,
        kind: base.kind,
        source: base.source,
        reuseArtifactId: base.id,
        ...(i % 2 === 0 ? { taskOutputSnapshotOf: `task-${i}` } : {}),
      })),
    );
    const prepare = lease.database.prepare.bind(lease.database);
    let metadataRows = 0;
    let scans = 0;
    let snapshotScans = 0;
    t.mock.method(lease.database, 'prepare', (sql: string) => {
      assert.doesNotMatch(
        sql,
        /SELECT artifact_id FROM artifact_records WHERE session_id = \? ORDER BY artifact_id/,
        'internal preparation must not compute UI revisions',
      );
      const statement = prepare(sql);
      if (sql.includes('SELECT shell_run_id, artifact_id FROM session_task_output_snapshots'))
        snapshotScans++;
      if (sql.includes('json_set(o.record_json')) {
        if (sql.includes('r.artifact_id > ?')) scans++;
        const all = statement.all.bind(statement);
        statement.all = (...args) => {
          const rows = Reflect.apply(all, statement, args) as ReturnType<typeof all>;
          metadataRows += rows.length;
          return rows;
        };
      }
      return statement;
    });
    await f.service.restoreSessionFiles('source');
    assert.equal(scans, 3);
    assert.equal(
      snapshotScans,
      1,
      'individual task-output preparations must also use point queries',
    );
    assert.equal(metadataRows, count * 3, 'each file is enumerated once and point-read twice');
    await f.service.restoreSessionFiles('source');
    assert.equal(metadataRows, count * 3, 'a completed restoration does no further work');
  } finally {
    t.mock.restoreAll();
    lease.close();
    await f.close();
  }
});

test('preparation never interprets paths or grants a child hand-back', async () => {
  const f = await fixture();
  try {
    await f.artifacts.create({
      id: 'file',
      sessionId: 'child',
      turnId: 'turn',
      name: 'result.txt',
      kind: 'file',
      source: 'user_delivery',
      content: 'child output',
    });
    const child = (await f.service.materialize('child', ref))!;
    assert.equal(await f.service.materialize('parent', ref), undefined);
    assert.equal(await f.service.materialize('parent', child.path), undefined);
    assert.equal((await f.artifacts.listPage('parent', { offset: 0, limit: 10 })).total, 0);
    await f.artifacts.copyConversationArtifacts({
      sourceSessionId: 'child',
      targetSessionId: 'parent',
      turnIds: [],
      includeArtifactIds: ['file'],
    });
    const parent = (await f.service.materialize('parent', ref))!;
    assert.notEqual(parent.path, child.path);
    assert.equal(await readFile(parent.path, 'utf8'), 'child output');
    await f.artifacts.purgeSessionArtifacts('child');
    await f.artifacts.collectGarbage({ maxPaths: 100 });
    assert.equal((await f.service.materialize('parent', ref))?.path, parent.path);
  } finally {
    await f.close();
  }
});

test('live output is Session-scoped and repeated branches keep the first frozen bytes', async () => {
  const f = await fixture();
  try {
    const live = await f.task('source', 'task', 'first output');
    const ref = taskOutputResourceRef('task');
    assert.equal(await f.service.materialize('unrelated', ref), undefined);
    await f.service.freezeTaskOutputs('source', 'branch-1', ['task']);
    const updated = await f.shellRuns.updateShellRun('source', 'task', {
      updatedAt: 2,
      output: {
        mode: 'pipes',
        stdout: 'new output',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    });
    await writeShellRunOutputFile(updated);
    assert.match(await f.bytes('source', ref), /^new output/);
    let source = 'branch-1';
    const first = (await f.artifacts.readTaskOutputSnapshots(source)).get('task');
    assert.ok(first);
    for (const target of ['branch-2', 'branch-3']) {
      await f.artifacts.copyConversationArtifacts({
        sourceSessionId: source,
        targetSessionId: target,
        turnIds: ['consumer-turn'],
        taskOutputIds: ['task'],
      });
      await f.service.freezeTaskOutputs(source, target, ['task']);
      await f.artifacts.purgeSessionArtifacts(source);
      await f.artifacts.collectGarbage({ maxPaths: 100 });
      assert.equal((await f.artifacts.readTaskOutputSnapshots(target)).get('task'), first);
      assert.match(await f.bytes(target, ref), /^first output/);
      source = target;
    }
    await rm(live.outputFile!);
    assert.equal(await f.service.materialize('source', ref), undefined);
    assert.match(await f.bytes(source, ref), /^first output/);
  } finally {
    await f.close();
  }
});

test('missing snapshots stay tombstones even if a same-ID live task later exists', async () => {
  const f = await fixture();
  try {
    await f.service.freezeTaskOutputs('source', 'branch-1', ['missing']);
    await f.task('branch-1', 'missing', 'must not be read');
    assert.equal(
      await f.service.materialize('branch-1', taskOutputResourceRef('missing')),
      undefined,
    );
    await f.artifacts.copyConversationArtifacts({
      sourceSessionId: 'branch-1',
      targetSessionId: 'branch-2',
      turnIds: [],
      taskOutputIds: ['missing'],
    });
    await f.task('branch-2', 'missing', 'must not be snapshotted');
    await f.service.freezeTaskOutputs('branch-1', 'branch-2', ['missing']);
    assert.equal((await f.artifacts.readTaskOutputSnapshots('branch-2')).get('missing'), null);
    assert.equal(
      await f.service.materialize('branch-2', taskOutputResourceRef('missing')),
      undefined,
    );
    assert.equal((await f.artifacts.listPage('branch-2', { offset: 0, limit: 10 })).total, 0);
  } finally {
    await f.close();
  }
});

for (const component of ['file', 'directory'] as const) {
  test(`live output refuses a symlinked ${component}`, {
    skip: process.platform === 'win32',
  }, async () => {
    const f = await fixture();
    try {
      const record = await f.task('source', 'task', 'original');
      const path = component === 'file' ? record.outputFile! : dirname(record.outputFile!);
      const outside = join(f.root, 'redirected');
      await rename(path, outside);
      await symlink(outside, path);
      if (component === 'file') await writeFile(outside, 'unrelated secret');
      await assert.rejects(
        f.service.materialize('source', taskOutputResourceRef('task')),
        /must be a (?:regular file|real directory)/,
      );
      await assert.rejects(
        f.service.freezeTaskOutputs('source', 'branch', ['task']),
        /must be a (?:regular file|real directory)/,
      );
      assert.equal((await f.artifacts.readTaskOutputSnapshots('branch')).size, 0);
    } finally {
      await f.close();
    }
  });
}
