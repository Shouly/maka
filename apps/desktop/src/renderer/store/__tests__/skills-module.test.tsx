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

// The Skills page's toolbar and rows.
//
// Two kinds of assertion, and the split is deliberate. The rules the toolbar
// applies — what a query reads, what a pill counts, what an order promises —
// are pure functions, and they are asserted as such: they are where the
// behaviour lives, and a DOM would only make them slower to check. The markup
// is asserted for the things a user can lose without a compiler noticing: the
// page contracts the shell keys on, the controls the toolbar gained, and the
// two facts a row used to hide (the declared tools by name, the capability
// warning).
//
// Effects never run under `renderToStaticMarkup`, so a page whose lists are
// `useAsync` reads renders its loading face here. That is exactly what the
// page-level test asserts about: the frame, not the rows. Rows are rendered
// straight from `SkillRows.tsx`, which is why they are a separate module.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import {
  LocaleProvider,
  getSkillsCopy,
  type ManagedSkillUpdatePreview,
  type SkillEntry,
} from '@maka/ui';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { SkillsModule } from '../../components/modules/skills/SkillsModule.js';
import { InstalledSkillRow } from '../../components/modules/skills/SkillRows.js';
import {
  managedUpdateOptions,
  normalizeSkillQuery,
  presentCategories,
  skillMatchesQuery,
  groupSkillsByOrigin,
  skillMatchesOrigin,
  skillOriginCounts,
  sortSkills,
  summarizeDeclaredTools,
} from '../../components/modules/skills/skill-filters.js';
import {
  appendSkillReference,
  newTaskDraftKey,
} from '../../components/modules/skills/use-skill-in-task.js';
import { getModulesCopy } from '../../locales/modules-copy.js';
import { getSkillsPageCopy } from '../../locales/skills-page-copy.js';

const skillsCopy = getSkillsCopy('en');
const modulesCopy = getModulesCopy('en').skills;
const pageCopy = getSkillsPageCopy('en');

function renderTree(node: Parameters<typeof renderToStaticMarkup>[0]) {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, { children: node }),
    }),
  );
  return parseHTML(html).document;
}

function skill(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: 'review-code',
    name: 'Review Code',
    description: 'Reads a diff and says what is wrong with it.',
    path: '/workspace/.maka/skills/review-code/SKILL.md',
    declaredTools: ['Read', 'Grep'],
    sourceType: 'workspace',
    enabled: true,
    runtimeStatus: 'enabled',
    scope: 'project',
    source: 'maka',
    ...overrides,
  };
}

function row(entry: SkillEntry) {
  return renderTree(
    createElement(InstalledSkillRow, {
      skill: entry,
      busy: false,
      copy: modulesCopy,
      skillsCopy,
      page: pageCopy,
      onToggle: () => {},
      onOpen: () => {},
      onUse: () => {},
      onReviewUpdate: () => {},
      onDelete: () => {},
    }),
  );
}

/* ── The toolbar's rules ──────────────────────────────────────────────── */

test('search reads the id and the path, not only the display name', () => {
  const entry = skill();
  assert.equal(skillMatchesQuery(entry, normalizeSkillQuery('  REVIEW ')), true);
  assert.equal(skillMatchesQuery(entry, normalizeSkillQuery('review-code')), true);
  // The path is how a user picks the project copy out of three same-named rows.
  assert.equal(skillMatchesQuery(entry, normalizeSkillQuery('.maka/skills')), true);
  assert.equal(skillMatchesQuery(entry, normalizeSkillQuery('diff')), true);
  assert.equal(skillMatchesQuery(entry, normalizeSkillQuery('nothing here')), false);
  // An empty query is not a filter.
  assert.equal(skillMatchesQuery(entry, normalizeSkillQuery('   ')), true);
});

test('the Yours list is cut into origin sections, the user’s own first, empty ones dropped', () => {
  const rows = [
    skill({ id: 'b', sourceType: 'bundled' }),
    skill({ id: 'w1', sourceType: 'workspace' }),
    skill({ id: 'x', sourceType: undefined }),
    skill({ id: 'w2', sourceType: 'workspace' }),
  ];
  const groups = groupSkillsByOrigin(rows);
  // No source type (a diagnostic) is still the user's own file.
  assert.deepEqual(
    groups.map((group) => group.origin),
    ['workspace', 'bundled'],
  );
  // The order inside a section is the order the rows arrived in.
  assert.deepEqual(
    groups[0].skills.map((entry) => entry.id),
    ['w1', 'x', 'w2'],
  );
  assert.deepEqual(groupSkillsByOrigin([]), []);
  // The filter and the sections read the same field the same way.
  const counts = skillOriginCounts(rows);
  assert.equal(counts.workspace + counts.bundled + counts.managed, counts.all);
  assert.equal(skillMatchesOrigin(rows[2], 'workspace'), true);
  assert.equal(skillMatchesOrigin(rows[0], 'workspace'), false);
});

test('source order is the Host’s own, and name order is stable', () => {
  const rows = [skill({ id: 'b', name: 'Beta' }), skill({ id: 'a', name: 'Alpha' })];
  assert.deepEqual(
    sortSkills(rows, 'source').map((entry) => entry.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    sortSkills(rows, 'name').map((entry) => entry.id),
    ['a', 'b'],
  );
  const tied = [skill({ id: 'first', name: 'Same' }), skill({ id: 'second', name: 'Same' })];
  assert.deepEqual(
    sortSkills(tied, 'name').map((entry) => entry.id),
    ['first', 'second'],
  );
});

test('needs-attention first reads the same ladder the chips read', () => {
  const rows = [
    skill({ id: 'healthy' }),
    skill({ id: 'update', sourceType: 'managed', managedUpdateStatus: 'update_available' }),
    skill({ id: 'broken', runtimeStatus: 'state_error' }),
  ];
  assert.deepEqual(
    sortSkills(rows, 'updates').map((entry) => entry.id),
    ['broken', 'update', 'healthy'],
  );
});

test('the category pills offer each category once, in catalog order', () => {
  const categories = presentCategories(
    [
      {
        id: 'a',
        name: 'A',
        description: '',
        category: '效率工具',
        declaredTools: [],
        installed: false,
      },
      {
        id: 'b',
        name: 'B',
        description: '',
        category: '文档与写作',
        declaredTools: [],
        installed: false,
      },
    ],
    [{ id: 'c', name: 'C', description: '', category: '效率工具', sourceType: 'local' }],
  );
  assert.deepEqual(categories, ['效率工具', '文档与写作']);
});

test('the tool summary names the tools and counts only the tail', () => {
  assert.equal(summarizeDeclaredTools([], 3, pageCopy.detail.moreTools), undefined);
  assert.equal(summarizeDeclaredTools(undefined, 3, pageCopy.detail.moreTools), undefined);
  assert.equal(
    summarizeDeclaredTools(['Read', 'Bash'], 3, pageCopy.detail.moreTools),
    'Read, Bash',
  );
  assert.equal(
    summarizeDeclaredTools(['Read', 'Bash', 'Grep', 'Edit', 'Glob'], 3, pageCopy.detail.moreTools),
    'Read, Bash, Grep, +2 more',
  );
});

/* ── The update the page can now apply ────────────────────────────────── */

function preview(status: SkillEntry['managedUpdateStatus']): ManagedSkillUpdatePreview {
  return {
    skill: {
      id: 'review-code',
      name: 'Review Code',
      description: '',
      path: '/workspace/skills/review-code/SKILL.md',
      declaredTools: [],
      sourceType: 'managed',
      userModified: status === 'local_modified',
      validationStatus: 'ok',
      enabled: true,
      runtimeStatus: 'enabled',
      validationCodes: [],
      validationMessages: [],
      ...(status ? { managedUpdateStatus: status } : {}),
      hasManagedBaseline: true,
    },
    currentContent: 'one\ntwo\n',
    sourceContent: 'one\ntwo\nthree\n',
    expectedCurrentSha256: 'current-digest',
    expectedSourceSha256: 'source-digest',
    summary: { currentLineCount: 2, sourceLineCount: 3, changedLineCount: 1 },
  };
}

test('the apply always carries both digests and forces only what was warned about', () => {
  const plain = managedUpdateOptions(preview('update_available'));
  assert.deepEqual(plain, {
    expectedCurrentSha256: 'current-digest',
    expectedSourceSha256: 'source-digest',
  });
  assert.equal('force' in plain, false, 'an unmodified copy is never force-overwritten');
  assert.deepEqual(managedUpdateOptions(preview('local_modified')), {
    force: true,
    expectedCurrentSha256: 'current-digest',
    expectedSourceSha256: 'source-digest',
  });
});

/* ── "Use this skill" ─────────────────────────────────────────────────── */

test('the welcome draft key is the composer’s own, target and all', () => {
  assert.equal(newTaskDraftKey(undefined), 'new:null');
  assert.equal(
    newTaskDraftKey({ profileId: 'p1', hostId: 'h1', projectId: null }),
    `new:${JSON.stringify({ profileId: 'p1', hostId: 'h1', projectId: null })}`,
  );
});

test('using a skill appends an atom to the draft rather than replacing it', () => {
  const draft = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'half a sentence' }] }],
  };
  const next = appendSkillReference(draft, { id: 'review-code', name: 'Review Code' });
  const paragraph = next.content?.[0];
  assert.equal(next.content?.length, 1, 'the atom joins the draft paragraph, it does not add one');
  assert.deepEqual(paragraph?.content, [
    { type: 'text', text: 'half a sentence' },
    { type: 'text', text: ' ' },
    {
      type: 'composerReference',
      attrs: { kind: 'skill', value: 'review-code', label: 'Review Code' },
    },
    { type: 'text', text: ' ' },
  ]);
  // The original document is untouched: the store is handed a new value.
  assert.deepEqual(draft.content[0].content, [{ type: 'text', text: 'half a sentence' }]);
});

test('an empty draft gets the atom with no leading space', () => {
  const next = appendSkillReference(
    { type: 'doc', content: [{ type: 'paragraph' }] },
    { id: 'a', name: 'A' },
  );
  assert.deepEqual(next.content?.[0]?.content, [
    { type: 'composerReference', attrs: { kind: 'skill', value: 'a', label: 'A' } },
    { type: 'text', text: ' ' },
  ]);
});

/* ── What the row shows ───────────────────────────────────────────────── */

test('a row names its declared tools instead of counting them', () => {
  const document = row(skill({ declaredTools: ['Read', 'Bash', 'Grep', 'Edit'] }));
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Review Code'));
  assert.ok(text.includes('Declared tools: Read, Bash, Grep, +1 more'), text);
  // The scope and the description still lead the meta line.
  assert.ok(text.includes('Project'));
  assert.ok(text.includes('Reads a diff'));
});

test('the row carries the path on the name, for the rows a name cannot tell apart', () => {
  const document = row(skill());
  const trigger = document.querySelector('span[data-state="closed"]');
  assert.ok(trigger, 'the name is a tooltip trigger');
  assert.equal(trigger?.textContent?.trim(), 'Review Code');
});

test('a healthy row carries no origin chip; the section heading already says it', () => {
  for (const sourceType of ['workspace', 'bundled', 'managed'] as const) {
    const document = row(skill({ sourceType, managedUpdateStatus: 'up_to_date' }));
    const text = document.documentElement.textContent ?? '';
    for (const label of [
      skillsCopy.status.local,
      skillsCopy.status.bundled,
      skillsCopy.status.managed.up_to_date,
    ]) {
      assert.equal(text.includes(label), false, `${sourceType}: ${label}`);
    }
  }
  // A local edit is not the origin, so it still shows.
  const edited = row(skill({ sourceType: 'bundled', userModified: true }));
  assert.ok((edited.documentElement.textContent ?? '').includes(skillsCopy.status.modified));
  // Off is said in words next to the title, not only by the switch's colour.
  const off = row(skill({ enabled: false, runtimeStatus: 'disabled' }));
  assert.ok((off.documentElement.textContent ?? '').includes(skillsCopy.status.disabled));
});

test('a host-incompatible skill gets the capability warning, not the plain status', () => {
  const document = row(skill({ contextStatus: 'host_incompatible' }));
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes(skillsCopy.context.decision.host_incompatible), text);
  // One chip, not two saying the same thing.
  assert.equal(
    (text.match(new RegExp(skillsCopy.context.decision.host_incompatible, 'gu')) ?? []).length,
    1,
  );
  const chip = document.querySelector('span[tabindex="0"][data-state="closed"]');
  assert.ok(chip, 'the warning is reachable, so its tooltip is not mouse-only');
});

test('a managed skill with an update says so on the row', () => {
  const document = row(skill({ sourceType: 'managed', managedUpdateStatus: 'update_available' }));
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes(skillsCopy.status.managed.update_available), text);
  // The review is one click away, in the row's menu, and names what it does.
  assert.ok(document.querySelector(`[aria-label="${modulesCopy.rowActions('Review Code')}"]`));
});

/* ── The page ─────────────────────────────────────────────────────────── */

test('the page keeps its contracts and carries the new toolbar controls', () => {
  // A static render never runs effects, so the lists stay in their loading
  // state and no bridge is touched; the toolbar and the contracts are what
  // this checks.
  const document = renderTree(createElement(SkillsModule, {}));
  assert.ok(document.querySelector('[data-maka-contract="module-main"]'), 'the page contract');
  const actions = document.querySelector('[data-maka-contract="module-actions"]');
  assert.ok(actions, 'the actions contract');
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim());
  assert.ok(tabs.includes('Skills'), tabs.join(','));
  assert.ok(tabs.includes('Connectors'));
  // The search collapses to its magnifier until it is opened; the sort is an
  // icon whose menu is headed by its label.
  assert.ok(actions?.querySelector(`[aria-label="${skillsCopy.page.search}"]`), 'search');
  assert.ok(actions?.querySelector(`[aria-label="${pageCopy.filters.trigger}"]`), 'filter');
  assert.ok(actions?.querySelector(`[aria-label="${pageCopy.sort.trigger}"]`), 'sort');
  // The primary is Add ▾, a menu whose first row uploads a SKILL.md; the
  // button carries the Add label, the rows live in the menu.
  assert.ok(
    [...(actions?.querySelectorAll('button') ?? [])].some(
      // The caret after the label is an icon-font glyph, so: starts with.
      (button) => button.textContent?.trim().startsWith(pageCopy.add.label) ?? false,
    ),
    'the primary Add button',
  );
  for (const button of document.querySelectorAll('button')) {
    const named = (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
    assert.ok(named, `every control is named: ${button.outerHTML}`);
  }
});

test('the Skills page speaks all three locales with the same keys', () => {
  const reference = JSON.stringify(shape(getSkillsPageCopy('en')));
  for (const locale of ['zh-CN', 'zh-TW'] as const) {
    assert.equal(JSON.stringify(shape(getSkillsPageCopy(locale))), reference, locale);
  }
});

/** The key tree of a catalog, values dropped, so two locales can be compared. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, shape(entry)]),
    );
  }
  return typeof value;
}
