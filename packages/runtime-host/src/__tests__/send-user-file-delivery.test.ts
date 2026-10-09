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
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ATTACHMENT_BYTES } from '@maka/core/attachments';
import { applySandboxBoundaryExpansion, type ExecutionBoundary } from '@maka/core/sandbox-boundary';
import { buildSendUserFileTool } from '@maka/runtime/send-user-file-tool';
import {
  FilesystemWorkerClient,
  createFilesystemWorkerLaunchSpecProvider,
} from '@maka/runtime/filesystem-worker';
import { createDefaultSandboxManager, sandboxErrorMetadata } from '@maka/runtime/sandbox';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { createHostExecutionArtifactServices } from '../server/execution-artifacts.js';
import { SessionAdmissionGate } from '../server/session-admission-gate.js';

async function fixture(
  run: (f: {
    cwd: string;
    outside: string;
    store: Awaited<ReturnType<typeof openInteractiveArtifactStoreForWrite>>;
    deliver: (
      files: string[],
      options?: {
        sessionId?: string;
        boundary?: ExecutionBoundary;
        worker?: FilesystemWorkerClient;
      },
    ) => ReturnType<ReturnType<typeof buildSendUserFileTool>['impl']>;
    drains: () => number;
  }) => Promise<void>,
) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'maka-file-delivery-')));
  const cwd = join(base, 'workspace');
  const outside = join(base, 'outside');
  await mkdir(cwd);
  await mkdir(outside);
  const owner = await tryAcquireInteractiveRootOwner(
    await resolveStorageRoot({ path: join(base, 'data'), kind: 'interactive' }),
  );
  assert.ok(owner);
  const store = await openInteractiveArtifactStoreForWrite(owner.lease);
  let drains = 0;
  const services = createHostExecutionArtifactServices({
    artifacts: store,
    sessionAdmission: new SessionAdmissionGate(),
    sessions: { probeSessionRemoval: async () => ({ kind: 'present' }) },
    requestDrain: () => {
      drains += 1;
    },
  });
  try {
    await run({
      cwd,
      outside,
      store,
      drains: () => drains,
      deliver: async (files, options = {}) => {
        const sessionId = options.sessionId ?? 'delivery';
        const tool = buildSendUserFileTool(
          options.worker ? { filesystemWorker: options.worker } : {},
        );
        return tool.impl(
          { files, status: 'normal' },
          {
            sessionId,
            turnId: 'turn-1',
            cwd,
            toolCallId: 'deliver-1',
            ...(options.boundary ? { executionBoundary: options.boundary } : {}),
            abortSignal: new AbortController().signal,
            emitOutput() {},
            recordArtifacts: (candidates) =>
              services.recordToolArtifacts({
                sessionId,
                turnId: 'turn-1',
                toolUseId: 'deliver-1',
                toolName: 'SendUserFile',
                cwd,
                args: { files, status: 'normal' },
                result: undefined,
                candidates: [...candidates],
              }),
          },
        );
      },
    });
  } finally {
    store.close();
    await owner.close();
    await rm(base, { recursive: true, force: true });
  }
}

const bypass: ExecutionBoundary = { kind: 'bypass', revision: 0 };

test('Full Access delivers outside files and same basenames in exact input order', async () => {
  await fixture(async ({ cwd, outside, store, deliver, drains }) => {
    const external = join(outside, 'report.bin');
    const internal = join(cwd, 'report.bin');
    const binary = Buffer.from([0, 255, 128, 13, 10, 0]);
    await writeFile(external, binary);
    await writeFile(internal, 'inside');
    const delivered = await deliver([external, internal], { boundary: bypass });
    assert.equal(delivered.kind, 'user_file_delivery');
    assert.deepEqual(
      delivered.files.map((file) => file.path),
      [external, internal],
    );
    assert.notEqual(delivered.files[0]!.artifactId, delivered.files[1]!.artifactId);
    // Delivery owns its bytes; deleting the original must not break the attachment.
    await rm(external);
    const first = await store.readChunkInSession('delivery', delivered.files[0]!.artifactId, {
      offset: 0,
      maxBytes: binary.length,
    });
    assert.ok(first.ok);
    assert.deepEqual(Buffer.from(first.bytes), binary);
    assert.deepEqual(await store.readTextInSession('delivery', delivered.files[1]!.artifactId), {
      ok: true,
      text: 'inside',
    });
    const copied = await store.copyConversationArtifacts({
      sourceSessionId: 'delivery',
      targetSessionId: 'copy',
      turnIds: ['turn-1'],
    });
    assert.equal(copied.artifactIds.size, 2);
    await store.purgeSessionArtifacts('delivery');
    const independent = await store.readChunkInSession(
      'copy',
      copied.artifactIds.get(delivered.files[0]!.artifactId)!,
      {
        offset: 0,
        maxBytes: binary.length,
      },
    );
    assert.ok(independent.ok);
    assert.deepEqual(Buffer.from(independent.bytes), binary);
    assert.equal(drains(), 0);
  });
});

test('a denied path or symlink escape publishes none of the batch', async () => {
  await fixture(async ({ cwd, outside, store, deliver, drains }) => {
    const external = join(outside, 'report.txt');
    await writeFile(external, 'outside');
    await writeFile(join(cwd, 'report.txt'), 'inside');
    for (const files of [
      ['report.txt', external],
      [external, 'report.txt'],
    ]) {
      await assert.rejects(Promise.resolve(deliver(files)), /inside session cwd/);
      assert.equal((await store.listPage('delivery', { offset: 0, limit: 10 })).total, 0);
    }
    if (process.platform !== 'win32') {
      await symlink(external, join(cwd, 'escape.txt'));
      await assert.rejects(
        Promise.resolve(deliver(['report.txt', 'escape.txt'])),
        /inside session cwd/,
      );
      assert.equal((await store.listPage('delivery', { offset: 0, limit: 10 })).total, 0);
    }
    assert.equal(drains(), 0);
  });
});

test('a later oversized file rolls back the prepared files without draining the Host', async () => {
  await fixture(async ({ cwd, outside, store, deliver, drains }) => {
    await writeFile(join(cwd, 'report.txt'), 'inside');
    const huge = join(outside, 'report.txt');
    await writeFile(huge, '');
    await truncate(huge, MAX_ATTACHMENT_BYTES + 1);
    for (const files of [
      ['report.txt', huge],
      [huge, 'report.txt'],
    ]) {
      await assert.rejects(
        Promise.resolve(deliver(files, { boundary: bypass })),
        /exceeds.*size limit/,
      );
      assert.equal((await store.listPage('delivery', { offset: 0, limit: 10 })).total, 0);
    }
    assert.equal(drains(), 0);
  });
});

test('the managed worker delivers only approved outside bytes, including responses over 8 MiB', {
  skip: process.platform !== 'darwin' ? 'macOS sandbox smoke' : false,
}, async () => {
  await fixture(async ({ cwd, outside, store, deliver, drains }) => {
    const allowed = join(outside, 'allowed.bin');
    const sibling = join(outside, 'sibling.bin');
    // The base64 reply exceeds the old worker-wide 8 MiB response limit.
    const bytes = Buffer.alloc(7 * 1024 * 1024, 0x81);
    await writeFile(allowed, bytes);
    await writeFile(sibling, 'not allowed');
    let boundary: ExecutionBoundary = {
      kind: 'managed',
      revision: 0,
      profile: {
        type: 'managed',
        name: 'delivery-test',
        fileSystem: {
          kind: 'restricted',
          entries: [{ kind: 'path', path: cwd, access: 'read' }],
        },
        network: { kind: 'restricted' },
      },
    };
    const worker = new FilesystemWorkerClient({
      sandboxManager: createDefaultSandboxManager(),
      platform: 'darwin',
      getLaunchSpec: createFilesystemWorkerLaunchSpecProvider({
        runtime: 'node',
        resourceLocation: { kind: 'runtime' },
      }),
    });
    await assert.rejects(
      Promise.resolve(deliver([allowed], { boundary, worker })),
      (error: unknown) => {
        const metadata = sandboxErrorMetadata(error);
        assert.equal(metadata?.reason, 'sandbox_boundary_required');
        assert.ok(metadata?.requiredExpansion);
        assert.ok(boundary.kind === 'managed');
        boundary = {
          kind: 'managed',
          revision: 1,
          profile: applySandboxBoundaryExpansion(boundary.profile, metadata.requiredExpansion),
        };
        return true;
      },
    );
    const result = await deliver([allowed], { boundary, worker });
    const read = await store.readChunkInSession('delivery', result.files[0]!.artifactId, {
      offset: 0,
      maxBytes: bytes.length,
    });
    assert.ok(read.ok);
    assert.deepEqual(Buffer.from(read.bytes), bytes);
    await assert.rejects(
      Promise.resolve(deliver([sibling], { sessionId: 'sibling', boundary, worker })),
      (error: unknown) => sandboxErrorMetadata(error)?.reason === 'sandbox_boundary_required',
    );
    assert.equal((await store.listPage('sibling', { offset: 0, limit: 10 })).total, 0);
    assert.equal(drains(), 0);
  });
});
