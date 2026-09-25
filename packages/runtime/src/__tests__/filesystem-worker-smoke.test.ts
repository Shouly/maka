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
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { applySandboxBoundaryExpansion, type ExecutionBoundary } from '@maka/core/sandbox-boundary';

import {
  createReadOnlyPermissionProfile,
  createWorkspaceWritePermissionProfile,
} from '@maka/core/permission-profile';

import {
  FilesystemWorkerClient,
  FilesystemWorkerClientError,
} from '../filesystem-worker/client.js';
import { createFilesystemWorkerLaunchSpecProvider } from '../filesystem-worker/launch-spec.js';
import { createDefaultSandboxManager } from '../sandbox/default-sandbox-manager.js';

describe('macOS filesystem worker smoke', { skip: process.platform !== 'darwin' }, () => {
  let workspace: string;
  let outside: string;
  let client: FilesystemWorkerClient;

  before(async () => {
    workspace = await realpath(await mkdtemp(join(tmpdir(), 'maka-worker-smoke-workspace-')));
    outside = await realpath(await mkdtemp(join(homedir(), '.maka-worker-smoke-outside-')));
    client = new FilesystemWorkerClient({
      sandboxManager: createDefaultSandboxManager(),
      platform: 'darwin',
      getLaunchSpec: createFilesystemWorkerLaunchSpecProvider({
        runtime: 'node',
        resourceLocation: { kind: 'runtime' },
      }),
    });
  });

  after(async () => {
    await Promise.all([
      rm(workspace, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });

  test('allows workspace writes and fails closed for unapproved outside paths', async () => {
    const insidePath = join(workspace, 'inside.txt');
    const outsidePath = join(outside, 'blocked.txt');
    await client.execute({
      operation: { kind: 'write', path: insidePath, content: 'inside-ok' },
      cwd: workspace,
      mode: 'ask',
      expectedIdentity: 'unchecked',
    });
    assert.equal(await readFile(insidePath, 'utf8'), 'inside-ok');

    await assert.rejects(
      client.execute({
        operation: { kind: 'write', path: outsidePath, content: 'blocked' },
        cwd: workspace,
        mode: 'ask',
        expectedIdentity: 'unchecked',
      }),
      (error: unknown) =>
        error instanceof FilesystemWorkerClientError && error.reason === 'path_denied',
    );
  });

  test('creates a nested patch file inside the workspace', async () => {
    const target = join(workspace, 'nested', 'created.txt');

    await client.execute({
      operation: {
        kind: 'apply_patch',
        path: target,
        action: 'create',
        diff: '+created\n',
      },
      cwd: workspace,
      mode: 'ask',
      expectedIdentity: 'unchecked',
    });

    assert.equal(await readFile(target, 'utf8'), 'created');
  });

  test('deletes an entry through the absolute macOS path alias', async () => {
    const target = join(workspace, 'aliased.txt');
    const aliasedTarget = target.replace(/^\/private(?=\/)/, '');
    assert.notEqual(aliasedTarget, target);
    await writeFile(target, 'delete me', 'utf8');
    // Capture the identity at T0 (the boundary executor does this in production).
    const { lstat } = await import('node:fs/promises');
    const meta = await lstat(target, { bigint: true });
    const expectedIdentity = { dev: String(meta.dev), ino: String(meta.ino) };

    await client.execute({
      operation: { kind: 'apply_patch', path: aliasedTarget, action: 'delete' },
      cwd: workspace,
      mode: 'ask',
      expectedIdentity,
    });

    await assert.rejects(readFile(target, 'utf8'), { code: 'ENOENT' });
  });

  test('applies one exact boundary expansion without opening a sibling path', async () => {
    const allowedPath = join(outside, 'allowed.txt');
    const siblingPath = join(outside, 'sibling.txt');
    const executionBoundary = boundaryFor(allowedPath);
    await assert.rejects(
      client.execute({
        operation: { kind: 'write', path: siblingPath, content: 'blocked' },
        cwd: workspace,
        mode: 'ask',
        executionBoundary,
        expectedIdentity: 'unchecked',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FilesystemWorkerClientError);
        assert.equal(error.reason, 'sandbox_boundary_required');
        assert.deepEqual(error.requiredExpansion, {
          filesystem: {
            entries: [{ path: siblingPath, access: 'write', scope: 'exact' }],
          },
        });
        return true;
      },
    );
    await client.execute({
      operation: { kind: 'write', path: allowedPath, content: 'outside-ok' },
      cwd: workspace,
      mode: 'ask',
      executionBoundary,
      expectedIdentity: 'unchecked',
    });
    assert.equal(await readFile(allowedPath, 'utf8'), 'outside-ok');
  });

  test('runs file and directory Grep inside the operation-scoped sandbox', async () => {
    const sourceDirectory = join(workspace, 'src');
    const sourceFile = join(sourceDirectory, 'health.ts');
    await mkdir(sourceDirectory);
    await writeFile(sourceFile, 'export const healthSignal = true;\n', 'utf8');

    const fileResult = await client.execute({
      operation: grepOperation(sourceFile, 'healthSignal'),
      cwd: workspace,
      mode: 'ask',
      expectedIdentity: 'unchecked',
    });
    assert.equal(fileResult.kind, 'grep');
    if (fileResult.kind === 'grep') {
      assert.equal(fileResult.matches.length, 1);
      assert.match(fileResult.matches[0] ?? '', /healthSignal/);
    }

    const directoryResult = await client.execute({
      operation: grepOperation(sourceDirectory, 'healthSignal'),
      cwd: workspace,
      mode: 'ask',
      expectedIdentity: 'unchecked',
    });
    assert.equal(directoryResult.kind, 'grep');
    if (directoryResult.kind === 'grep') {
      assert.equal(directoryResult.matches.length, 1);
      assert.match(directoryResult.matches[0] ?? '', /healthSignal/);
    }

    const emptyResult = await client.execute({
      operation: grepOperation(sourceDirectory, 'does-not-exist'),
      cwd: workspace,
      mode: 'ask',
      expectedIdentity: 'unchecked',
    });
    assert.deepEqual(emptyResult, { kind: 'grep', matches: [], mode: 'content' });
  });

  test('Write creates missing directories wherever the session may write', async () => {
    // A grant for the file alone let the worker create nothing above it, so
    // a Write into a new directory failed even inside the workspace.
    const inside = join(workspace, 'new-dir', 'deeper', 'inside.txt');
    await client.execute({
      operation: { kind: 'write', path: inside, content: 'inside' },
      cwd: workspace,
      mode: 'ask',
      executionBoundary: {
        kind: 'managed',
        revision: 0,
        profile: createWorkspaceWritePermissionProfile(),
      },
      expectedIdentity: 'unchecked',
    });
    assert.equal(await readFile(inside, 'utf8'), 'inside');

    // Outside, the ask is the topmost missing directory — not its parent,
    // which here is the whole home directory — and once it is approved the
    // same Write goes through.
    const outsideTarget = join(outside, 'created', 'deeper', 'outside.txt');
    let executionBoundary: ExecutionBoundary = {
      kind: 'managed',
      revision: 0,
      profile: createWorkspaceWritePermissionProfile(),
    };
    await assert.rejects(
      client.execute({
        operation: { kind: 'write', path: outsideTarget, content: 'outside' },
        cwd: workspace,
        mode: 'ask',
        executionBoundary,
        expectedIdentity: 'unchecked',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FilesystemWorkerClientError);
        assert.equal(error.reason, 'sandbox_boundary_required');
        assert.deepEqual(error.requiredExpansion, {
          filesystem: {
            entries: [{ path: join(outside, 'created'), access: 'write', scope: 'subtree' }],
          },
        });
        // The model only has the sentence to go on, so it names that grant.
        assert.equal(
          error.message,
          `Writing ${outsideTarget} is outside the session sandbox. Call RequestSandboxBoundary ` +
            `for write access to ${join(outside, 'created')} (scope subtree), then repeat this call unchanged.`,
        );
        if (executionBoundary.kind === 'managed' && error.requiredExpansion)
          executionBoundary = {
            kind: 'managed',
            revision: 1,
            profile: applySandboxBoundaryExpansion(
              executionBoundary.profile,
              error.requiredExpansion,
            ),
          };
        return true;
      },
    );
    await client.execute({
      operation: { kind: 'write', path: outsideTarget, content: 'outside' },
      cwd: workspace,
      mode: 'ask',
      executionBoundary,
      expectedIdentity: 'unchecked',
    });
    assert.equal(await readFile(outsideTarget, 'utf8'), 'outside');
  });

  test('a Write whose target is a directory names it as one', async () => {
    const folder = join(workspace, 'a-folder');
    await mkdir(folder);
    await assert.rejects(
      client.execute({
        operation: { kind: 'write', path: folder, content: 'x' },
        cwd: workspace,
        mode: 'ask',
        executionBoundary: {
          kind: 'managed',
          revision: 0,
          profile: createWorkspaceWritePermissionProfile(),
        },
        expectedIdentity: 'unchecked',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /EISDIR/);
        return true;
      },
    );
  });

  test('a Write to .git/config asks for a grant, and an exact grant is enough', async () => {
    const repo = join(workspace, 'repo');
    await mkdir(join(repo, '.git', 'hooks'), { recursive: true });
    await writeFile(join(repo, '.git', 'config'), '[core]\n', 'utf8');
    const configPath = join(repo, '.git', 'config');
    const manual = {
      kind: 'managed' as const,
      revision: 0,
      profile: createWorkspaceWritePermissionProfile(),
    };
    await assert.rejects(
      client.execute({
        operation: { kind: 'write', path: configPath, content: '[core]\n\tfsmonitor = evil\n' },
        cwd: repo,
        mode: 'ask',
        executionBoundary: manual,
        expectedIdentity: 'unchecked',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FilesystemWorkerClientError);
        assert.equal(error.reason, 'sandbox_boundary_required');
        assert.deepEqual(error.requiredExpansion, {
          filesystem: { entries: [{ path: configPath, access: 'write', scope: 'exact' }] },
        });
        return true;
      },
    );
    // Other files in .git are the session's to write.
    await client.execute({
      operation: {
        kind: 'write',
        path: join(repo, '.git', 'HEAD'),
        content: 'ref: refs/heads/main\n',
      },
      cwd: repo,
      mode: 'ask',
      executionBoundary: manual,
      expectedIdentity: 'unchecked',
    });
    const granted = {
      ...manual,
      revision: 1,
      profile: applySandboxBoundaryExpansion(manual.profile, {
        filesystem: { entries: [{ path: configPath, access: 'write', scope: 'exact' }] },
      }),
    };
    await client.execute({
      operation: { kind: 'write', path: configPath, content: '[user]\n\tname = t\n' },
      cwd: repo,
      mode: 'ask',
      executionBoundary: granted,
      expectedIdentity: 'unchecked',
    });
    assert.equal(await readFile(configPath, 'utf8'), '[user]\n\tname = t\n');
  });

  test('apply_patch create into missing directories asks for the topmost one, like Write', async () => {
    // The nearest existing ancestor is `outside`, which the session cannot
    // write; the grant to ask for is the first missing directory below it,
    // and until it is approved nothing is created and no worker is launched.
    const target = join(outside, 'patched', 'deeper', 'file.txt');
    const manual = {
      kind: 'managed' as const,
      revision: 0,
      profile: createWorkspaceWritePermissionProfile(),
    };
    await assert.rejects(
      client.execute({
        operation: { kind: 'apply_patch', path: target, action: 'create', diff: '+patched\n' },
        cwd: workspace,
        mode: 'ask',
        executionBoundary: manual,
        expectedIdentity: 'missing',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FilesystemWorkerClientError);
        assert.equal(error.reason, 'sandbox_boundary_required');
        assert.deepEqual(error.requiredExpansion, {
          filesystem: {
            entries: [{ path: join(outside, 'patched'), access: 'write', scope: 'subtree' }],
          },
        });
        return true;
      },
    );
    assert.equal(existsSync(join(outside, 'patched')), false);
    const granted = {
      ...manual,
      revision: 1,
      profile: applySandboxBoundaryExpansion(manual.profile, {
        filesystem: {
          entries: [{ path: join(outside, 'patched'), access: 'write', scope: 'subtree' }],
        },
      }),
    };
    await client.execute({
      operation: { kind: 'apply_patch', path: target, action: 'create', diff: '+patched\n' },
      cwd: workspace,
      mode: 'ask',
      executionBoundary: granted,
      expectedIdentity: 'missing',
    });
    assert.equal(await readFile(target, 'utf8'), 'patched');
  });

  test('apply_patch delete of a missing file says so instead of asking for access', async () => {
    const target = join(outside, 'gone', 'file.txt');
    await assert.rejects(
      client.execute({
        operation: { kind: 'apply_patch', path: target, action: 'delete' },
        cwd: workspace,
        mode: 'ask',
        executionBoundary: {
          kind: 'managed',
          revision: 0,
          profile: createWorkspaceWritePermissionProfile(),
        },
        expectedIdentity: 'missing',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FilesystemWorkerClientError);
        assert.equal(error.reason, 'invalid_operation');
        assert.match(error.message, /^File does not exist\./);
        return true;
      },
    );
    assert.equal(existsSync(join(outside, 'gone')), false);
  });

  test('a Write under Read only is refused without pointing at the request tool', async () => {
    const target = join(workspace, 'read-only.txt');
    await assert.rejects(
      client.execute({
        operation: { kind: 'write', path: target, content: 'no' },
        cwd: workspace,
        mode: 'explore',
        executionBoundary: {
          kind: 'managed',
          revision: 0,
          profile: createReadOnlyPermissionProfile(),
        },
        expectedIdentity: 'missing',
      }),
      (error: unknown) => {
        assert.ok(error instanceof FilesystemWorkerClientError);
        assert.equal(error.reason, 'sandbox_boundary_required');
        assert.match(error.message, /Read only, so writing cannot be requested/);
        assert.doesNotMatch(error.message, /RequestSandboxBoundary/);
        return true;
      },
    );
    assert.equal(existsSync(target), false);
  });

  test('Edit of a missing file says so instead of asking for access', async () => {
    // A grant for a file that is not there unblocks nothing; the model
    // approved one and hit the same wall again.
    await assert.rejects(
      client.execute({
        operation: {
          kind: 'edit',
          path: join(outside, 'absent', 'edit-me.txt'),
          oldString: 'a',
          newString: 'b',
        },
        cwd: workspace,
        mode: 'ask',
        executionBoundary: {
          kind: 'managed',
          revision: 0,
          profile: createWorkspaceWritePermissionProfile(),
        },
        expectedIdentity: 'unchecked',
      }),
      {
        message: `File does not exist. Note: your current working directory is ${workspace}.`,
      },
    );
  });

  test('globs an approved root outside the session cwd', async () => {
    // The worker is granted `outside` and nothing else, so the session cwd
    // it would start in is unreadable to it, and Node's glob asks for the
    // process cwd before it looks at anything.
    const searchRoot = join(outside, 'glob');
    await mkdir(searchRoot);
    // Only ripgrep lists the dotfile and leaves out the upper-case name, so
    // this also proves the sandboxed worker ran ripgrep, not the fallback.
    for (const [name, time] of [
      ['found.md', 1_000],
      ['.hidden.md', 2_000],
      ['UPPER.MD', 3_000],
    ] as const) {
      await writeFile(join(searchRoot, name), `${name}\n`, 'utf8');
      await utimes(join(searchRoot, name), new Date(time), new Date(time));
    }

    const result = await client.execute({
      operation: { kind: 'glob', path: searchRoot, pattern: '*.md' },
      cwd: workspace,
      mode: 'ask',
      executionBoundary: {
        kind: 'managed',
        revision: 1,
        profile: applySandboxBoundaryExpansion(createWorkspaceWritePermissionProfile(), {
          filesystem: { entries: [{ path: searchRoot, access: 'read', scope: 'subtree' }] },
        }),
      },
      expectedIdentity: 'unchecked',
    });

    assert.deepEqual(result, { kind: 'glob', files: ['found.md', '.hidden.md'], total: 2 });
  });
});

function grepOperation(path: string, pattern: string) {
  return {
    kind: 'grep' as const,
    path,
    pattern,
    limit: 200,
    timeoutMs: 10_000,
  };
}

function boundaryFor(path: string): ExecutionBoundary {
  return {
    kind: 'managed',
    revision: 1,
    profile: applySandboxBoundaryExpansion(createWorkspaceWritePermissionProfile(), {
      filesystem: { entries: [{ path, access: 'write', scope: 'exact' }] },
    }),
  };
}
