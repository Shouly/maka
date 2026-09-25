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
import { describe, test } from 'node:test';
import {
  applySandboxBoundaryExpansion,
  assessSandboxBoundaryExpansion,
  createGenesisExecutionBoundary,
  decodeExecutionBoundary,
  deriveLinkedChildExecutionBoundary,
  sameExecutionBoundaryAuthority,
  executionBoundaryContains,
  executionBoundaryDisplayMode,
  validateSandboxBoundaryExpansion,
  type ExecutionBoundary,
} from '../sandbox-boundary.js';
import {
  canReadPath,
  canWritePath,
  createDangerFullAccessPermissionProfile,
  createReadOnlyPermissionProfile,
  createWorkspaceWritePermissionProfile,
  type PermissionProfileManaged,
} from '../permission-profile.js';

describe('executionBoundaryDisplayMode', () => {
  test('keeps the read-only/writable distinction the boundary carries (#1611)', () => {
    assert.strictEqual(
      executionBoundaryDisplayMode({
        kind: 'managed',
        profile: createReadOnlyPermissionProfile(),
        revision: 0,
      }),
      'explore',
    );
    assert.strictEqual(
      executionBoundaryDisplayMode({
        kind: 'managed',
        profile: createWorkspaceWritePermissionProfile(),
        revision: 0,
      }),
      'ask',
    );
    assert.strictEqual(executionBoundaryDisplayMode({ kind: 'bypass', revision: 1 }), 'bypass');
    assert.strictEqual(
      executionBoundaryDisplayMode({ kind: 'managed', access: 'read_only', revision: 2 }),
      'explore',
    );
    assert.strictEqual(
      executionBoundaryDisplayMode({ kind: 'managed', access: 'writable', revision: 2 }),
      'ask',
    );
  });

  test('an approved expansion that grants a write stops reading as read-only', () => {
    const widened = applySandboxBoundaryExpansion(createReadOnlyPermissionProfile(), {
      filesystem: { entries: [{ path: '/outside/dist', access: 'write', scope: 'subtree' }] },
    });

    assert.strictEqual(
      executionBoundaryDisplayMode({ kind: 'managed', profile: widened, revision: 1 }),
      'ask',
    );
  });

  test('under-states danger-full-access as Auto rather than naming a mode for it', () => {
    // A deliberate collapse, NOT a description of this profile: the picker
    // offers two modes and no third one is being invented for a profile the
    // product does not hand out. Auto's copy is written to stay true here —
    // it never claims a specific boundary — so this under-states rather than
    // misstates. If Auto's hint ever names a boundary again, this mapping
    // becomes a lie and has to change with it.
    assert.strictEqual(
      executionBoundaryDisplayMode({
        kind: 'managed',
        profile: createDangerFullAccessPermissionProfile(),
        revision: 0,
      }),
      'ask',
    );
  });

  test('an externally isolated boundary has no locally controllable mode', () => {
    assert.strictEqual(executionBoundaryDisplayMode({ kind: 'external', revision: 0 }), undefined);
  });
});

describe('SandboxBoundaryExpansion', () => {
  test('accepts and canonicalizes only additive filesystem and network authority', () => {
    const result = validateSandboxBoundaryExpansion({
      filesystem: {
        entries: [
          { path: '/outside/tree/file.txt', access: 'read', scope: 'exact' },
          { path: '/outside/tree', access: 'read', scope: 'subtree' },
        ],
      },
      network: { enabled: true },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      expansion: {
        filesystem: {
          entries: [{ path: '/outside/tree', access: 'read', scope: 'subtree' }],
        },
        network: { enabled: true },
      },
    });
  });

  test('refuses the filesystem root on every platform', () => {
    // `/` and a drive root are each the whole disk, which no expansion may ask for.
    for (const path of ['/', 'C:\\', 'c:/', 'D:']) {
      const result = validateSandboxBoundaryExpansion({
        filesystem: { entries: [{ path, access: 'write', scope: 'subtree' }] },
      });
      assert.strictEqual(result.ok, false, path);
      if (!result.ok) assert.strictEqual(result.reason, 'invalid_path', path);
    }
  });

  test('accepts normalized Windows drive paths and compares them case-insensitively', () => {
    const result = validateSandboxBoundaryExpansion({
      filesystem: {
        entries: [
          { path: 'D:\\Outside\\Tree\\file.txt', access: 'read', scope: 'exact' },
          { path: 'd:\\outside\\tree', access: 'read', scope: 'subtree' },
        ],
      },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      expansion: {
        filesystem: {
          entries: [{ path: 'd:\\outside\\tree', access: 'read', scope: 'subtree' }],
        },
      },
    });

    // A base that reads only its workspace: the built-in Read only reads the
    // whole disk, where no sibling is left unreadable.
    const workspaceReadOnly: PermissionProfileManaged = {
      type: 'managed',
      name: 'workspace-read-only',
      fileSystem: {
        kind: 'restricted',
        entries: [{ kind: 'special', access: 'read', special: ':workspace_roots' }],
      },
      network: { kind: 'restricted' },
    };
    const widened = applySandboxBoundaryExpansion(workspaceReadOnly, {
      filesystem: {
        entries: [{ path: 'D:\\Outside\\Tree', access: 'read', scope: 'subtree' }],
      },
    });
    assert.strictEqual(canReadPath(widened, 'd:\\outside\\tree\\file.txt'), true);
    assert.strictEqual(canReadPath(widened, 'D:\\Outside\\Sibling\\file.txt'), false);
  });

  test('rejects non-normalized Windows boundary paths', () => {
    for (const path of [
      'D:\\outside\\..\\secret.txt',
      'D:/outside/secret.txt',
      '\\\\server\\share\\secret.txt',
      'D:\\outside\\',
    ]) {
      assert.strictEqual(
        validateSandboxBoundaryExpansion({
          filesystem: { entries: [{ path, access: 'read', scope: 'exact' }] },
        }).ok,
        false,
      );
    }
  });

  test('rejects empty, relative, deny, policy-shaped, and legacy expansions', () => {
    for (const expansion of [
      {},
      { filesystem: { entries: [] } },
      { filesystem: { entries: [{ path: '../outside', access: 'read', scope: 'exact' }] } },
      { filesystem: { entries: [{ path: '/outside', access: 'deny', scope: 'exact' }] } },
      { filesystem: { entries: [{ path: '/outside', access: 'read', scope: 'special' }] } },
      {
        filesystem: {
          entries: [{ path: '/outside', access: 'read', scope: 'exact', kind: 'path' }],
        },
      },
      { network: { enabled: false } },
      { profile: { type: 'managed' } },
      { fileSystem: { entries: [{ path: '/legacy', access: 'read', scope: 'exact' }] } },
    ]) {
      assert.strictEqual(validateSandboxBoundaryExpansion(expansion).ok, false);
    }
  });

  test('the filesystem root is a read entry only where the caller allows it, never a grant', () => {
    const rootRead = { filesystem: { entries: [{ path: '/', access: 'read', scope: 'subtree' }] } };
    assert.strictEqual(validateSandboxBoundaryExpansion(rootRead).ok, false);
    const allowed = validateSandboxBoundaryExpansion(rootRead, { allowReadRoot: true });
    assert.strictEqual(allowed.ok, true);
    if (allowed.ok) assert.strictEqual(allowed.expansion.filesystem?.entries[0]?.path, '/');
    assert.strictEqual(
      validateSandboxBoundaryExpansion(
        { filesystem: { entries: [{ path: '/', access: 'write', scope: 'subtree' }] } },
        { allowReadRoot: true },
      ).ok,
      false,
    );
  });

  test('applies additive authority without weakening an explicit deny', () => {
    const base: PermissionProfileManaged = {
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'restricted',
        entries: [{ kind: 'path', access: 'deny', path: '/outside/locked', match: 'subtree' }],
      },
      network: { kind: 'restricted' },
    };

    const result = applySandboxBoundaryExpansion(base, {
      filesystem: {
        entries: [
          { path: '/outside/open.txt', access: 'write', scope: 'exact' },
          { path: '/outside/locked/file.txt', access: 'write', scope: 'exact' },
        ],
      },
      network: { enabled: true },
    });

    assert.strictEqual(canWritePath(result, '/outside/open.txt'), true);
    assert.strictEqual(canReadPath(result, '/outside/locked/file.txt'), false);
    assert.strictEqual(canWritePath(result, '/outside/locked/file.txt'), false);
    assert.strictEqual(result.network.kind, 'enabled');
  });

  test('enables network when filesystem access is already unrestricted', () => {
    const base: PermissionProfileManaged = {
      type: 'managed',
      name: 'custom',
      fileSystem: { kind: 'unrestricted', entries: [] },
      network: { kind: 'restricted' },
    };

    const result = applySandboxBoundaryExpansion(base, {
      network: { enabled: true },
    });

    assert.strictEqual(result.network.kind, 'enabled');
  });

  test('compacts cumulative explicit grants without changing special paths or denies', () => {
    const base: PermissionProfileManaged = {
      type: 'managed',
      fileSystem: {
        kind: 'restricted',
        entries: [
          { kind: 'special', access: 'write', special: ':workspace_roots' },
          { kind: 'path', access: 'deny', path: '/outside/locked', match: 'subtree' },
          { kind: 'path', access: 'read', path: '/outside/tree/file.txt', match: 'exact' },
        ],
      },
      network: { kind: 'restricted' },
    };

    const result = applySandboxBoundaryExpansion(base, {
      filesystem: {
        entries: [{ path: '/outside/tree', access: 'read', scope: 'subtree' }],
      },
    });

    assert.deepStrictEqual(result.fileSystem.entries, [
      { kind: 'special', access: 'write', special: ':workspace_roots' },
      { kind: 'path', access: 'deny', path: '/outside/locked', match: 'subtree' },
      { kind: 'path', access: 'read', path: '/outside/tree', match: 'subtree' },
    ]);
  });

  test('distinguishes a new expansion, an approved no-op, and an explicit-deny conflict', () => {
    const base: PermissionProfileManaged = {
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'restricted',
        entries: [
          { kind: 'path', access: 'read', path: '/outside/already.txt', match: 'exact' },
          { kind: 'path', access: 'deny', path: '/outside/locked', match: 'subtree' },
        ],
      },
      network: { kind: 'restricted' },
    };

    assert.strictEqual(
      assessSandboxBoundaryExpansion(base, {
        filesystem: {
          entries: [{ path: '/outside/already.txt', access: 'read', scope: 'exact' }],
        },
      }).outcome,
      'noop',
    );
    assert.strictEqual(
      assessSandboxBoundaryExpansion(base, {
        filesystem: { entries: [{ path: '/outside/new.txt', access: 'read', scope: 'exact' }] },
      }).outcome,
      'apply',
    );
    assert.deepStrictEqual(
      assessSandboxBoundaryExpansion(base, {
        filesystem: {
          entries: [{ path: '/outside', access: 'write', scope: 'subtree' }],
        },
      }),
      { outcome: 'conflict', reason: 'explicit_deny' },
    );
  });

  test('does not treat a child of an exact path grant as already approved', () => {
    const base: PermissionProfileManaged = {
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'restricted',
        entries: [{ kind: 'path', access: 'read', path: '/outside', match: 'exact' }],
      },
      network: { kind: 'restricted' },
    };

    const assessment = assessSandboxBoundaryExpansion(base, {
      filesystem: {
        entries: [{ path: '/outside/child', access: 'read', scope: 'exact' }],
      },
    });

    assert.strictEqual(assessment.outcome, 'apply');
  });

  test('keeps explicit denies authoritative inside an otherwise unrestricted profile', () => {
    const base: PermissionProfileManaged = {
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'unrestricted',
        entries: [{ kind: 'path', access: 'deny', path: '/locked', match: 'subtree' }],
      },
      network: { kind: 'enabled' },
    };

    assert.deepStrictEqual(
      assessSandboxBoundaryExpansion(base, {
        filesystem: {
          entries: [{ path: '/locked/file.txt', access: 'read', scope: 'exact' }],
        },
      }),
      { outcome: 'conflict', reason: 'explicit_deny' },
    );
  });

  test('an exact grant for a protected path is approvable; a subtree over the workspace is not', () => {
    const manual = createWorkspaceWritePermissionProfile();
    const context = { workspaceRoots: ['/ws/project'] };

    // The workspace's own write entry does not cover its protected entries,
    // so the request is applied rather than answered as already granted.
    assert.strictEqual(
      assessSandboxBoundaryExpansion(
        manual,
        {
          filesystem: {
            entries: [{ path: '/ws/project/.git/config', access: 'write', scope: 'exact' }],
          },
        },
        context,
      ).outcome,
      'apply',
    );
    // The workspace itself, as Bash declares it, is already granted: a noop.
    assert.strictEqual(
      assessSandboxBoundaryExpansion(
        manual,
        { filesystem: { entries: [{ path: '/ws/project', access: 'write', scope: 'subtree' }] } },
        context,
      ).outcome,
      'noop',
    );
    // A subtree above the workspace would lift the protection without naming it.
    assert.deepStrictEqual(
      assessSandboxBoundaryExpansion(
        manual,
        { filesystem: { entries: [{ path: '/ws', access: 'write', scope: 'subtree' }] } },
        context,
      ),
      { outcome: 'conflict', reason: 'explicit_deny' },
    );
  });

  test('uses the same default slash-tmp root as permission enforcement', () => {
    const assessment = assessSandboxBoundaryExpansion(createWorkspaceWritePermissionProfile(), {
      filesystem: {
        entries: [{ path: '/tmp/output.txt', access: 'write', scope: 'exact' }],
      },
    });

    assert.strictEqual(assessment.outcome, 'noop');
  });
});

describe('ExecutionBoundary', () => {
  test('decodes only a complete full boundary snapshot', () => {
    const managed = createGenesisExecutionBoundary('ask');
    assert.deepStrictEqual(decodeExecutionBoundary(JSON.parse(JSON.stringify(managed))), managed);
    assert.deepStrictEqual(decodeExecutionBoundary({ kind: 'bypass', revision: 3 }), {
      kind: 'bypass',
      revision: 3,
    });

    for (const invalid of [
      { kind: 'managed', revision: 0 },
      { kind: 'bypass', revision: -1 },
      { kind: 'external', revision: 1, profile: {} },
      { kind: 'unknown', revision: 0 },
    ]) {
      assert.throws(() => decodeExecutionBoundary(invalid));
    }
  });

  test('round-trips managed protected-metadata policy', () => {
    const managed = createGenesisExecutionBoundary('ask');
    if (managed.kind !== 'managed') throw new Error('expected managed boundary');
    const boundary = {
      ...managed,
      profile: {
        ...managed.profile,
        fileSystem: {
          ...managed.profile.fileSystem,
          protectedMetadata: {
            access: 'deny_write' as const,
            names: ['.git', '.agents', '.codex'],
          },
        },
      },
    };

    assert.deepStrictEqual(decodeExecutionBoundary(JSON.parse(JSON.stringify(boundary))), boundary);
  });

  test('rejects a complete boundary snapshot above the shared capacity', () => {
    const managed = createGenesisExecutionBoundary('ask');
    if (managed.kind !== 'managed') throw new Error('expected managed boundary');
    const oversized = {
      ...managed,
      profile: {
        ...managed.profile,
        fileSystem: {
          ...managed.profile.fileSystem,
          entries: Array.from({ length: 300 }, (_, index) => ({
            kind: 'path' as const,
            access: 'read' as const,
            path: `/outside/${index}-${'x'.repeat(3_900)}`,
            match: 'exact' as const,
          })),
        },
      },
    };

    assert.throws(
      () => decodeExecutionBoundary(oversized),
      /Execution boundary exceeds the serialized size limit/,
    );
  });

  test('compares complete boundary authority with one canonical containment contract', () => {
    const auto = createGenesisExecutionBoundary('ask');
    const readOnly = createGenesisExecutionBoundary('explore');
    const bypass = createGenesisExecutionBoundary('bypass');
    const external = { kind: 'external', revision: 0 } as const;

    assert.strictEqual(executionBoundaryContains(auto, readOnly), true);
    assert.strictEqual(executionBoundaryContains(readOnly, auto), false);
    assert.strictEqual(executionBoundaryContains(bypass, external), true);
    assert.strictEqual(executionBoundaryContains(external, external), true);
    assert.strictEqual(executionBoundaryContains(external, auto), false);
    assert.strictEqual(executionBoundaryContains(auto, external), false);
  });
});

describe('deriveLinkedChildExecutionBoundary', () => {
  const manualWithGrant: ExecutionBoundary = {
    kind: 'managed',
    profile: applySandboxBoundaryExpansion(createWorkspaceWritePermissionProfile(), {
      filesystem: { entries: [{ path: '/approved/output', access: 'write', scope: 'subtree' }] },
    }),
    revision: 3,
  };

  test('a Read only definition is read-only under any parent', () => {
    const readOnly = { kind: 'managed', profile: createReadOnlyPermissionProfile(), revision: 1 };
    assert.deepStrictEqual(
      deriveLinkedChildExecutionBoundary(manualWithGrant, 'explore', 1),
      readOnly,
    );
    assert.deepStrictEqual(
      deriveLinkedChildExecutionBoundary({ kind: 'bypass', revision: 2 }, 'explore', 1),
      readOnly,
    );
  });

  test('any other definition follows the parent, grants and Full access included', () => {
    assert.deepStrictEqual(deriveLinkedChildExecutionBoundary(manualWithGrant, 'ask', 4), {
      ...manualWithGrant,
      revision: 4,
    });
    assert.deepStrictEqual(
      deriveLinkedChildExecutionBoundary({ kind: 'bypass', revision: 2 }, 'ask', 0),
      { kind: 'bypass', revision: 0 },
    );
    assert.deepStrictEqual(
      deriveLinkedChildExecutionBoundary(createGenesisExecutionBoundary('explore'), 'ask', 0),
      createGenesisExecutionBoundary('explore'),
    );
  });

  test('an externally isolated parent keeps its children external', () => {
    assert.deepStrictEqual(
      deriveLinkedChildExecutionBoundary({ kind: 'external', revision: 0 }, 'ask', 5),
      { kind: 'external', revision: 5 },
    );
  });
});

describe('sameExecutionBoundaryAuthority', () => {
  test('ignores the revision and compares managed profiles structurally', () => {
    const a = createGenesisExecutionBoundary('ask');
    assert.strictEqual(sameExecutionBoundaryAuthority(a, { ...a, revision: 7 }), true);
    assert.strictEqual(
      sameExecutionBoundaryAuthority(a, createGenesisExecutionBoundary('explore')),
      false,
    );
    assert.strictEqual(
      sameExecutionBoundaryAuthority(
        { kind: 'bypass', revision: 0 },
        { kind: 'bypass', revision: 9 },
      ),
      true,
    );
    assert.strictEqual(sameExecutionBoundaryAuthority(a, { kind: 'bypass', revision: 0 }), false);
  });
});
