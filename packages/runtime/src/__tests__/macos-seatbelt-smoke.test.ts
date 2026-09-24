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
import { after, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';

import { applySandboxBoundaryExpansion } from '@maka/core/sandbox-boundary';

import {
  createWorkspaceWritePermissionProfile,
  type PermissionProfile,
} from '@maka/core/permission-profile';

import { MACOS_SEATBELT_EXECUTABLE, MacosSeatbeltBackend } from '../sandbox/macos-seatbelt.js';
import { SandboxManager } from '../sandbox/sandbox-manager.js';
import { buildBuiltinTools } from '../builtin-tools.js';

const canRunSeatbelt = process.platform === 'darwin' && existsSync(MACOS_SEATBELT_EXECUTABLE);

async function makeWorkspace(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'maka-seatbelt-workspace-')));
}

function profileWithDeniedChild(workspaceRoot: string): PermissionProfile {
  return {
    type: 'managed',
    name: 'custom',
    fileSystem: {
      kind: 'restricted',
      entries: [
        {
          kind: 'special',
          access: 'write',
          special: ':workspace_roots',
        },
        {
          kind: 'path',
          access: 'deny',
          path: join(workspaceRoot, 'secret'),
        },
      ],
    },
    network: { kind: 'restricted' },
  };
}

function workspaceOnlyProfile(): PermissionProfile {
  const profile = createWorkspaceWritePermissionProfile();
  return {
    ...profile,
    fileSystem: {
      ...profile.fileSystem,
      entries: profile.fileSystem.entries.filter(
        (entry) => !(entry.kind === 'special' && entry.special === ':root'),
      ),
    },
    network: { kind: 'restricted' },
  };
}

function runSeatbeltCommand(
  workspaceRoot: string,
  command: string,
  profile: PermissionProfile = createWorkspaceWritePermissionProfile(),
  includeTempRoots = false,
) {
  const manager = new SandboxManager([new MacosSeatbeltBackend()]);
  const result = manager.transform({
    platform: 'darwin',
    command: {
      program: '/bin/sh',
      args: ['-c', command],
      cwd: workspaceRoot,
      profile,
      pathContext: {
        workspaceRoots: [workspaceRoot],
        ...(includeTempRoots ? { tmpdir: tmpdir(), slashTmp: '/tmp' } : {}),
      },
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');

  return spawnSync(result.exec.argv[0], result.exec.argv.slice(1), {
    cwd: result.exec.cwd,
    env: { ...process.env, ...result.exec.env },
    encoding: 'utf8',
  });
}

describe('macOS Seatbelt smoke', { skip: !canRunSeatbelt }, () => {
  const cleanup: string[] = [];

  after(async () => {
    await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
  });

  it('allows ordinary writes inside the workspace root', async () => {
    const workspaceRoot = await makeWorkspace();
    cleanup.push(workspaceRoot);

    const child = runSeatbeltCommand(workspaceRoot, 'printf ok > allowed.txt');

    assert.equal(child.status, 0, child.stderr);
    assert.equal(await readFile(join(workspaceRoot, 'allowed.txt'), 'utf8'), 'ok');
  });

  it('allows ancestor directory reads without exposing ancestor file contents', async () => {
    const ancestorRoot = await realpath(await mkdtemp(join(tmpdir(), 'maka-seatbelt-ancestors-')));
    const workspaceRoot = join(ancestorRoot, 'level-one', 'level-two');
    const ancestorFile = join(ancestorRoot, 'private.txt');
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(ancestorFile, 'private');
    cleanup.push(ancestorRoot);

    // A profile that reads only the workspace: the built-in ones read the
    // whole disk, where there is no ancestor left to protect.
    const listAncestor = runSeatbeltCommand(workspaceRoot, '/bin/ls ..', workspaceOnlyProfile());
    assert.equal(listAncestor.status, 0, listAncestor.stderr);

    const readAncestorFile = runSeatbeltCommand(
      workspaceRoot,
      `/bin/cat ${JSON.stringify(ancestorFile)}`,
      workspaceOnlyProfile(),
    );
    assert.notEqual(readAncestorFile.status, 0);
    assert.match(readAncestorFile.stderr, /Operation not permitted/);
  });

  it('lets the built-in Manual profile read outside the workspace but not write there', async () => {
    const workspaceRoot = await makeWorkspace();
    const outsideRoot = await realpath(await mkdtemp(join(homedir(), '.maka-seatbelt-read-')));
    cleanup.push(workspaceRoot, outsideRoot);
    const outsideFile = join(outsideRoot, 'readable.txt');
    await writeFile(outsideFile, 'readable outside');

    const read = runSeatbeltCommand(workspaceRoot, `/bin/cat ${JSON.stringify(outsideFile)}`);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout, 'readable outside');

    const write = runSeatbeltCommand(
      workspaceRoot,
      `printf nope > ${JSON.stringify(join(outsideRoot, 'denied.txt'))}`,
    );
    assert.notEqual(write.status, 0);
  });

  it('lets Bash create inside a directory approved before it existed', async () => {
    const workspace = await makeWorkspace();
    const outsideRoot = await realpath(await mkdtemp(join(homedir(), '.maka-seatbelt-new-')));
    cleanup.push(workspace, outsideRoot);
    const approved = join(outsideRoot, 'approved-new');
    const bash = buildBuiltinTools({
      sandboxManager: new SandboxManager([new MacosSeatbeltBackend()]),
      sandboxPlatform: 'darwin',
    }).find((tool) => tool.name === 'Bash');
    assert.ok(bash);
    const executionBoundary = {
      kind: 'managed' as const,
      revision: 1,
      profile: applySandboxBoundaryExpansion(createWorkspaceWritePermissionProfile(), {
        filesystem: { entries: [{ path: approved, access: 'write', scope: 'subtree' }] },
      }),
    };
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      cwd: workspace,
      permissionMode: 'ask' as const,
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
      executionBoundary,
    };

    await bash.impl(
      {
        command: `mkdir -p ${JSON.stringify(join(approved, 'x'))} && printf ok > ${JSON.stringify(join(approved, 'x', 'f.txt'))}`,
        boundary_intent: 'current',
      } as never,
      context,
    );
    assert.equal(await readFile(join(approved, 'x', 'f.txt'), 'utf8'), 'ok');
    // The grant is that directory, not its parent.
    await assert.rejects(
      Promise.resolve(
        bash.impl(
          {
            command: `printf no > ${JSON.stringify(join(outsideRoot, 'sibling.txt'))}`,
            boundary_intent: 'current',
          } as never,
          context,
        ),
      ),
    );
  });

  it('allows temp writes when workspace and temp roots use symlinked paths', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'maka-seatbelt-temp-workspace-'));
    const slashTmpFile = join('/tmp', `maka-seatbelt-slash-tmp-${process.pid}-${Date.now()}`);
    cleanup.push(workspaceRoot, slashTmpFile);

    const child = runSeatbeltCommand(
      workspaceRoot,
      `created=$(/usr/bin/mktemp -d "$TMPDIR/maka-seatbelt.XXXXXX") && /usr/bin/touch ${JSON.stringify(slashTmpFile)} && /bin/rm -rf "$created" ${JSON.stringify(slashTmpFile)}`,
      createWorkspaceWritePermissionProfile(),
      true,
    );

    assert.equal(child.status, 0, child.stderr);
  });

  it('denies writes outside the workspace root', async () => {
    const workspaceRoot = await makeWorkspace();
    const outsideRoot = await realpath(await mkdtemp(join(tmpdir(), 'maka-seatbelt-outside-')));
    cleanup.push(workspaceRoot, outsideRoot);
    const outsideFile = resolve(outsideRoot, 'denied.txt');

    const child = runSeatbeltCommand(workspaceRoot, `printf nope > ${JSON.stringify(outsideFile)}`);

    assert.notEqual(child.status, 0);
  });

  it('allows only the exact outside path in the expanded session boundary', async () => {
    const workspaceRoot = await makeWorkspace();
    const outsideRoot = await realpath(await mkdtemp(join(tmpdir(), 'maka-seatbelt-additional-')));
    cleanup.push(workspaceRoot, outsideRoot);
    const allowedFile = resolve(outsideRoot, 'allowed.txt');
    const siblingFile = resolve(outsideRoot, 'sibling.txt');
    const expandedProfile = applySandboxBoundaryExpansion(createWorkspaceWritePermissionProfile(), {
      filesystem: {
        entries: [{ path: allowedFile, access: 'write', scope: 'exact' }],
      },
    });

    const allowed = runSeatbeltCommand(
      workspaceRoot,
      `printf ok > ${JSON.stringify(allowedFile)}`,
      expandedProfile,
    );
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(await readFile(allowedFile, 'utf8'), 'ok');

    const sibling = runSeatbeltCommand(
      workspaceRoot,
      `printf nope > ${JSON.stringify(siblingFile)}`,
      expandedProfile,
    );
    assert.notEqual(sibling.status, 0);
    assert.equal(existsSync(siblingFile), false);
  });

  it('allows workspace metadata writes in the standard managed boundary', async () => {
    const workspaceRoot = await makeWorkspace();
    cleanup.push(workspaceRoot);

    const child = runSeatbeltCommand(workspaceRoot, 'mkdir .codex');

    assert.equal(child.status, 0, child.stderr);
    assert.equal(existsSync(join(workspaceRoot, '.codex')), true);
  });

  it('keeps .git/config and .git/hooks read-only while git itself still works', async () => {
    const workspaceRoot = await makeWorkspace();
    cleanup.push(workspaceRoot);
    execFileSync('git', ['init', '-q', '.'], { cwd: workspaceRoot });
    const before = await readFile(join(workspaceRoot, '.git', 'config'), 'utf8');

    const commit = runSeatbeltCommand(
      workspaceRoot,
      'git -c user.name=t -c user.email=t@t commit -q --allow-empty -m first && git log --oneline | wc -l',
    );
    assert.equal(commit.status, 0, commit.stderr);
    assert.match(commit.stdout, /1/);

    const config = runSeatbeltCommand(
      workspaceRoot,
      'printf "[core]\n\tfsmonitor = evil\n" >> .git/config',
    );
    assert.notEqual(config.status, 0);
    assert.equal(await readFile(join(workspaceRoot, '.git', 'config'), 'utf8'), before);

    const hook = runSeatbeltCommand(workspaceRoot, 'printf "#!/bin/sh\n" > .git/hooks/pre-commit');
    assert.notEqual(hook.status, 0);
    assert.equal(existsSync(join(workspaceRoot, '.git', 'hooks', 'pre-commit')), false);

    // Nor can the repository be moved aside for a fresh one to take its place.
    const moved = runSeatbeltCommand(workspaceRoot, 'mv .git .git.old');
    assert.notEqual(moved.status, 0);
    assert.equal(existsSync(join(workspaceRoot, '.git', 'config')), true);
  });

  it('denies writes to explicit denied children under a writable workspace root', async () => {
    const workspaceRoot = await makeWorkspace();
    cleanup.push(workspaceRoot);

    const child = runSeatbeltCommand(
      workspaceRoot,
      'mkdir -p secret && printf denied > secret/file.txt',
      profileWithDeniedChild(workspaceRoot),
    );

    assert.notEqual(child.status, 0);
  });

  it('denies direct network access under restricted network policy', async () => {
    const workspaceRoot = await makeWorkspace();
    cleanup.push(workspaceRoot);

    const child = runSeatbeltCommand(
      workspaceRoot,
      '/usr/bin/python3 -c "import socket; socket.create_connection((\\"127.0.0.1\\", 9), 0.2)"',
    );

    assert.notEqual(child.status, 0);
  });

  it('runs the Command Line Tools shims and python3 from a sandboxed Bash', {
    skip: !existsSync('/Library/Developer/CommandLineTools/usr/lib/libxcrun.dylib'),
  }, async () => {
    // /usr/bin/git, python3, make and clang are xcrun shims that load
    // libxcrun from the Command Line Tools, and git reads ~/.gitconfig
    // before anything else; both were outside the sandbox, so every one
    // of them failed under the ask boundary.
    const workspace = await makeWorkspace();
    cleanup.push(workspace);
    const bash = buildBuiltinTools({
      permissionProfile: createWorkspaceWritePermissionProfile(),
      sandboxManager: new SandboxManager([new MacosSeatbeltBackend()]),
      sandboxPlatform: 'darwin',
    }).find((tool) => tool.name === 'Bash');
    assert.ok(bash);
    const result = await bash.impl(
      {
        command: 'git init -q . && git status --short && /usr/bin/python3 -c "print(6 * 7)"',
        boundary_intent: 'current',
      } as never,
      {
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        cwd: workspace,
        permissionMode: 'ask',
        abortSignal: new AbortController().signal,
        emitOutput: () => {},
      },
    );
    assert.match(JSON.stringify(result), /42/);
  });

  it('can ask where it is when launched from outside its only granted root', async () => {
    // The filesystem worker is granted one target and launched from the
    // session cwd. Seatbelt denies getcwd() in a directory the profile does
    // not cover, and Node's fs.glob calls getcwd() even when it is handed an
    // absolute cwd — so Glob outside the session cwd failed. The test
    // runner's own directory stands in for that session cwd: it is nowhere
    // in this profile.
    const target = await makeWorkspace();
    cleanup.push(target);
    const manager = new SandboxManager([new MacosSeatbeltBackend()]);
    const result = manager.transform({
      platform: 'darwin',
      command: {
        program: '/bin/pwd',
        args: ['-P'],
        cwd: resolve(process.cwd()),
        profile: {
          type: 'managed',
          name: 'custom',
          fileSystem: {
            kind: 'restricted',
            entries: [{ kind: 'path', access: 'read', path: target, match: 'subtree' }],
          },
          network: { kind: 'restricted' },
        },
        pathContext: { workspaceRoots: [] },
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const child = spawnSync(result.exec.argv[0], result.exec.argv.slice(1), {
      cwd: result.exec.cwd,
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), '/');
  });
});
