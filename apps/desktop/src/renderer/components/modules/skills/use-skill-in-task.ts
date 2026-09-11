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

// "Use this skill": leave the Skills page holding a new task that already
// invokes it.
//
// Upstream seeded the composer with the SENTENCE "Use the X skill: " and let
// the user finish it. This renderer has the atom the sentence was standing in
// for — `composerReference` with `kind: 'skill'`, the same node
// `ChatInput.insertSkill` writes — so the draft carries the Skill ID that
// actually runs rather than prose that merely mentions its name.
//
// Two rules survive from upstream, and both matter:
//
//   - it APPENDS. A half-written welcome draft is not the page's to discard,
//     and `insertSkill` appends at the caret for the same reason.
//   - it never sends. The user finishes the sentence and presses Enter; a
//     page action that started a turn would be a different, much louder
//     feature than the one the row's menu advertises.

import type { JSONContent } from '@tiptap/core';
import type { DesktopNewTaskTarget } from '../../../bridge/new-tasks.js';
import { composerInputStore } from '../../../store/composer-input-store.js';
import { newTaskStore } from '../../../store/new-task-store.js';
import { sessionsStore } from '../../../store/sessions-store.js';
import { uiStore } from '../../../store/ui-store.js';
// Type-only, and deliberately: importing the composer for one key would pull
// the whole editor — TipTap, the model menu, the workspace picker — into a
// page that renders none of it. The signature is checked against the real
// one; the body is the one line it shares.
import type { newComposerKey } from '../../composer/ChatInput.js';

/** The welcome composer's draft key. Mirrors `newComposerKey` in `ChatInput.tsx`. */
export const newTaskDraftKey: typeof newComposerKey = (target: DesktopNewTaskTarget | undefined) =>
  `new:${JSON.stringify(target ?? null)}`;

function endsOpen(node: JSONContent | undefined): boolean {
  if (!node) return false;
  if (node.type === 'composerReference') return true;
  return node.type === 'text' && !/\s$/u.test(node.text ?? '');
}

/**
 * The same document with one Skill atom appended to its last paragraph.
 *
 * Pure, so the rule that a draft is never clobbered can be asserted without a
 * store. A separating space goes in only when the draft would otherwise run
 * the atom into the word before it; the trailing space is always written,
 * because the caret lands after the chip and the next word should not be
 * glued to it.
 */
export function appendSkillReference(
  document: JSONContent,
  skill: { id: string; name: string },
): JSONContent {
  const atom: JSONContent = {
    type: 'composerReference',
    attrs: { kind: 'skill', value: skill.id, label: skill.name },
  };
  const paragraphs = document.content ?? [];
  const last = paragraphs.at(-1);
  const body = last?.type === 'paragraph' ? (last.content ?? []) : undefined;
  const appended: JSONContent[] = [
    ...(body ?? []),
    ...(endsOpen(body?.at(-1)) ? [{ type: 'text', text: ' ' }] : []),
    atom,
    { type: 'text', text: ' ' },
  ];
  const paragraph: JSONContent = { type: 'paragraph', content: appended };
  return {
    ...document,
    type: 'doc',
    content:
      body === undefined ? [...paragraphs, paragraph] : [...paragraphs.slice(0, -1), paragraph],
  };
}

/**
 * Seed the next task's draft with this skill and go there.
 *
 * The draft is written BEFORE the navigation: the welcome composer reads its
 * draft on mount, and writing after the switch would race a surface that has
 * already rendered an empty field.
 */
export function startTaskWithSkill(skill: { id: string; name: string }): void {
  const key = newTaskDraftKey(newTaskStore.getState().target);
  const draft = composerInputStore.read(key);
  composerInputStore.patch(key, { document: appendSkillReference(draft.document, skill) });
  uiStore.closeSettings();
  uiStore.navigate({ section: 'sessions' });
  sessionsStore.select(undefined);
}
