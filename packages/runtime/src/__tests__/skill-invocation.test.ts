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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { INLINE_REFERENCE_MAX_COUNT } from '@maka/core/events';
import {
  listInvocableSkills,
  SKILL_INVOCATION_TOKEN_SOURCE,
  skillInlineReferences,
} from '../skill-invocation.js';
import {
  resolveSkillDiscoveryPaths,
  scanSkillsWithDiagnostics,
  writeSkillRuntimeState,
  type HostCapabilities,
} from '../skills.js';

function tokens(text: string): string[] {
  return [...text.matchAll(new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, 'g'))].map((m) => m[1]);
}

describe('skill invocation', () => {
  it('reads a /<name> token only as a whole word', () => {
    assert.deepEqual(tokens('/pdf convert this'), ['pdf']);
    assert.deepEqual(tokens('please /pdf\nthen /data.analyze'), ['pdf', 'data.analyze']);
    assert.deepEqual(tokens('/pdf'), ['pdf']);
    // Paths, URLs and punctuation-glued words are not tokens.
    assert.deepEqual(tokens('cd /usr/bin && ls a/b https://x/y'), []);
    assert.deepEqual(tokens('use /pdf, then stop'), []);
    assert.deepEqual(tokens('/skill:pdf'), []);
  });

  it('lists only enabled, host-eligible skills as slim entries', async () => {
    await withWorkspace(async (workspaceRoot, homeDir) => {
      await writeSkill(
        workspaceRoot,
        'plain-helper',
        `---
name: Plain Helper
description: Helps with plain things.
---
# Plain Helper
Do plain things.`,
      );
      await writeSkill(
        workspaceRoot,
        'gated-helper',
        `---
name: Gated Helper
description: Needs a host-specific tool.
required-tools: [ImaginaryTool]
---
# Gated Helper
Do gated things.`,
      );
      await writeSkill(
        workspaceRoot,
        'off-helper',
        `---
name: Off Helper
description: Disabled by workspace state.
---
# Off Helper`,
      );
      await writeSkillRuntimeState(workspaceRoot, new Map([['off-helper', false]]));

      const source = resolveSkillDiscoveryPaths(workspaceRoot, workspaceRoot, homeDir);
      const all = await listInvocableSkills(source);
      assert.deepEqual(
        all.map((skill) => skill.id).sort(),
        ['gated-helper', 'plain-helper'],
        'disabled skills are not invocable',
      );
      assert.deepEqual(
        Object.keys(all[0] ?? {}).sort(),
        ['description', 'id', 'name', 'ref'],
        'slim entries only',
      );

      const host: HostCapabilities = { toolNames: new Set(['Read', 'Write']) };
      const gated = await listInvocableSkills(source, host);
      assert.deepEqual(
        gated.map((skill) => skill.id),
        ['plain-helper'],
        'required-tools mismatch is hidden',
      );

      const gatedHost: HostCapabilities = { toolNames: new Set(['Read', 'ImaginaryTool']) };
      const eligible = await listInvocableSkills(source, gatedHost);
      assert.deepEqual(eligible.map((skill) => skill.id).sort(), ['gated-helper', 'plain-helper']);
    });
  });

  it('discovers skills across all standard paths with first-found-wins dedupe', async () => {
    await withWorkspace(async (workspaceRoot, homeDir) => {
      const projectDir = join(workspaceRoot, 'project');
      await writeSkillAt(
        projectDir,
        '.agents',
        'skills',
        'project-skill',
        `---
name: Project Skill
description: Project level.
---
# Project Skill`,
      );
      await writeSkillAt(
        projectDir,
        '.agents',
        'skills',
        'shadowed',
        `---
name: Project Shadow
description: Project copy wins.
---
# Project Shadow`,
      );
      await writeSkill(
        workspaceRoot,
        'shadowed',
        `---
name: Workspace Shadow
description: Workspace copy loses.
---
# Workspace Shadow`,
      );

      const source = resolveSkillDiscoveryPaths(projectDir, workspaceRoot, homeDir);
      const listed = await listInvocableSkills(source);
      const shadowed = listed.find((skill) => skill.id === 'shadowed');
      assert.deepEqual(listed.map((skill) => skill.id).sort(), ['project-skill', 'shadowed']);
      assert.equal(shadowed?.name, 'Project Shadow');
      assert.equal(shadowed?.ref, 'project:agents:shadowed');
    });
  });

  it('reads a token as a skill id before a display name', async () => {
    await withWorkspace(async (workspaceRoot, homeDir) => {
      await writeSkill(workspaceRoot, 'pdf', '---\nname: Portable Docs\ndescription: P.\n---\n# P');
      await writeSkill(workspaceRoot, 'pdf-tools', '---\nname: pdf\ndescription: T.\n---\n# T');
      const source = resolveSkillDiscoveryPaths(workspaceRoot, workspaceRoot, homeDir);
      const { inventory } = await scanSkillsWithDiagnostics(source);
      assert.deepEqual(
        skillInlineReferences({ text: '/pdf /PDF /Portable', inventory }).map((ref) => [
          ref.value,
          ref.label,
        ]),
        [
          ['/pdf', 'Portable Docs'],
          ['/PDF', 'Portable Docs'],
        ],
      );
    });
  });

  it('marks only the tokens that name an invocable skill, for the transcript', async () => {
    await withWorkspace(async (workspaceRoot, homeDir) => {
      await writeSkill(
        workspaceRoot,
        'deck-helper',
        '---\nname: Deck Helper\ndescription: Decks.\n---\n# Deck',
      );
      await writeSkill(
        workspaceRoot,
        'off-helper',
        '---\nname: Off Helper\ndescription: Disabled.\n---\n# Off',
      );
      await writeSkill(
        workspaceRoot,
        'gated-helper',
        '---\nname: Gated\ndescription: Needs a tool.\nrequired-tools: [ImaginaryTool]\n---\n# G',
      );
      await writeSkillRuntimeState(workspaceRoot, new Map([['off-helper', false]]));
      const source = resolveSkillDiscoveryPaths(workspaceRoot, workspaceRoot, homeDir);
      const { inventory } = await scanSkillsWithDiagnostics(source);
      const host: HostCapabilities = { toolNames: new Set(['Read']) };

      const text = '/deck-helper make slides, see /tmp/x then /off-helper and /gated /Gated';
      assert.deepEqual(skillInlineReferences({ text, inventory, host }), [
        { kind: 'skill', value: '/deck-helper', label: 'Deck Helper', start: 0 },
      ]);
      // Without a host gate the gated skill is invocable, by id or by name.
      assert.deepEqual(
        skillInlineReferences({ text: 'x /gated-helper /Gated', inventory }).map((ref) => [
          ref.value,
          ref.label,
          ref.start,
        ]),
        [
          ['/gated-helper', 'Gated', 2],
          ['/Gated', 'Gated', 16],
        ],
      );
      assert.deepEqual(skillInlineReferences({ text: 'no tokens here', inventory }), []);
      // A token is a whole word: punctuation glued to it keeps it text.
      assert.deepEqual(
        skillInlineReferences({ text: 'run /deck-helper, then /deck-helper.', inventory }),
        [],
      );

      const many = Array.from(
        { length: INLINE_REFERENCE_MAX_COUNT + 5 },
        () => '/deck-helper',
      ).join(' ');
      assert.equal(
        skillInlineReferences({ text: many, inventory }).length,
        INLINE_REFERENCE_MAX_COUNT,
      );
    });
  });
});

// Tests pass an isolated homeDir so real user-level skills (~/.maka, ~/.agents)
// on the dev machine never leak into discovery results.
async function withWorkspace(
  fn: (workspaceRoot: string, homeDir: string) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'maka-runtime-skill-invocation-'));
  const homeDir = await mkdtemp(join(tmpdir(), 'maka-runtime-skill-invocation-home-'));
  try {
    await fn(workspaceRoot, homeDir);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function writeSkill(workspaceRoot: string, id: string, content: string): Promise<void> {
  await writeSkillAt(workspaceRoot, 'skills', id, content);
}

async function writeSkillAt(root: string, ...segmentsAndContent: string[]): Promise<void> {
  const content = segmentsAndContent[segmentsAndContent.length - 1];
  const segments = segmentsAndContent.slice(0, -1);
  const id = segments[segments.length - 1];
  const dir = join(root, ...segments.slice(0, -1), id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), content, 'utf8');
}
