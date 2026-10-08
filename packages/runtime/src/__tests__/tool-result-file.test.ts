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
import fsPromises from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { canReadPath, canWritePath } from '@maka/core/permission-profile';
import { compilePermissionProfile } from '@maka/core/permission-profile-compiler';
import type { PermissionMode } from '@maka/core/permission';
import { buildBuiltinTools } from '../builtin-tools.js';
import { ShellOutputSpool } from '../shell-output-spool.js';
import {
  linkSavedOutputFile,
  newToolResultFileName,
  purgeSavedOutputFolder,
  purgeSessionToolResultFiles,
  removeWorkingFilesOlderThan,
  STALE_WORKING_FILE_MS,
  saveToolResultText,
  sliceAtCharacter,
  sliceEndAtCharacter,
  sweepStaleWorkingFiles,
  toolResultFilePath,
  toolResultRoot,
  toolResultSaveTicket,
  truncateUtf8,
  writeToolResultFile,
} from '../tool-result-file.js';

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe('a saved tool result', () => {
  test('lives in its Session folder, under a name of its own', () => {
    assert.equal(
      toolResultFilePath('/tmp/maka/tool-results', 'session-1', 'call_1'),
      '/tmp/maka/tool-results/session-1/call_1.txt',
    );
    // Never the call id, which a provider may use twice.
    const first = newToolResultFileName();
    assert.match(first, /^[0-9a-f-]{36}$/u);
    assert.notEqual(newToolResultFileName(), first);
    assert.throws(() => toolResultFilePath('/tmp/r', '../other', 'x'), /Unsafe Session id/u);
    assert.throws(() => toolResultFilePath('/tmp/r', 's', 'a/b'), /Unsafe file name/u);
  });

  test('is cut at a character boundary when it is too long', () => {
    assert.equal(truncateUtf8('abc', 10), 'abc');
    assert.equal(truncateUtf8('ab漢字', 4), 'ab');
    assert.equal(truncateUtf8('ab漢字', 5), 'ab漢');
    assert.equal(truncateUtf8('🦊🦊', 7), '🦊');
    assert.equal(sliceAtCharacter('a🦊', 2), 'a');
    assert.equal(sliceAtCharacter('a🦊', 3), 'a🦊');
    // Text that itself ends in half a pair loses that half too.
    assert.equal(sliceAtCharacter('a\uD83E', 10), 'a');
    assert.equal(sliceEndAtCharacter('🦊a', 2), 'a');
    assert.equal(sliceEndAtCharacter('\uDD8Aa', 10), 'a');
  });

  test('is private to the user: its folder 0700 and the file 0600', {
    skip: process.platform === 'win32' ? 'POSIX modes' : false,
  }, async () => {
    const root = await directory('maka-tool-results-mode-');
    const path = toolResultFilePath(join(root, 'tool-results'), 'session-1', 'call-1');
    await saveToolResultText(path, 'secret-ish');
    assert.equal((await stat(join(root, 'tool-results'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, 'tool-results', 'session-1'))).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });

  test('never writes through a file that is already there', async () => {
    const root = await directory('maka-tool-results-exists-');
    const path = toolResultFilePath(root, 'session-1', 'call-1');
    await saveToolResultText(path, 'first');
    await assert.rejects(saveToolResultText(path, 'second'), /EEXIST/u);
    assert.equal(await readFile(path, 'utf8'), 'first');
  });

  test('a write that fails leaves no file, and no folder it made', async () => {
    const root = await directory('maka-tool-results-fail-');
    const path = toolResultFilePath(root, 'session-1', 'call-1');
    await assert.rejects(
      writeToolResultFile(path, async (handle) => {
        await handle.write('half of it');
        throw new Error('disk full');
      }),
      /disk full/u,
    );
    assert.deepEqual(await readdir(root), []);
    // A folder that was there before stays.
    await mkdir(join(root, 'session-2'));
    await saveToolResultText(toolResultFilePath(root, 'session-2', 'kept'), 'kept');
    await assert.rejects(
      writeToolResultFile(toolResultFilePath(root, 'session-2', 'call-1'), async () => {
        throw new Error('disk full');
      }),
    );
    assert.deepEqual(await readdir(join(root, 'session-2')), ['kept.txt']);
  });

  test('a retired Session gets no folder back from a save that comes late', async () => {
    const root = await directory('maka-tool-results-retired-');
    // The tool started before the Session was retired.
    const ticket = toolResultSaveTicket();
    await purgeSessionToolResultFiles(root, 'session-1');
    await assert.rejects(
      saveToolResultText(toolResultFilePath(root, 'session-1', 'call-1'), 'late', ticket),
      /retired/u,
    );
    // A save already writing when the purge ran removes what it wrote.
    await assert.rejects(
      writeToolResultFile(toolResultFilePath(root, 'session-2', 'call-1'), async (handle) => {
        await purgeSessionToolResultFiles(root, 'session-2');
        await handle.write('written after the purge');
      }),
      /retired/u,
    );
    assert.deepEqual(await readdir(root), []);
  });

  test('a Session that takes a retired id again saves as any other', async () => {
    const root = await directory('maka-tool-results-reused-');
    // The WorkHub coordination Session's id is fixed.
    const sessionId = 'maka_workhub_coordination';
    const before = toolResultSaveTicket();
    await purgeSessionToolResultFiles(root, sessionId);
    await assert.rejects(
      saveToolResultText(toolResultFilePath(root, sessionId, 'old-call'), 'late', before),
      /retired/u,
    );
    // A tool of the Session made again after the purge.
    const saved = await saveToolResultText(
      toolResultFilePath(root, sessionId, 'new-call'),
      'kept',
      toolResultSaveTicket(),
    );
    assert.equal(await readFile(saved.path, 'utf8'), 'kept');
    // Saving without a ticket counts from the save itself.
    await saveToolResultText(toolResultFilePath(root, sessionId, 'other-call'), 'kept too');
    // A run started before the purge, through the spool, is still refused.
    const spool = await ShellOutputSpool.open(root, 'late-run');
    spool.accept('stdout', 'late output\n');
    await purgeSessionToolResultFiles(root, sessionId);
    assert.equal(await spool.save(toolResultFilePath(root, sessionId, 'late-run'), 10), undefined);
    assert.deepEqual(await readdir(root), []);
  });

  test('remembers only the most recent 1,000 purged folders', async () => {
    const root = await directory('maka-tool-results-bounded-');
    const ticket = toolResultSaveTicket();
    await purgeSessionToolResultFiles(root, 'session-oldest');
    for (let index = 0; index < 999; index++) {
      await purgeSessionToolResultFiles(root, `session-${index}`);
    }
    await assert.rejects(
      saveToolResultText(toolResultFilePath(root, 'session-oldest', 'call'), 'x', ticket),
      /retired/u,
    );
    await assert.rejects(
      saveToolResultText(toolResultFilePath(root, 'session-998', 'call'), 'x', ticket),
      /retired/u,
    );
    await purgeSessionToolResultFiles(root, 'session-newest');
    // The oldest purge is forgotten; the memory does not grow past the bound.
    await saveToolResultText(toolResultFilePath(root, 'session-oldest', 'call'), 'x', ticket);
    await assert.rejects(
      saveToolResultText(toolResultFilePath(root, 'session-0', 'call'), 'x', ticket),
      /retired/u,
    );
  });

  test("goes with its Session, and leaves other Sessions' files alone", async () => {
    const root = await directory('maka-tool-results-purge-');
    await saveToolResultText(toolResultFilePath(root, 'session-a', 'call-1'), 'a');
    await saveToolResultText(toolResultFilePath(root, 'session-b', 'call-1'), 'b');

    await purgeSessionToolResultFiles(root, 'session-a');

    assert.deepEqual(await readdir(root), ['session-b']);
    assert.equal(await readFile(toolResultFilePath(root, 'session-b', 'call-1'), 'utf8'), 'b');
    // A Session that saved nothing purges cleanly.
    await purgeSessionToolResultFiles(root, 'session-never');
  });

  test('lives under the state root, which every mode reads and only bypass writes', async () => {
    const workspace = await realpath(await directory('maka-workspace-'));
    // Where a desktop keeps its state: neither the workspace nor a temp folder.
    const stateRoot = join(homedir(), 'Library', 'Application Support', 'Maka', 'workspaces', 'w');
    assert.equal(toolResultRoot(stateRoot), join(stateRoot, 'tool-results'));
    const path = toolResultFilePath(toolResultRoot(stateRoot), 'session-1', 'call-1');
    const context = {
      workspaceRoots: [workspace],
      tmpdir: await realpath(tmpdir()),
      slashTmp: await realpath('/tmp').catch(() => '/tmp'),
    };
    for (const mode of ['explore', 'ask', 'bypass'] as PermissionMode[]) {
      const { profile } = compilePermissionProfile({ mode, cwd: workspace });
      assert.equal(canReadPath(profile, path, context), true, mode);
      assert.equal(canWritePath(profile, path, context), mode === 'bypass', mode);
    }
  });

  test('is read back by Read and found by Grep from a session working elsewhere', async () => {
    const root = await directory('maka-tool-results-read-');
    const workspace = await directory('maka-workspace-');
    const saved = await saveToolResultText(
      toolResultFilePath(root, 'session-1', 'call-1'),
      'first\nneedle here\nlast',
    );
    const tools = buildBuiltinTools();
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      cwd: workspace,
      toolCallId: 'read-1',
      // Bypass reads by host path, as the sandboxed worker does for every
      // managed mode (checked above); the workspace-scoped embedding default
      // never reaches outside its cwd.
      executionBoundary: { kind: 'bypass' as const, revision: 1 },
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    };
    const read = tools.find((tool) => tool.name === 'Read')!;
    const grep = tools.find((tool) => tool.name === 'Grep')!;
    const content = (await read.impl({ file_path: saved.path }, context)) as { content: string };
    assert.equal(content.content, 'first\nneedle here\nlast');
    const found = await grep.impl(
      { pattern: 'needle', path: saved.path, output_mode: 'content' },
      { ...context, toolCallId: 'grep-1' },
    );
    assert.match(JSON.stringify(found), /needle here/u);
  });
});

describe("a saved file put into another Session's folder", () => {
  test('is the same file, hard linked, and stays when the source folder goes', async () => {
    const root = await directory('maka-tool-results-link-');
    const saved = await saveToolResultText(toolResultFilePath(root, 'source', 'call-1'), 'output');
    const target = toolResultFilePath(root, 'branch', 'call-1');

    assert.equal(await linkSavedOutputFile(saved.path, target), true);
    const [from, to] = await Promise.all([stat(saved.path), stat(target)]);
    assert.equal(to.ino, from.ino);
    assert.equal(to.nlink, 2);
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(root, 'branch'))).mode & 0o777, 0o700);
      assert.equal(to.mode & 0o777, 0o600);
    }

    await purgeSessionToolResultFiles(root, 'source');
    assert.equal(await readFile(target, 'utf8'), 'output');
  });

  test('copies every byte without hard links when a single write could be short', async (t) => {
    const root = await directory('maka-tool-results-copy-short-write-');
    const content = 'output line\n'.repeat(16_384);
    const saved = await saveToolResultText(toolResultFilePath(root, 'source', 'call-1'), content);
    const target = toolResultFilePath(root, 'branch', 'call-1');
    const originalOpen = fsPromises.open;
    let openedDestination = false;
    const link = t.mock.method(fsPromises, 'link', async () => {
      throw Object.assign(new Error('Hard links unavailable'), { code: 'ENOTSUP' });
    });
    const open = t.mock.method(
      fsPromises,
      'open',
      async (...args: Parameters<typeof originalOpen>) => {
        const handle = await originalOpen(...args);
        if (args[0] === target && args[1] === 'wx') {
          openedDestination = true;
          const write = handle.write.bind(handle);
          // The single-write API may return fewer bytes without throwing.
          // writeFile owns the write-all contract, even across stream chunks.
          t.mock.method(handle, 'write', async (bytes: Buffer) => write(bytes.subarray(0, 8)));
        }
        return handle;
      },
    );
    syncBuiltinESMExports();
    try {
      assert.equal(await linkSavedOutputFile(saved.path, target), true);
      assert.equal(openedDestination, true, 'the byte-copy fallback was exercised');
      const copied = await readFile(target);
      assert.equal(copied.byteLength, Buffer.byteLength(content));
      assert.deepEqual(copied, Buffer.from(content));
    } finally {
      open.mock.restore();
      link.mock.restore();
      syncBuiltinESMExports();
    }
  });

  test('is nothing when the source file is gone, or is not a regular file', async () => {
    const root = await directory('maka-tool-results-link-missing-');
    const gone = toolResultFilePath(root, 'source', 'gone');
    assert.equal(
      await linkSavedOutputFile(gone, toolResultFilePath(root, 'branch', 'gone')),
      false,
    );
    await mkdir(join(root, 'source', 'folder.txt'), { recursive: true });
    assert.equal(
      await linkSavedOutputFile(
        join(root, 'source', 'folder.txt'),
        toolResultFilePath(root, 'branch', 'folder'),
      ),
      false,
    );
    assert.deepEqual(await readdir(root), ['source'], 'no target folder was made');
  });

  test('is refused into a folder purged after the ticket, and leaves nothing', async () => {
    const root = await directory('maka-tool-results-link-retired-');
    const saved = await saveToolResultText(toolResultFilePath(root, 'source', 'call-1'), 'x');
    const ticket = toolResultSaveTicket();
    await purgeSavedOutputFolder(join(root, 'branch'));
    await assert.rejects(
      linkSavedOutputFile(saved.path, toolResultFilePath(root, 'branch', 'call-1'), ticket),
      /retired/u,
    );
    assert.deepEqual(await readdir(root), ['source']);
    // A ticket taken after the purge links as any other.
    assert.equal(
      await linkSavedOutputFile(saved.path, toolResultFilePath(root, 'branch', 'call-1')),
      true,
    );
  });
});

describe('working files a crashed process left behind', () => {
  async function aged(path: string, ageMs: number): Promise<void> {
    await writeFile(path, 'left behind');
    const at = new Date(Date.now() - ageMs);
    await utimes(path, at, at);
  }

  test('go when untouched for a day, and only they', async () => {
    const root = await directory('maka-tool-results-sweep-');
    await aged(join(root, 'run-old.stdout.partial'), STALE_WORKING_FILE_MS + 60_000);
    await aged(join(root, 'run-old.stderr.partial'), STALE_WORKING_FILE_MS + 60_000);
    // A command still running may be writing these.
    await aged(join(root, 'run-new.stdout.partial'), STALE_WORKING_FILE_MS - 60_000);
    // Not working files.
    await aged(join(root, 'notes.txt'), STALE_WORKING_FILE_MS + 60_000);
    await mkdir(join(root, 'session-1'));
    await aged(join(root, 'session-1', 'run-x.stdout.partial'), STALE_WORKING_FILE_MS + 60_000);
    await mkdir(join(root, 'run-dir.stdout.partial'));

    await removeWorkingFilesOlderThan(root, Date.now() - STALE_WORKING_FILE_MS);

    assert.deepEqual((await readdir(root)).sort(), [
      'notes.txt',
      'run-dir.stdout.partial',
      'run-new.stdout.partial',
      'session-1',
    ]);
    assert.deepEqual(await readdir(join(root, 'session-1')), ['run-x.stdout.partial']);
    // A root that is not there is nothing to sweep.
    await removeWorkingFilesOlderThan(join(root, 'missing'), Date.now());
  });

  test('are swept the first time a run uses the root in this process, once', async () => {
    const root = await directory('maka-tool-results-sweep-open-');
    await aged(join(root, 'crashed.stdout.partial'), STALE_WORKING_FILE_MS + 60_000);
    const spool = await ShellOutputSpool.open(root, 'run-1');
    const sweep = sweepStaleWorkingFiles(root);
    await sweep;
    assert.deepEqual(await readdir(root), []);
    // Later runs do not sweep again: the same sweep answers.
    assert.equal(sweepStaleWorkingFiles(root), sweep);
    await spool.discard();
  });
});
