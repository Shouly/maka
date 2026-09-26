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

import type { JSONContent } from '@tiptap/core';
import { SKILL_INVOCATION_TOKEN_SOURCE } from '@maka/core/skill-invocation-token';
import { composerWireText } from '@maka/ui';

export interface ComposerDocument {
  text: string;
  workspaceFileReferences: { value: string; start: number }[];
}
export function textDocument(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}
/**
 * The same text, with every `/<name>` that names a catalog skill turned back
 * into a Skill atom.
 *
 * A draft that comes back as a string — history recall, a restored draft, a
 * revision rollback — has lost its atoms, and the wire form of an atom is just
 * text. Upstream redraws the same tokens against its live catalog; this is
 * that, as a pure function.
 *
 * A token names a skill by id first, then by display name, as the Host reads
 * it; one the catalog does not know STAYS TEXT, so no chip claims a Skill that
 * is not there (`/tmp` is a path). File mentions are not redrawn — `@word` in
 * a recalled prompt is not evidence the user ever picked that file.
 *
 * The text is never rewritten, only re-typed: an atom keeps the token as it
 * was written and serializes back through it, so the result yields the string
 * that came in, byte for byte.
 */
export function documentWithSkillTokens(
  text: string,
  skills: readonly { id: string; name: string }[],
): JSONContent {
  if (skills.length === 0) return textDocument(text);
  const byId = new Map(skills.map((skill) => [skill.id.toLowerCase(), skill]));
  const byName = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill]));
  const lineContent = (line: string): JSONContent[] => {
    const content: JSONContent[] = [];
    let at = 0;
    for (const match of line.matchAll(new RegExp(SKILL_INVOCATION_TOKEN_SOURCE, 'g'))) {
      const written = match[1];
      const skill = byId.get(written.toLowerCase()) ?? byName.get(written.toLowerCase());
      if (!skill) continue;
      if (match.index > at) content.push({ type: 'text', text: line.slice(at, match.index) });
      content.push({
        type: 'composerReference',
        attrs: { kind: 'skill', value: written, label: skill.name },
      });
      at = match.index + match[0].length;
    }
    if (at < line.length) content.push({ type: 'text', text: line.slice(at) });
    return content;
  };
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const nodes = lineContent(line);
      return { type: 'paragraph', ...(nodes.length ? { content: nodes } : {}) };
    }),
  };
}

/**
 * Whether the draft opens with a Skill atom. The atom's wire text is its
 * `/<name>`, which reads the same as a typed command; the atom is how the user
 * said they picked a skill, so a draft that opens with one is never a command.
 */
export function startsWithSkillReference(doc: JSONContent): boolean {
  let found: boolean | undefined;
  const visit = (node: JSONContent) => {
    if (found !== undefined) return;
    if (node.type === 'text') {
      if ((node.text ?? '').trim()) found = false;
    } else if (node.type === 'composerReference') {
      found = node.attrs?.kind === 'skill';
    } else {
      for (const child of node.content ?? []) visit(child);
    }
  };
  visit(doc);
  return found === true;
}

/**
 * One traversal produces text and reference offsets so tokens cannot drift away from their wire positions.
 *
 * A Skill atom's `/<name>` is a token only as a whole word, so an atom that
 * touches other text — typed right after it, or a second atom — is kept apart
 * by one space. Without it the model would read `use/writer` and no chip
 * would come back. A document drawn from text never needs one, so a recalled
 * prompt still serializes byte for byte.
 */
export function serializeComposer(doc: JSONContent): ComposerDocument {
  let text = '';
  let afterSkill = false;
  const refs: ComposerDocument['workspaceFileReferences'] = [];
  const append = (piece: string) => {
    if (!piece) return;
    if (afterSkill && !/^\s/u.test(piece)) text += ' ';
    afterSkill = false;
    text += piece;
  };
  const visit = (node: JSONContent) => {
    if (node.type === 'text') append(node.text ?? '');
    else if (node.type === 'hardBreak') append('\n');
    else if (node.type === 'composerReference') {
      const value = String(node.attrs?.value ?? '');
      if (node.attrs?.kind === 'file') {
        const token = `@${value}`;
        append(token);
        refs.push({ value: token, start: text.length - token.length });
        return;
      }
      if (text && !afterSkill && !/\s$/u.test(text)) text += ' ';
      append(`/${value}`);
      afterSkill = true;
    } else {
      for (const child of node.content ?? []) visit(child);
    }
  };
  for (const [i, node] of (doc.content ?? []).entries()) {
    if (i) append('\n');
    visit(node);
  }
  const leading = text.replace(/ /g, ' ').length - text.replace(/ /g, ' ').trimStart().length;
  return {
    text: composerWireText(text),
    workspaceFileReferences: refs.map((ref) => ({ ...ref, start: ref.start - leading })),
  };
}
