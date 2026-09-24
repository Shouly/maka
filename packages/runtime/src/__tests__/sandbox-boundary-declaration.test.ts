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
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { createWorkspaceWritePermissionProfile } from '@maka/core/permission-profile';

import { preflightDeclaredSandboxBoundary } from '../sandbox-boundary-declaration.js';
import {
  materializeApprovedWriteDirectories,
  normalizeSandboxBoundaryExpansion,
} from '../sandbox-boundary-path.js';
import { SandboxCommandError } from '../sandbox/errors.js';
import type { MakaToolContext } from '../tool-runtime.js';

describe('declared Bash sandbox boundary error classification', () => {
  test('maps a model-correctable boundary semantic error to invalid_boundary_declaration', async () => {
    const cwd = await fs.mkdtemp(join(tmpdir(), 'maka-boundary-declaration-'));
    try {
      await assert.rejects(
        preflightDeclaredSandboxBoundary(
          {
            filesystem: {
              entries: [{ path: cwd, access: 'read', scope: 'exact' }],
            },
          },
          toolContext(cwd),
        ),
        (error: unknown) =>
          error instanceof SandboxCommandError &&
          error.reason === 'invalid_boundary_declaration' &&
          /exact sandbox boundary cannot target a directory/.test(error.message),
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test('preserves an injected filesystem failure instead of calling the declaration invalid', async (t) => {
    const injected = Object.assign(new Error('realpath unavailable'), { code: 'EACCES' });
    t.mock.method(fs, 'realpath', async () => {
      throw injected;
    });

    await assert.rejects(
      preflightDeclaredSandboxBoundary(
        {
          filesystem: {
            entries: [{ path: '/workspace/file.txt', access: 'read', scope: 'exact' }],
          },
        },
        toolContext('/workspace'),
      ),
      (error: unknown) => error === injected && !(error instanceof SandboxCommandError),
    );
  });
});

describe('declared Bash sandbox boundary against the current profile', () => {
  test('runs what Manual grants, under any spelling, and asks only to write outside', async () => {
    // `/tmp` and the tmpdir are symlinks on macOS; the declaration is
    // canonicalised, and the profile's roots must be measured the same way.
    const cwd = await fs.mkdtemp(join(tmpdir(), 'maka-boundary-granted-'));
    try {
      const ctx: MakaToolContext = {
        ...toolContext(cwd),
        executionBoundary: {
          kind: 'managed',
          revision: 0,
          profile: createWorkspaceWritePermissionProfile(),
        },
      };
      for (const path of ['/tmp', tmpdir(), cwd]) {
        const normalized = await preflightDeclaredSandboxBoundary(
          { filesystem: { entries: [{ path, access: 'write', scope: 'subtree' }] } },
          ctx,
        );
        assert.equal(normalized?.filesystem?.entries.length, 1, path);
      }
      // Manual reads the whole disk (`:root` is `/`, not the cwd) and has the
      // network open; writing outside the workspace is what still asks.
      for (const expansion of [
        { filesystem: { entries: [{ path: '/usr/share', access: 'read', scope: 'subtree' }] } },
        { network: { enabled: true } },
      ] as const) {
        assert.ok(await preflightDeclaredSandboxBoundary(expansion, ctx));
      }
      await assert.rejects(
        preflightDeclaredSandboxBoundary(
          { filesystem: { entries: [{ path: homedir(), access: 'write', scope: 'subtree' }] } },
          ctx,
        ),
        (error: unknown) =>
          error instanceof SandboxCommandError && error.reason === 'sandbox_boundary_required',
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('a directory granted before it exists', () => {
  test('can be declared as a subtree, while an existing file cannot', async () => {
    const cwd = await fs.mkdtemp(join(tmpdir(), 'maka-boundary-missing-dir-'));
    try {
      await fs.writeFile(join(cwd, 'file.txt'), 'x', 'utf8');
      // Refusing this left the parent — the whole home directory — as the
      // only thing a model could ask for to run `mkdir ~/new`.
      const normalized = await normalizeSandboxBoundaryExpansion(
        {
          filesystem: {
            entries: [{ path: join(cwd, 'new', 'deeper'), access: 'write', scope: 'subtree' }],
          },
        },
        cwd,
      );
      assert.equal(normalized.filesystem?.entries[0]?.scope, 'subtree');
      await assert.rejects(
        normalizeSandboxBoundaryExpansion(
          {
            filesystem: {
              entries: [{ path: join(cwd, 'file.txt'), access: 'write', scope: 'subtree' }],
            },
          },
          cwd,
        ),
        /must target a directory/,
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test('is created before a sandbox that has to name it runs', async () => {
    const cwd = await fs.mkdtemp(join(tmpdir(), 'maka-boundary-materialize-'));
    try {
      const granted = join(cwd, 'granted', 'deeper');
      const readOnly = join(cwd, 'read-only');
      const exactFile = join(cwd, 'exact', 'file.txt');
      materializeApprovedWriteDirectories({
        ...createWorkspaceWritePermissionProfile(),
        fileSystem: {
          kind: 'restricted',
          entries: [
            { kind: 'path', access: 'write', path: granted, match: 'subtree' },
            { kind: 'path', access: 'read', path: readOnly, match: 'subtree' },
            { kind: 'path', access: 'write', path: exactFile, match: 'exact' },
          ],
        },
      });
      assert.equal((await fs.stat(granted)).isDirectory(), true);
      // Only directories approved for writing are made; nothing else.
      await assert.rejects(fs.stat(readOnly), { code: 'ENOENT' });
      await assert.rejects(fs.stat(join(cwd, 'exact')), { code: 'ENOENT' });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

function toolContext(cwd: string): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    toolCallId: 'tool-1',
    cwd,
    abortSignal: new AbortController().signal,
    emitOutput: () => {},
  };
}
