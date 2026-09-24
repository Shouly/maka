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
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  createDangerFullAccessPermissionProfile,
  createReadOnlyPermissionProfile,
  createWorkspaceWritePermissionProfile,
  type PermissionProfile,
} from '@maka/core/permission-profile';

import {
  MACOS_SEATBELT_EXECUTABLE,
  MacosSeatbeltBackend,
  buildSeatbeltPolicy,
  createSeatbeltExecArgs,
  escapeSeatbeltRegex,
} from '../sandbox/macos-seatbelt.js';
import type { SandboxTransformRequest } from '../sandbox/types.js';

function workspaceCommand(profile: PermissionProfile): SandboxTransformRequest {
  return {
    platform: 'darwin',
    command: {
      program: '/bin/zsh',
      args: ['-lc', 'echo ok'],
      cwd: '/repo',
      profile,
      pathContext: {
        workspaceRoots: ['/repo'],
        tmpdir: '/private/tmp/maka-test',
        slashTmp: '/tmp',
      },
    },
  };
}

/**
 * The policy mechanics below are exercised with profiles that read only the
 * workspace and keep the network closed; the built-in profiles read the whole
 * disk, whose single `/` root would hide the roots under test.
 */
function workspaceReadProfile(): PermissionProfile {
  return {
    ...createReadOnlyPermissionProfile(),
    fileSystem: {
      kind: 'restricted',
      entries: [{ kind: 'special', access: 'read', special: ':workspace_roots' }],
    },
  };
}

function workspaceWriteProfile(): PermissionProfile {
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

function restrictedProfileWithEnabledNetwork(): PermissionProfile {
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
      ],
    },
    network: { kind: 'enabled' },
  };
}

function restrictedProfileWithDeniedChild(): PermissionProfile {
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
          path: '/repo/secret',
        },
      ],
    },
    network: { kind: 'restricted' },
  };
}

function workspaceWriteProfileWithCustomProtectedMetadata(): PermissionProfile {
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
      ],
      protectedMetadata: {
        access: 'deny_write',
        names: ['.git', '.maka'],
      },
    },
    network: { kind: 'restricted' },
  };
}

function policyText(profile: PermissionProfile): string {
  return buildSeatbeltPolicy({
    profile,
    pathContext: {
      workspaceRoots: ['/repo'],
      tmpdir: '/private/tmp/maka-test',
      slashTmp: '/tmp',
    },
  }).policy;
}

describe('escapeSeatbeltRegex', () => {
  it('escapes regex metacharacters before inserting paths into SBPL regex literals', () => {
    assert.equal(escapeSeatbeltRegex('/tmp/repo.(test)+[x]'), '/tmp/repo\\.\\(test\\)\\+\\[x\\]');
  });
});

describe('buildSeatbeltPolicy', () => {
  it('keeps the protected git entries of the workspace read-only once they exist', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maka-seatbelt-git-')));
    try {
      const context = {
        workspaceRoots: [root],
        tmpdir: '/private/tmp/maka-test',
        slashTmp: '/tmp',
      };
      // No repository yet: nothing to protect, so `git init` can create it.
      const fresh = buildSeatbeltPolicy({
        profile: createWorkspaceWritePermissionProfile(),
        pathContext: context,
      }).policy;
      assert.doesNotMatch(fresh, /\.git\/config/);

      mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
      writeFileSync(join(root, '.git', 'config'), '[core]\n', 'utf8');
      const withRepo = buildSeatbeltPolicy({
        profile: createWorkspaceWritePermissionProfile(),
        pathContext: context,
      }).policy;
      assert.match(withRepo, new RegExp(`\\(require-not \\(subpath "${root}/\\.git/config"\\)\\)`));
      assert.match(withRepo, new RegExp(`\\(require-not \\(subpath "${root}/\\.git/hooks"\\)\\)`));
      // The repository directory itself stays where it is, but is not read-only.
      assert.match(withRepo, new RegExp(`\\(require-not \\(literal "${root}/\\.git"\\)\\)`));
      assert.doesNotMatch(withRepo, new RegExp(`\\(require-not \\(subpath "${root}/\\.git"\\)\\)`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds read-only policy with readable workspace roots and no writable workspace roots', () => {
    const result = buildSeatbeltPolicy({
      profile: workspaceReadProfile(),
      pathContext: { workspaceRoots: ['/repo'] },
    });

    assert.match(result.policy, /\(version 1\)/);
    assert.match(result.policy, /\(deny default\)/);
    assert.match(result.policy, /\(allow file-read\*/);
    assert.match(result.policy, /\(subpath \(param "READABLE_ROOT_0"\)\)/);
    assert.doesNotMatch(result.policy, /WRITABLE_ROOT_0/);
    assert.deepEqual(result.definitionArgs, ['-DREADABLE_ROOT_0=/repo']);
  });

  it('builds workspace-write policy with parameterized workspace and temp roots', () => {
    const result = buildSeatbeltPolicy({
      profile: workspaceWriteProfile(),
      pathContext: {
        workspaceRoots: ['/repo'],
        tmpdir: '/private/tmp/maka-test',
        slashTmp: '/tmp',
      },
    });

    assert.match(result.policy, /\(subpath \(param "READABLE_ROOT_0"\)\)/);
    assert.match(result.policy, /\(subpath \(param "WRITABLE_ROOT_0"\)\)/);
    assert.deepEqual(result.definitionArgs, [
      '-DREADABLE_ROOT_0=/repo',
      '-DREADABLE_ROOT_1=/private/tmp/maka-test',
      `-DREADABLE_ROOT_2=${realpathSync('/tmp')}`,
      '-DWRITABLE_ROOT_0=/repo',
      '-DWRITABLE_ROOT_1=/private/tmp/maka-test',
      `-DWRITABLE_ROOT_2=${realpathSync('/tmp')}`,
    ]);
  });

  it('reads the whole disk for the built-in profiles, with no ancestor rule for /', () => {
    const manual = buildSeatbeltPolicy({
      profile: createWorkspaceWritePermissionProfile(),
      pathContext: {
        workspaceRoots: ['/repo'],
        tmpdir: '/private/tmp/maka-test',
        slashTmp: '/tmp',
      },
    });
    assert.equal(manual.definitionArgs[0], '-DREADABLE_ROOT_0=/');
    // `/` has no ancestors, and Seatbelt rejects the whole policy over a
    // `path-ancestors` of it.
    assert.doesNotMatch(manual.policy, /path-ancestors \(param "READABLE_ROOT_0"\)/);
    assert.match(manual.policy, /\(allow network\*\)/);

    const readOnly = buildSeatbeltPolicy({
      profile: createReadOnlyPermissionProfile(),
      pathContext: { workspaceRoots: ['/repo'] },
    });
    assert.deepEqual(readOnly.definitionArgs, ['-DREADABLE_ROOT_0=/']);
    assert.doesNotMatch(readOnly.policy, /WRITABLE_ROOT/);
    assert.match(readOnly.policy, /\(deny network\*\)/);
  });

  it('allows directory reads along every readable root ancestor chain', () => {
    const policy = policyText(workspaceReadProfile());

    assert.match(
      policy,
      /\(allow file-read-data\n  \(require-all\n    \(path-ancestors \(param "READABLE_ROOT_0"\)\)\n    \(vnode-type DIRECTORY\)\n  \)\)/,
    );
  });

  it('resolves symlinked temp roots before passing them to Seatbelt', () => {
    const linkedTempRoot = mkdtempSync(join(tmpdir(), 'maka-seatbelt-root-'));

    try {
      const result = buildSeatbeltPolicy({
        profile: workspaceWriteProfile(),
        pathContext: {
          workspaceRoots: ['/repo'],
          tmpdir: linkedTempRoot,
          slashTmp: '/tmp',
        },
      });
      const canonicalTempRoot = realpathSync(linkedTempRoot);

      assert.ok(result.definitionArgs.includes(`-DREADABLE_ROOT_1=${canonicalTempRoot}`));
      assert.ok(result.definitionArgs.includes(`-DWRITABLE_ROOT_1=${canonicalTempRoot}`));
    } finally {
      rmSync(linkedTempRoot, { recursive: true, force: true });
    }
  });

  it('canonicalizes a missing denied leaf through its existing symlinked ancestor', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'maka-seatbelt-deny-'));
    const realTarget = join(scratch, 'real');
    const linkedTarget = join(scratch, 'link');
    mkdirSync(realTarget);
    symlinkSync(realTarget, linkedTarget);

    try {
      const profile: PermissionProfile = {
        type: 'managed',
        name: 'custom',
        fileSystem: {
          kind: 'restricted',
          entries: [
            { kind: 'path', access: 'write', path: realTarget, match: 'subtree' },
            {
              kind: 'path',
              access: 'deny',
              path: join(linkedTarget, 'blocked.txt'),
              match: 'exact',
            },
          ],
        },
        network: { kind: 'restricted' },
      };
      const result = buildSeatbeltPolicy({ profile, pathContext: { workspaceRoots: ['/repo'] } });
      const canonicalTarget = realpathSync(realTarget);

      assert.ok(result.definitionArgs.includes(`-DWRITABLE_ROOT_0=${canonicalTarget}`));
      assert.ok(
        result.policy.includes(`(require-not (literal "${join(canonicalTarget, 'blocked.txt')}"))`),
      );
      assert.ok(!result.policy.includes(`(literal "${join(linkedTarget, 'blocked.txt')}")`));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses a writable root that resolves through a symlink below the system directory', () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maka-seatbelt-linked-root-')));
    const realTarget = join(scratch, 'real');
    const linkedRoot = join(scratch, 'root');
    mkdirSync(realTarget);
    symlinkSync(realTarget, linkedRoot);

    try {
      const granted: PermissionProfile = {
        type: 'managed',
        name: 'custom',
        fileSystem: {
          kind: 'restricted',
          entries: [{ kind: 'path', access: 'write', path: linkedRoot, match: 'subtree' }],
        },
        network: { kind: 'restricted' },
      };
      assert.throws(
        () => buildSeatbeltPolicy({ profile: granted, pathContext: { workspaceRoots: ['/repo'] } }),
        /resolves to .* not to itself/,
      );
      // The same root as the workspace, and as a read root, where following is fine.
      assert.throws(
        () =>
          buildSeatbeltPolicy({
            profile: workspaceWriteProfile(),
            pathContext: { workspaceRoots: [linkedRoot] },
          }),
        /resolves to .* not to itself/,
      );
      const readOnly = buildSeatbeltPolicy({
        profile: workspaceReadProfile(),
        pathContext: { workspaceRoots: [linkedRoot] },
      });
      assert.ok(readOnly.definitionArgs.includes(`-DREADABLE_ROOT_0=${realTarget}`));
      // The system aliases under /private are the one level a writable root
      // may pass through.
      const viaSlashTmp = buildSeatbeltPolicy({
        profile: workspaceWriteProfile(),
        pathContext: { workspaceRoots: ['/repo'], slashTmp: '/tmp', tmpdir: tmpdir() },
      });
      const writableRoots = viaSlashTmp.definitionArgs
        .filter((arg) => arg.startsWith('-DWRITABLE_ROOT_'))
        .map((arg) => arg.slice(arg.indexOf('=') + 1));
      assert.ok(writableRoots.includes(realpathSync('/tmp')));
      assert.ok(writableRoots.includes(realpathSync(tmpdir())));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('fails policy construction when a root cannot be canonicalized', function (t) {
    if (process.getuid?.() === 0) return t.skip('EACCES does not apply to root');
    const scratch = mkdtempSync(join(tmpdir(), 'maka-seatbelt-eacces-'));
    const sealed = join(scratch, 'sealed');
    mkdirSync(sealed);
    chmodSync(sealed, 0o000);

    try {
      const profile: PermissionProfile = {
        type: 'managed',
        name: 'custom',
        fileSystem: {
          kind: 'restricted',
          entries: [
            { kind: 'path', access: 'write', path: scratch, match: 'subtree' },
            { kind: 'path', access: 'deny', path: join(sealed, 'blocked.txt'), match: 'exact' },
          ],
        },
        network: { kind: 'restricted' },
      };

      assert.throws(() =>
        buildSeatbeltPolicy({ profile, pathContext: { workspaceRoots: ['/repo'] } }),
      );
    } finally {
      chmodSync(sealed, 0o700);
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps workspace metadata writable in the standard workspace profile', () => {
    const policy = policyText(createWorkspaceWritePermissionProfile());

    assert.match(policy, /\(allow file-write\*\n  \(subpath \(param "WRITABLE_ROOT_0"\)\)/);
    assert.doesNotMatch(policy, /require-not.*\\\.(?:git|agents|codex)/);
  });

  it('uses protected metadata names from the active profile, for the entries that exist', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maka-seatbelt-protected-')));
    try {
      mkdirSync(join(root, '.git'));
      mkdirSync(join(root, '.agents'));
      const policy = buildSeatbeltPolicy({
        profile: workspaceWriteProfileWithCustomProtectedMetadata(),
        pathContext: { workspaceRoots: [root], tmpdir: '/private/tmp/maka-test', slashTmp: '/tmp' },
      }).policy;

      assert.ok(policy.includes(`(require-not (subpath "${root}/.git"))`));
      // Named but absent: nothing to protect yet.
      assert.ok(!policy.includes(`(require-not (subpath "${root}/.maka"))`));
      // Present but not named by this profile.
      assert.ok(!policy.includes(`(require-not (subpath "${root}/.agents"))`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('excludes explicit deny roots from readable and writable root allow clauses', () => {
    const policy = policyText(restrictedProfileWithDeniedChild());

    assert.ok(policy.includes(String.raw`(require-not (regex #"^/repo/secret(/.*)?$"))`));
    assert.match(
      policy,
      /\(allow file-read\*\n  \(require-all\n    \(subpath \(param "READABLE_ROOT_0"\)\)\n    \(require-not \(regex #"\^\/repo\/secret\(\/\.\*\)\?\$"\)\)\n  \)\)/,
    );
    assert.match(
      policy,
      /\(allow file-write\*\n  \(require-all\n    \(subpath \(param "WRITABLE_ROOT_0"\)\)\n    \(require-not \(regex #"\^\/repo\/secret\(\/\.\*\)\?\$"\)\)\n  \)\)/,
    );
    assert.match(
      policy,
      /\(allow file-read-data\n  \(require-all\n    \(path-ancestors \(param "READABLE_ROOT_0"\)\)\n    \(vnode-type DIRECTORY\)\n    \(require-not \(regex #"\^\/repo\/secret\(\/\.\*\)\?\$"\)\)\n  \)\)/,
    );
  });

  it('escapes the workspace root inside a protected metadata clause', () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'maka-seatbelt-escape-')));
    const root = join(parent, 'repo "quoted" (test)');
    try {
      mkdirSync(join(root, '.git'), { recursive: true });
      const result = buildSeatbeltPolicy({
        profile: workspaceWriteProfileWithCustomProtectedMetadata(),
        pathContext: { workspaceRoots: [root] },
      });

      assert.ok(
        result.policy.includes(`(require-not (subpath "${parent}/repo \\"quoted\\" (test)/.git"))`),
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('emits network restricted and enabled policy sections', () => {
    assert.match(policyText(workspaceWriteProfile()), /\(deny network\*\)/);
    assert.match(policyText(restrictedProfileWithEnabledNetwork()), /\(allow network\*\)/);
  });

  it('renders exact path entries as literal and subtree entries as subpath', () => {
    const profile: PermissionProfile = {
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'restricted',
        entries: [
          { kind: 'path', access: 'write', path: '/outside/file.txt', match: 'exact' },
          { kind: 'path', access: 'read', path: '/outside/tree', match: 'subtree' },
        ],
      },
      network: { kind: 'restricted' },
    };
    const result = buildSeatbeltPolicy({
      profile,
      pathContext: { workspaceRoots: ['/repo'] },
    });

    assert.match(result.policy, /\(literal \(param "READABLE_ROOT_0"\)\)/);
    assert.match(result.policy, /\(subpath \(param "READABLE_ROOT_1"\)\)/);
    assert.match(result.policy, /\(literal \(param "WRITABLE_ROOT_0"\)\)/);
    assert.match(result.policy, /\(path-ancestors \(param "READABLE_ROOT_0"\)\)/);
    assert.deepEqual(result.definitionArgs.slice(0, 3), [
      '-DREADABLE_ROOT_0=/outside/file.txt',
      '-DREADABLE_ROOT_1=/outside/tree',
      '-DWRITABLE_ROOT_0=/outside/file.txt',
    ]);
  });

  it('keeps explicit exact deny requirements on every allow clause', () => {
    const profile: PermissionProfile = {
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'restricted',
        entries: [
          { kind: 'path', access: 'write', path: '/outside', match: 'subtree' },
          { kind: 'path', access: 'deny', path: '/outside/locked.txt', match: 'exact' },
        ],
      },
      network: { kind: 'restricted' },
    };

    const policy = buildSeatbeltPolicy({
      profile,
      pathContext: { workspaceRoots: ['/repo'] },
    }).policy;
    assert.match(policy, /\(require-not \(literal "\/outside\/locked\.txt"\)\)/);
  });
});

describe('createSeatbeltExecArgs', () => {
  it('creates sandbox-exec arguments using -p policy, -D roots, -- separator, and inner argv', () => {
    const args = createSeatbeltExecArgs({
      profile: workspaceWriteProfile(),
      pathContext: { workspaceRoots: ['/repo'] },
      innerArgv: ['/bin/zsh', '-lc', 'echo ok'],
    });

    assert.equal(args[0], '-p');
    assert.equal(args[2], '-DREADABLE_ROOT_0=/repo');
    assert.ok(args.includes('-DWRITABLE_ROOT_0=/repo'));
    const separator = args.indexOf('--');
    assert.notEqual(separator, -1);
    assert.deepEqual(args.slice(separator + 1), ['/bin/zsh', '-lc', 'echo ok']);
  });
});

describe('MacosSeatbeltBackend', () => {
  it('wraps inner argv with /usr/bin/sandbox-exec', () => {
    const backend = new MacosSeatbeltBackend();
    const result = backend.transform(workspaceCommand(createWorkspaceWritePermissionProfile()));

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.exec.argv[0], MACOS_SEATBELT_EXECUTABLE);
      assert.equal(result.exec.argv[1], '-p');
      assert.equal(result.exec.sandboxType, 'macos-seatbelt');
      assert.deepEqual(result.exec.argv.slice(-3), ['/bin/zsh', '-lc', 'echo ok']);
    }
  });

  it('keeps a working directory the profile covers', () => {
    const backend = new MacosSeatbeltBackend();
    const result = backend.transform(workspaceCommand(createWorkspaceWritePermissionProfile()));

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.exec.cwd, '/repo');
  });

  it('starts at / when the profile does not cover the working directory', () => {
    // The filesystem worker's shape: one granted target, and the session cwd
    // it is launched from lies outside it.
    const backend = new MacosSeatbeltBackend();
    const request = workspaceCommand({
      type: 'managed',
      name: 'custom',
      fileSystem: {
        kind: 'restricted',
        entries: [
          {
            kind: 'path',
            access: 'read',
            path: '/private/tmp/maka-worker-target',
            match: 'subtree',
          },
        ],
      },
      network: { kind: 'restricted' },
    });
    const result = backend.transform({
      ...request,
      command: { ...request.command, pathContext: { workspaceRoots: [] } },
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.exec.cwd, '/');
  });

  it('returns invalid_request for profiles that should have selected none before reaching backend', () => {
    const backend = new MacosSeatbeltBackend();
    const result = backend.transform(workspaceCommand(createDangerFullAccessPermissionProfile()));

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'invalid_request');
      assert.equal(result.sandboxType, 'macos-seatbelt');
    }
  });
});
