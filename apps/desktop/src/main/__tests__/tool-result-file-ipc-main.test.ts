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
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { registerToolResultFileIpc } from '../tool-result-file-ipc-main.js';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const SESSION = 'session-a';
const OTHER_SESSION = 'session-b';
const RUN = 'run-1.txt';

interface Fixture {
  base: string;
  root: string;
  folder: string;
  saved: string;
  reveal(sessionId: unknown, path: unknown, options?: RevealOptions): Promise<unknown>;
  /** Every call that reached the fake shell, by method. */
  calls: { method: string; path: string }[];
}

interface RevealOptions {
  allowLocalPaths?: boolean;
  root?: string;
  showItemInFolder?: (path: string) => void;
}

/**
 * A real saved-results root in a temp folder: this Session's folder holding
 * one saved run, another Session's folder holding its own, and a file outside
 * the root. The shell is a fake that records every call, `openPath` included,
 * so a test can tell that nothing was ever opened.
 */
async function withRoot(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'maka-tool-result-reveal-'));
  try {
    const root = join(base, 'tool-results');
    const folder = join(root, SESSION);
    await mkdir(folder, { recursive: true });
    await mkdir(join(root, OTHER_SESSION), { recursive: true });
    const saved = join(folder, RUN);
    await writeFile(saved, 'the whole output');
    await writeFile(join(root, OTHER_SESSION, RUN), 'another session');
    await writeFile(join(base, RUN), 'outside the root');
    const calls: Fixture['calls'] = [];
    const reveal = async (sessionId: unknown, path: unknown, options: RevealOptions = {}) => {
      const handlers = new Map<string, Handler>();
      const shell = {
        showItemInFolder(target: string) {
          calls.push({ method: 'showItemInFolder', path: target });
          options.showItemInFolder?.(target);
        },
        openPath(target: string) {
          calls.push({ method: 'openPath', path: target });
          return Promise.resolve('');
        },
      };
      registerToolResultFileIpc({
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as Handler) },
        shell,
        allowLocalPaths: options.allowLocalPaths ?? true,
        root: options.root ?? root,
      });
      assert.equal(handlers.has('app:openToolResultFile'), false, 'there is no open channel');
      const handler = handlers.get('app:revealToolResultFile');
      assert.ok(handler, 'the channel is registered');
      return handler({}, sessionId, path);
    };
    await run({ base, root, folder, saved, reveal, calls });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const NOT_ALLOWED = { ok: false, reason: 'not-allowed' };

test('a saved tool result is revealed at the path main builds, never opened', async () => {
  await withRoot(async ({ saved, folder, reveal, calls }) => {
    assert.deepEqual(await reveal(SESSION, saved), { ok: true });
    assert.deepEqual(await reveal(SESSION, `${folder}/./${RUN}`), { ok: true }, 'the same path');
    // The temp folder sits under a symlink on macOS: the path main built is
    // what is shown, not the realpath of what is on disk.
    assert.deepEqual(calls, [
      { method: 'showItemInFolder', path: saved },
      { method: 'showItemInFolder', path: saved },
    ]);
  });
});

test('a path that is not the one main builds for that Session is refused', async () => {
  await withRoot(async ({ base, root, folder, saved, reveal, calls }) => {
    assert.deepEqual(
      await reveal(SESSION, join(root, OTHER_SESSION, RUN)),
      NOT_ALLOWED,
      "another Session's folder",
    );
    assert.deepEqual(
      await reveal(SESSION, `${folder}/../${OTHER_SESSION}/${RUN}`),
      NOT_ALLOWED,
      'a `..` climb into another Session',
    );
    assert.deepEqual(
      await reveal(SESSION, `${folder}/../../${RUN}`),
      NOT_ALLOWED,
      'a `..` climb out of the root',
    );
    assert.deepEqual(await reveal(SESSION, join(base, RUN)), NOT_ALLOWED, 'outside the root');
    assert.deepEqual(await reveal(SESSION, RUN), NOT_ALLOWED, 'a relative path');
    assert.deepEqual(await reveal(SESSION, join(folder, 'nested', RUN)), NOT_ALLOWED, 'a subfolder');
    assert.deepEqual(
      await reveal(SESSION, saved, { root: join(base, 'other-root') }),
      NOT_ALLOWED,
      'a different root',
    );
    assert.deepEqual(calls, []);
  });
});

test('a file name that is not a saved run is refused, even inside the folder', async () => {
  await withRoot(async ({ folder, reveal, calls }) => {
    for (const name of ['x.command', 'y.terminal', 'a.txt.app', 'run.TXT', '.txt', 'a b.txt', 'run.txt.']) {
      await writeFile(join(folder, name), 'echo written by the command');
      assert.deepEqual(await reveal(SESSION, join(folder, name)), NOT_ALLOWED, name);
    }
    assert.deepEqual(await reveal(SESSION, `${join(folder, 'x'.repeat(129))}.txt`), NOT_ALLOWED);
    assert.deepEqual(calls, []);
  });
});

test('a saved run replaced by a symlink is refused, wherever it points', async () => {
  await withRoot(async ({ base, folder, reveal, calls }) => {
    const inside = join(folder, 'run-2.txt');
    await writeFile(join(folder, 'other.txt'), 'inside the folder');
    await symlink(join(folder, 'other.txt'), inside);
    assert.deepEqual(await reveal(SESSION, inside), NOT_ALLOWED, 'a link to a file inside');
    const outside = join(folder, 'run-3.txt');
    await writeFile(join(base, 'x.command'), '#!/bin/sh\necho escaped');
    await symlink(join(base, 'x.command'), outside);
    assert.deepEqual(await reveal(SESSION, outside), NOT_ALLOWED, 'a link to a file outside');
    const dangling = join(folder, 'run-4.txt');
    await symlink(join(base, 'gone.command'), dangling);
    assert.deepEqual(await reveal(SESSION, dangling), NOT_ALLOWED, 'a link to nothing');
    assert.deepEqual(calls, []);
  });
});

test('a Session folder that is a symlink is refused', async () => {
  await withRoot(async ({ base, root, reveal, calls }) => {
    const elsewhere = join(base, 'elsewhere');
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, RUN), 'not a saved result');
    await symlink(elsewhere, join(root, 'session-link'));
    assert.deepEqual(await reveal('session-link', join(root, 'session-link', RUN)), NOT_ALLOWED);
    // Pointing at another Session's real folder is no better.
    await symlink(join(root, OTHER_SESSION), join(root, 'session-alias'));
    assert.deepEqual(await reveal('session-alias', join(root, 'session-alias', RUN)), NOT_ALLOWED);
    assert.deepEqual(calls, []);
  });
});

test('a Session id that is not one is refused, so it never names a folder', async () => {
  await withRoot(async ({ saved, reveal, calls }) => {
    for (const sessionId of ['', '..', `${SESSION}/..`, '../session-a', 'a b', 42, undefined]) {
      assert.deepEqual(await reveal(sessionId, saved), NOT_ALLOWED, String(sessionId));
    }
    assert.deepEqual(await reveal(SESSION, 42), NOT_ALLOWED);
    assert.deepEqual(await reveal(SESSION, undefined), NOT_ALLOWED);
    assert.deepEqual(calls, []);
  });
});

test('a missing saved run, or a folder in its place, is refused with its own reason', async () => {
  await withRoot(async ({ root, folder, reveal, calls }) => {
    assert.deepEqual(await reveal(SESSION, join(folder, 'cleared.txt')), {
      ok: false,
      reason: 'missing',
    });
    assert.deepEqual(
      await reveal('session-gone', join(root, 'session-gone', RUN)),
      { ok: false, reason: 'missing' },
      'a Session whose folder was purged',
    );
    await mkdir(join(folder, 'run-5.txt'));
    assert.deepEqual(await reveal(SESSION, join(folder, 'run-5.txt')), {
      ok: false,
      reason: 'not-a-file',
    });
    assert.deepEqual(calls, []);
  });
});

test('a saved tool result is not revealed for a Host on another machine', async () => {
  await withRoot(async ({ saved, reveal, calls }) => {
    assert.deepEqual(await reveal(SESSION, saved, { allowLocalPaths: false }), NOT_ALLOWED);
    assert.deepEqual(calls, []);
  });
});

test('a file manager that fails to reveal the saved tool result is reported', async () => {
  await withRoot(async ({ saved, reveal, calls }) => {
    assert.deepEqual(
      await reveal(SESSION, saved, {
        showItemInFolder: () => {
          throw new Error('file manager unavailable');
        },
      }),
      { ok: false, reason: 'open-failed' },
    );
    assert.deepEqual(
      calls.map((call) => call.method),
      ['showItemInFolder'],
      'and nothing falls back to opening it',
    );
  });
});
