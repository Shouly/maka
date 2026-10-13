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
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { taskOutputResourceRef } from '@maka/core/file-resources';
import { createReadOnlyPermissionProfile } from '@maka/core/permission-profile';
import type { ExecutionBoundary } from '@maka/core/sandbox-boundary';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import {
  createSeatbeltExecArgs,
  createBuiltinSandboxManager,
  isBuiltinFilesystemWorkerSandboxAvailable,
} from '@maka/runtime/sandbox';
import {
  FilesystemWorkerClient,
  createFilesystemWorkerLaunchSpecProvider,
} from '@maka/runtime/filesystem-worker';
import { exportSessionBundle } from '@maka/runtime/session-export';
import { importSessionBundle } from '@maka/runtime/session-import';
import { createSessionStore } from '@maka/storage/session-store';
import { openInteractiveExecutionStoresForWrite } from '@maka/storage/execution-stores';
import { seedInvocation } from '@maka/runtime/test-only/invocation-fixture';
import { buildBuiltinTools } from '@maka/runtime/builtin-tools';
import {
  projectFileResourcePaths,
  toolResultFileBindings,
} from '@maka/runtime/file-resource-projection';
import { buildSendUserFileTool } from '@maka/runtime/send-user-file-tool';
import {
  shellRunOutputFilePath,
  taskOutputRoot,
  writeShellRunOutputFile,
  purgeSessionShellRunOutputFiles,
} from '@maka/runtime/shell-run-output-file';
import type { MakaToolContext } from '@maka/runtime/tool-runtime';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { createSqliteShellRunStore } from '@maka/storage/shell-run-store';
import { createHostExecutionArtifactServices } from '../server/execution-artifacts.js';
import { createHostFileResourceService } from '../server/file-resource-service.js';
import {
  createHostFileEnvironmentPreparation,
  createHostModelFilePathResolver,
  restrictWorkHubFileBoundary,
} from '../server/file-resource-model-paths.js';
import { purgeFileResourceViews } from '../server/file-resource-view.js';
import { SessionAdmissionGate } from '../server/session-admission-gate.js';
import { purgeSessionSidecars } from '../server/session-sidecar-purge.js';

const execFileAsync = promisify(execFile);
const ref = 'maka://runtime/attachments/file';
const bytes = '{"answer":42}\n';

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'maka-file-paths-'));
  const capability = await resolveStorageRoot({ path: temporary, kind: 'interactive' });
  const owner = await tryAcquireInteractiveRootOwner(capability);
  assert.ok(owner);
  const root = capability.canonicalPath;
  const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
  const shellRuns = createSqliteShellRunStore(root);
  const taskRoot = taskOutputRoot(root);
  const service = createHostFileResourceService({ artifacts, shellRuns, taskOutputRoot: taskRoot });
  let drains = 0;
  const execution = createHostExecutionArtifactServices({
    artifacts,
    fileResources: service,
    sessionAdmission: new SessionAdmissionGate(),
    sessions: { probeSessionRemoval: async () => ({ kind: 'present' }) },
    requestDrain: () => {
      drains++;
    },
  });
  const context = (sessionId: string): MakaToolContext => ({
    sessionId,
    turnId: 'turn',
    toolCallId: 'call',
    operationId: 'operation',
    cwd: root,
    executionBoundary: { kind: 'bypass', revision: 1 },
    abortSignal: new AbortController().signal,
    emitOutput() {},
    recordArtifacts: (candidates) =>
      execution.recordToolArtifacts({
        sessionId,
        turnId: 'turn',
        toolUseId: 'call',
        toolName: 'SendUserFile',
        args: {},
        result: {},
        cwd: root,
        candidates: [...candidates],
      }),
  });
  const sandboxManager = createBuiltinSandboxManager();
  const filesystemWorker =
    sandboxManager && isBuiltinFilesystemWorkerSandboxAvailable()
      ? new FilesystemWorkerClient({
          sandboxManager,
          getLaunchSpec: createFilesystemWorkerLaunchSpecProvider({
            runtime: 'node',
            platform: process.platform,
            resourceLocation: { kind: 'runtime' },
          }),
        })
      : undefined;
  const tools = buildBuiltinTools({ snapshotImage: execution.snapshotImage, filesystemWorker });
  const resolver = (sessionId: string) =>
    createHostModelFilePathResolver({
      sessionId,
      cwd: root,
      readBoundary: async () => ({ kind: 'bypass', revision: 1 }),
      materialize: service.materialize,
    });
  return {
    root,
    lease: owner.lease,
    artifacts,
    shellRuns,
    taskRoot,
    service,
    execution,
    context,
    resolver,
    tool: (name: string) => tools.find((tool) => tool.name === name)!,
    drains: () => drains,
    async path(sessionId: string, resource = ref) {
      const file = await service.materialize(sessionId, resource);
      assert.ok(file, `Missing prepared file in ${sessionId}`);
      return file.path;
    },
    environment(sessionId: string) {
      return createHostFileEnvironmentPreparation({
        viewRoot: service.sessionViewRoot(sessionId),
        resolve: resolver(sessionId),
        readBoundary: async () => ({ kind: 'bypass', revision: 1 }),
        restoreSessionFiles: () => service.restoreSessionFiles(sessionId),
        transferredFileRefs: () => service.transferredFileRefs(sessionId),
      });
    },
    async close() {
      await purgeSessionShellRunOutputFiles(taskRoot, 'source');
      shellRuns.close();
      artifacts.close();
      await owner.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

async function savedFile(f: Awaited<ReturnType<typeof fixture>>, sessionId = 'source') {
  return f.artifacts.create({
    id: 'file',
    sessionId,
    turnId: 'turn',
    name: '中文 report.json',
    kind: 'file',
    source: 'user_delivery',
    content: bytes,
  });
}

function injectionEvent(
  injection: { name: string; text: string; revision?: string },
  sessionId: string,
): RuntimeEvent {
  return {
    id: 'environment-stamp',
    sessionId,
    runId: 'run',
    invocationId: 'run',
    turnId: 'turn',
    ts: 1,
    partial: false,
    author: 'system',
    role: 'system',
    content: {
      kind: 'injection',
      name: injection.name,
      text: injection.text,
      data: { revision: injection.revision, position: 'after' },
    },
  };
}

test('Host-prepared paths have identical bytes in Read, Grep, a process and SendUserFile', async () => {
  const f = await fixture();
  try {
    const record = await savedFile(f);
    const blob = join(f.root, 'artifacts', record.relativePath);
    const originalBlob = await stat(blob);
    const content = { kind: 'json' as const, value: { output: ref }, fileRefs: [ref] };
    const durable = { type: 'text' as const, value: `Output: ${ref}` };
    const before = JSON.stringify({ content, durable });
    const projected = await projectFileResourcePaths(
      durable,
      toolResultFileBindings(content),
      f.resolver('source'),
    );
    const path = await f.path('source');
    assert.doesNotMatch(path, /blobs[\\/]sha256|maka:\/\//);
    assert.ok(JSON.stringify(projected).includes(JSON.stringify(path).slice(1, -1)));
    assert.equal(JSON.stringify({ content, durable }), before);
    const result = (await f.tool('Read').impl({ file_path: path }, f.context('source'))) as {
      content: string;
    };
    assert.equal(result.content, bytes);
    const grep = (await f.tool('Grep').impl({ path, pattern: 'answer' }, f.context('source'))) as {
      matches: string[];
    };
    assert.deepEqual(grep.matches, [path]);
    assert.equal(
      (
        await execFileAsync(process.execPath, [
          '-e',
          'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',
          path,
        ])
      ).stdout,
      bytes,
    );
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o222, 0);
      assert.equal(
        (await execFileAsync('/bin/sh', ['-c', 'cat -- "$1"', 'read-saved', path])).stdout,
        bytes,
      );
    }
    assert.notEqual((await stat(path)).ino, originalBlob.ino);
    const delivered = await buildSendUserFileTool().impl(
      { files: [path], status: 'normal' },
      f.context('source'),
    );
    assert.equal(
      (await f.artifacts.getInSession('source', delivered.files[0]!.artifactId)).record
        ?.relativePath,
      record.relativePath,
    );
    assert.equal(f.drains(), 0);
  } finally {
    await f.close();
  }
});

test('ordinary Python consumes the actual Host-prepared JSON path', async (t) => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  try {
    await execFileAsync(python, ['-I', '-S', '-c', 'pass'], { timeout: 10_000 });
  } catch {
    t.skip('Python is not installed or usable');
    return;
  }
  const f = await fixture();
  try {
    await savedFile(f);
    const path = await f.path('source');
    const result = await execFileAsync(
      python,
      [
        '-I',
        '-S',
        '-c',
        'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["answer"])',
        path,
      ],
      { timeout: 10_000 },
    );
    assert.equal(result.stdout.trim(), '42');
  } finally {
    await f.close();
  }
});

test('Full access uses literal paths across Sessions; delivery captures modifications, not the original Blob', async () => {
  const f = await fixture();
  try {
    const record = await savedFile(f);
    const path = await f.path('source');
    await chmod(path, 0o600);
    await f
      .tool('Write')
      .impl({ file_path: path, content: 'actual edited bytes' }, f.context('source'));
    const read = (await f
      .tool('Read')
      .impl({ file_path: relative(f.root, path) }, f.context('unrelated'))) as { content: string };
    assert.equal(read.content, 'actual edited bytes');
    const delivery = await buildSendUserFileTool().impl(
      { files: [path], status: 'normal' },
      f.context('source'),
    );
    const captured = await f.artifacts.readTextInSession('source', delivery.files[0]!.artifactId);
    assert.ok(captured.ok);
    assert.equal(captured.text, 'actual edited bytes');
    assert.equal(await readFile(join(f.root, 'artifacts', record.relativePath), 'utf8'), bytes);
    assert.equal(await f.service.materialize('unrelated', ref), undefined);
  } finally {
    await f.close();
  }
});

test('execution copies are repairable after tampering, deletion and restart without changing Blob bytes', async () => {
  const f = await fixture();
  try {
    const record = await savedFile(f);
    const path = await f.path('source');
    const blob = join(f.root, 'artifacts', record.relativePath);
    const before = await stat(blob);
    await chmod(path, 0o600);
    await writeFile(path, 'tampered');
    assert.equal(await f.path('source'), path);
    assert.equal(await readFile(path, 'utf8'), bytes);
    assert.equal((await stat(blob)).mtimeMs, before.mtimeMs);
    await rm(path);
    const restarted = createHostFileResourceService({
      artifacts: f.artifacts,
      shellRuns: f.shellRuns,
      taskOutputRoot: f.taskRoot,
    });
    assert.equal((await restarted.materialize('source', ref))?.path, path);
    assert.equal(await readFile(path, 'utf8'), bytes);
  } finally {
    await f.close();
  }
});

test('repeated branches retain stable identities after source deletion; old paths never redirect', async () => {
  const f = await fixture();
  try {
    await savedFile(f);
    let source = 'source';
    for (const target of ['branch-1', 'branch-2', 'branch-3']) {
      const oldPath = await f.path(source);
      await f.artifacts.copyConversationArtifacts({
        sourceSessionId: source,
        targetSessionId: target,
        turnIds: [],
        includeArtifactIds: ['file'],
      });
      await purgeSessionSidecars(
        {
          artifacts: f.artifacts,
          sessionTask: { purgeSessionState: async () => {} },
          taskOutputRoot: f.taskRoot,
          purgeOperationalState: async () => f.service.forgetSession(source),
        },
        source,
      );
      await f.artifacts.collectGarbage({ maxPaths: 100 });
      const path = await f.path(target);
      assert.notEqual(path, oldPath);
      assert.equal(await readFile(path, 'utf8'), bytes);
      assert.equal(await f.service.materialize(target, oldPath), undefined);
      await assert.rejects(
        async () => f.tool('Read').impl({ file_path: oldPath }, f.context(target)),
        /does not exist|ENOENT/,
      );
      assert.equal((await f.artifacts.getInSession(target, 'file')).record?.id, 'file');
      source = target;
    }
  } finally {
    await f.close();
  }
});

test('a formal hand-back commits parent ownership before preparation and survives child removal', async () => {
  const f = await fixture();
  try {
    await savedFile(f, 'child');
    await f.artifacts.create({
      id: 'private',
      sessionId: 'child',
      turnId: 'turn',
      name: 'private.txt',
      kind: 'file',
      source: 'user_upload',
      content: 'not returned',
    });
    assert.equal(await f.service.materialize('parent', ref), undefined);
    assert.deepEqual(await f.execution.retainChildArtifacts!('parent', 'child', ['file']), [
      'file',
    ]);
    const parentPath = await f.path('parent');
    assert.notEqual(parentPath, await f.path('child'));
    assert.equal(
      await f.service.materialize('parent', 'maka://runtime/attachments/private'),
      undefined,
    );
    await f.artifacts.purgeSessionArtifacts('child');
    await purgeFileResourceViews(f.root, 'child');
    await f.artifacts.collectGarbage({ maxPaths: 100 });
    assert.equal(await readFile(await f.path('parent'), 'utf8'), bytes);
    assert.equal(await f.service.materialize('unrelated', ref), undefined);
  } finally {
    await f.close();
  }
});

test('live task files and branch snapshots are different paths with ordinary filesystem semantics', async () => {
  const f = await fixture();
  try {
    const record = await f.shellRuns.createShellRun({
      sessionId: 'source',
      shellRunId: 'task',
      sourceTurnId: 'turn',
      sourceToolCallId: 'call',
      cwd: f.root,
      command: 'build',
      status: 'running',
      background: true,
      startedAt: 1,
      updatedAt: 1,
      revision: 1,
      outputFile: shellRunOutputFilePath(f.taskRoot, 'source', 'task'),
      output: {
        mode: 'pipes',
        stdout: 'first\nsecond\nthird\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    });
    await writeShellRunOutputFile(record);
    const outputRef = taskOutputResourceRef('task');
    const live = await f.path('source', outputRef);
    await f.service.freezeTaskOutputs('source', 'branch', ['task']);
    const snapshot = await f.path('branch', outputRef);
    const frozen = await readFile(snapshot, 'utf8');
    const page = (await f
      .tool('Read')
      .impl({ file_path: snapshot, offset: 2, limit: 1 }, f.context('branch'))) as {
      content: string;
    };
    assert.equal(page.content, 'second');
    const updated = await f.shellRuns.updateShellRun('source', 'task', {
      updatedAt: 2,
      output: {
        mode: 'pipes',
        stdout: 'later output',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    });
    await writeShellRunOutputFile(updated);
    await f.service.refreshTaskOutput('source', 'task');
    assert.match(await readFile(live, 'utf8'), /^later output/);
    assert.equal(await readFile(snapshot, 'utf8'), frozen);
    const literal = (await f.tool('Read').impl({ file_path: live }, f.context('branch'))) as {
      content: string;
    };
    assert.match(literal.content, /^later output/);
    await f.artifacts.copyConversationArtifacts({
      sourceSessionId: 'branch',
      targetSessionId: 'branch-again',
      turnIds: [],
      taskOutputIds: ['task'],
    });
    await purgeSessionShellRunOutputFiles(f.taskRoot, 'source');
    await purgeFileResourceViews(f.root, 'source');
    await f.artifacts.purgeSessionArtifacts('branch');
    await purgeFileResourceViews(f.root, 'branch');
    await f.artifacts.collectGarbage({ maxPaths: 100 });
    assert.equal(await readFile(await f.path('branch-again', outputRef), 'utf8'), frozen);
    const userTask = await f.shellRuns.createShellRun({
      ...record,
      shellRunId: 'private',
      visibility: 'user',
      outputFile: shellRunOutputFilePath(f.taskRoot, 'source', 'private'),
    });
    await writeShellRunOutputFile(userTask);
    assert.equal(
      await f.service.materialize('source', taskOutputResourceRef('private')),
      undefined,
    );
    assert.ok(
      !(await f.service.transferredFileRefs('source')).includes(taskOutputResourceRef('private')),
    );
  } finally {
    await f.close();
  }
});

test('Read renders PNGs and reads MIME-named SVG execution files as ordinary text', async () => {
  const f = await fixture();
  try {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
      'base64',
    );
    for (const [id, name, mimeType, content] of [
      ['png', 'image.png', 'image/png', png],
      ['svg', 'vector.bin', 'IMAGE/SVG+XML', '<svg/>'],
    ] as const) {
      await f.artifacts.create({
        id,
        sessionId: 'source',
        turnId: 'turn',
        name,
        kind: 'image',
        source: 'tool_result',
        mimeType,
        content,
      });
      const path = await f.path('source', `maka://runtime/attachments/${id}`);
      const result = (await f.tool('Read').impl({ file_path: path }, f.context('source'))) as {
        kind?: string;
        content?: string;
        ref?: { kind: string; relativePath: string };
      };
      if (id === 'png') {
        assert.equal(result.kind, 'image');
        assert.equal(result.ref?.kind, 'session_file');
        const snapshotId = result.ref!.relativePath;
        await f.artifacts.copyConversationArtifacts({
          sourceSessionId: 'source',
          targetSessionId: 'branch',
          turnIds: [],
          includeArtifactIds: [snapshotId],
        });
        await f.artifacts.deleteOwnedArtifactInSession(
          'source',
          snapshotId,
          'tool_result_projection',
        );
        assert.deepEqual(
          await readFile(await f.path('branch', `maka://runtime/attachments/${snapshotId}`)),
          png,
        );
      } else {
        assert.ok(path.endsWith('.svg'));
        assert.equal(result.content, '<svg/>');
      }
    }
  } finally {
    await f.close();
  }
});

test('delivery is independent of original membership but fails if the actual file disappears', async () => {
  const f = await fixture();
  try {
    await savedFile(f);
    const path = await f.path('source');
    const context = f.context('source');
    const record = context.recordArtifacts!;
    context.recordArtifacts = async (candidates) => {
      await f.artifacts.deleteUserArtifactInSession('source', 'file');
      return record(candidates);
    };
    const result = await buildSendUserFileTool().impl({ files: [path], status: 'normal' }, context);
    assert.equal(result.files.length, 1);
    context.recordArtifacts = async (candidates) => {
      await rm(path);
      return record(candidates);
    };
    await assert.rejects(async () =>
      buildSendUserFileTool().impl({ files: [path], status: 'normal' }, context),
    );
    assert.equal(f.drains(), 0);
  } finally {
    await f.close();
  }
});

for (const component of ['file', 'directory'] as const) {
  test(`materialization refuses a planted ${component} symlink`, {
    skip: process.platform === 'win32',
  }, async () => {
    const f = await fixture();
    try {
      await savedFile(f);
      const path = await f.path('source');
      const target = component === 'file' ? path : dirname(path);
      await rm(target, { recursive: true, force: true });
      const outside = join(f.root, 'outside');
      if (component === 'file') await writeFile(outside, 'untouched');
      else {
        await mkdir(outside);
        await writeFile(join(outside, 'sentinel'), 'untouched');
      }
      await symlink(outside, target);
      await assert.rejects(
        f.service.materialize('source', ref),
        /must be a (?:regular file|real directory)/,
      );
      assert.equal(
        await readFile(component === 'file' ? outside : join(outside, 'sentinel'), 'utf8'),
        'untouched',
      );
    } finally {
      await f.close();
    }
  });
}

test('Host projection respects managed deny, actual read-only boundaries and absent external adapters', async () => {
  const f = await fixture();
  try {
    await savedFile(f);
    let boundary: ExecutionBoundary = { kind: 'external', revision: 0 };
    let copies = 0;
    const resolve = createHostModelFilePathResolver({
      sessionId: 'source',
      cwd: f.root,
      readBoundary: async () => boundary,
      materialize: async (...args) => {
        copies++;
        return f.service.materialize(...args);
      },
    });
    assert.equal((await resolve(ref)).ok, false);
    assert.equal(copies, 0);
    boundary = { kind: 'managed', revision: 1, profile: createReadOnlyPermissionProfile() };
    const allowed = await resolve(ref);
    assert.ok(allowed.ok);
    assert.equal(allowed.readOnly, true);
    assert.equal(await readFile(allowed.file.path, 'utf8'), bytes);
    boundary = {
      kind: 'managed',
      revision: 2,
      profile: {
        ...createReadOnlyPermissionProfile(),
        fileSystem: {
          kind: 'restricted',
          entries: [{ kind: 'path', path: join(f.root, 'file-views'), access: 'deny' }],
        },
      },
    };
    assert.equal((await resolve(ref)).ok, false);
    boundary = { kind: 'bypass', revision: 3 };
    const full = await resolve(ref);
    assert.ok(full.ok);
    assert.equal(full.readOnly, false);
    const workhub = await restrictWorkHubFileBoundary(
      boundary,
      f.service.sessionViewRoot('source'),
      f.root,
    );
    const ctx = { ...f.context('source'), executionBoundary: workhub };
    const read = (await f.tool('Read').impl({ file_path: allowed.file.path }, ctx)) as {
      content: string;
    };
    assert.equal(read.content, bytes);
    const outside = join(f.root, 'private.txt');
    await writeFile(outside, 'secret');
    await assert.rejects(async () => f.tool('Read').impl({ file_path: outside }, ctx));
    await assert.rejects(async () =>
      f.tool('Write').impl({ file_path: allowed.file.path, content: 'changed' }, ctx),
    );
  } finally {
    await f.close();
  }
});

test('real macOS sandbox processes can read but cannot chmod/write saved files', {
  skip: process.platform !== 'darwin',
}, async () => {
  const f = await fixture();
  try {
    await savedFile(f);
    const path = await f.path('source');
    const run = (innerArgv: string[]) =>
      execFileAsync(
        '/usr/bin/sandbox-exec',
        createSeatbeltExecArgs({
          profile: createReadOnlyPermissionProfile(),
          pathContext: { workspaceRoots: [f.root] },
          innerArgv,
        }),
        { cwd: f.root },
      );
    assert.equal((await run(['/bin/cat', path])).stdout, bytes);
    await assert.rejects(
      run(['/bin/sh', '-c', 'chmod 600 "$1" && printf changed > "$1"', 'attempt-write', path]),
    );
    assert.equal(await readFile(path, 'utf8'), bytes);
  } finally {
    await f.close();
  }
});

test('large resources and portable execution names do not change display names or content', async () => {
  const f = await fixture();
  try {
    for (const [index, name] of [
      `${'汉'.repeat(90)}.json`,
      `a${'😀'.repeat(60)}`,
      'CON.json',
      'large.bin',
    ].entries()) {
      const id = `portable-${index}`;
      const content =
        index === 3 ? Buffer.alloc(11 * 1024 * 1024, 65) : Buffer.from('portable bytes');
      const record = await f.artifacts.create({
        id,
        sessionId: 'source',
        turnId: 'turn',
        name,
        kind: 'file',
        source: 'user_upload',
        content,
      });
      const file = (await f.service.materialize('source', `maka://runtime/attachments/${id}`))!;
      assert.equal(file.name, record.name);
      assert.ok(Buffer.byteLength(basename(file.path)) <= 200);
      assert.equal(Buffer.from(file.path).toString('utf8'), file.path);
      assert.deepEqual(await readFile(file.path), content);
      if (index === 0) assert.ok(file.path.endsWith('.json'));
    }
  } finally {
    await f.close();
  }
});

test('environment changes announce paths once; same-environment compaction/restarts do not add a file listing', async () => {
  const f = await fixture();
  try {
    await savedFile(f);
    let scans = 0;
    const prepare = createHostFileEnvironmentPreparation({
      viewRoot: f.service.sessionViewRoot('source'),
      resolve: f.resolver('source'),
      restoreSessionFiles: () => f.service.restoreSessionFiles('source'),
      readBoundary: async () => ({ kind: 'bypass', revision: 1 }),
      transferredFileRefs: async () => {
        scans++;
        return f.service.transferredFileRefs('source');
      },
    });
    const initial = (await prepare([]))!;
    const sourceEvents = [injectionEvent(initial, 'source')];
    assert.equal(await prepare(sourceEvents), undefined);
    assert.equal(scans, 0);
    assert.equal(await f.environment('source')(sourceEvents), undefined);
    const oldPath = await f.path('source');
    await purgeFileResourceViews(f.root, 'source');
    f.service.forgetSession('source');
    assert.equal(
      await prepare(sourceEvents),
      undefined,
      'restore is not a model file-list announcement',
    );
    assert.equal(await readFile(oldPath, 'utf8'), bytes);
    assert.equal(scans, 0);
    await f.artifacts.copyConversationArtifacts({
      sourceSessionId: 'source',
      targetSessionId: 'branch',
      turnIds: ['turn'],
    });
    const unchangedHistory = JSON.stringify(sourceEvents);
    const moved = (await f.environment('branch')(sourceEvents))!;
    assert.ok(moved.text.includes(await f.path('branch')));
    assert.equal(JSON.stringify(sourceEvents), unchangedHistory);
    const afterMove = [...sourceEvents, injectionEvent(moved, 'branch')];
    assert.equal(await f.environment('branch')(afterMove), undefined);
    assert.doesNotMatch(moved.text, /maka:\/\/|blobs[\\/]sha256/);
  } finally {
    await f.close();
  }
});

test('archive import rebuilds paths and announces the move without rewriting history or bundling caches', async () => {
  const f = await fixture();
  const target = await mkdtemp(join(tmpdir(), 'maka-imported-paths-'));
  const sessions = createSessionStore(f.root);
  try {
    const header = await sessions.create({
      cwd: f.root,
      llmConnectionSlug: 'test',
      model: 'test',
      permissionMode: 'ask',
      name: 'portable files',
    });
    await savedFile(f, header.id);
    const oldPath = await f.path(header.id);
    const sourceEvent = injectionEvent((await f.environment(header.id)([]))!, header.id);
    const stores = await openInteractiveExecutionStoresForWrite(f.lease);
    await seedInvocation(stores.runtimeEventStore, {
      sessionId: header.id,
      runId: 'run',
      turnId: 'turn',
      openedAt: 0,
    });
    await stores.runtimeEventStore.appendRuntimeEvent(header.id, 'run', sourceEvent);
    await stores.runtimeEventStore.appendRuntimeEvent(header.id, 'run', {
      ...sourceEvent,
      id: 'old-path-in-prose',
      ts: 2,
      role: 'model',
      author: 'agent',
      content: { kind: 'text', text: `Working file: ${oldPath}` },
    });
    const { content: _injection, ...identity } = sourceEvent;
    await stores.runtimeEventStore.appendRuntimeEvent(header.id, 'run', {
      ...identity,
      id: 'finished',
      ts: 3,
      status: 'completed',
    });
    const oldHistory = JSON.stringify(
      await stores.runtimeEventStore.readRuntimeEvents(header.id, 'run'),
    );
    await stores.sessionStore.close?.();
    const bundle = join(target, 'session.maka-session');
    const exported = await exportSessionBundle({
      workspaceRoot: f.root,
      sessionId: header.id,
      destination: bundle,
      lease: f.lease,
    });
    assert.ok(exported.ok, JSON.stringify(exported));
    const restored = join(target, 'state');
    await mkdir(restored);
    const imported = await importSessionBundle({ workspaceRoot: restored, source: bundle });
    assert.ok(imported.ok, JSON.stringify(imported));
    await assert.rejects(stat(join(restored, 'file-views')), { code: 'ENOENT' });
    await f.artifacts.purgeSessionArtifacts(header.id);
    await purgeFileResourceViews(f.root, header.id);
    await f.artifacts.collectGarbage({ maxPaths: 100 });
    await assert.rejects(stat(oldPath), { code: 'ENOENT' });
    const capability = await resolveStorageRoot({ path: restored, kind: 'interactive' });
    const owner = await tryAcquireInteractiveRootOwner(capability);
    assert.ok(owner);
    const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
    const shellRuns = createSqliteShellRunStore(capability.canonicalPath);
    try {
      const service = createHostFileResourceService({
        artifacts,
        shellRuns,
        taskOutputRoot: taskOutputRoot(capability.canonicalPath),
      });
      const resolve = createHostModelFilePathResolver({
        sessionId: header.id,
        cwd: restored,
        readBoundary: async () => ({ kind: 'bypass', revision: 1 }),
        materialize: service.materialize,
      });
      const prepare = createHostFileEnvironmentPreparation({
        viewRoot: service.sessionViewRoot(header.id),
        resolve,
        restoreSessionFiles: () => service.restoreSessionFiles(header.id),
        readBoundary: async () => ({ kind: 'bypass', revision: 1 }),
        transferredFileRefs: () => service.transferredFileRefs(header.id),
      });
      const importedStores = await openInteractiveExecutionStoresForWrite(owner.lease);
      const history = await importedStores.runtimeEventStore.readRuntimeEvents(header.id, 'run');
      await importedStores.sessionStore.close?.();
      assert.equal(
        JSON.stringify(history),
        oldHistory,
        'archive import preserves the actual stored history',
      );
      const notice = (await prepare(history))!;
      const file = (await service.materialize(header.id, ref))!;
      assert.notEqual(file.path, oldPath);
      assert.ok(file.path.startsWith(capability.canonicalPath));
      assert.equal(await readFile(file.path, 'utf8'), bytes);
      assert.ok(notice.text.includes(file.path));
      assert.ok(oldHistory.includes(oldPath));
    } finally {
      shellRuns.close();
      artifacts.close();
      await owner.close();
    }
  } finally {
    await sessions.close?.();
    await f.close();
    await rm(target, { recursive: true, force: true });
  }
});
