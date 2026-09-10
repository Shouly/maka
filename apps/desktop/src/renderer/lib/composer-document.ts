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
import { composerWireText } from '@maka/ui';

export interface ComposerDocument {
  text: string;
  skillIds: string[];
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
 * The same text, with every `/skill:<name>` the catalog recognizes turned back
 * into a Skill atom.
 *
 * A draft that comes back as a string — history recall, a restored draft, a
 * revision rollback — has lost the atoms that carry Skill ids, and the wire
 * form of an atom is just text. Sending that runs no Skill while looking
 * exactly like the prompt that did. Upstream redraws the same tokens against
 * its live catalog; this is that, as a pure function.
 *
 * A token the catalog does not know STAYS TEXT: no chip may claim a Skill that
 * will not resolve. Longest name first, so `/skill:Review` cannot take the
 * front of `/skill:Review Code`. File mentions are not redrawn — `@word` in a
 * recalled prompt is not evidence the user ever picked that file.
 *
 * The text is never rewritten, only re-typed: serializing the result yields
 * the string that came in, byte for byte.
 */
export function documentWithSkillTokens(
  text: string,
  skills: readonly { id: string; name: string }[],
): JSONContent {
  if (!text.includes('/skill:') || skills.length === 0) return textDocument(text);
  const ordered = [...skills].sort((left, right) => right.name.length - left.name.length);
  const lower = text.toLowerCase();
  const lineContent = (line: string, offset: number): JSONContent[] => {
    const content: JSONContent[] = [];
    let plain = '';
    let at = 0;
    while (at < line.length) {
      const start = line.indexOf('/skill:', at);
      if (start === -1) break;
      const nameAt = offset + start + '/skill:'.length;
      // By NAME only, which is the form the serializer writes. Matching an id
      // as well would let a redraw rewrite `/skill:review` as `/skill:Review`:
      // a recall must send the same bytes it sent before, with the ids back.
      const match = ordered.find((skill) => lower.startsWith(skill.name.toLowerCase(), nameAt));
      if (!match) {
        plain += line.slice(at, start + '/skill:'.length);
        at = start + '/skill:'.length;
        continue;
      }
      plain += line.slice(at, start);
      if (plain) content.push({ type: 'text', text: plain });
      plain = '';
      // The label is the text as written, not the catalog's casing: the atom
      // serializes back through its label, and a redraw that "corrects" the
      // case has edited the prompt. The id, which is what runs, is the
      // catalog's.
      const written = line.slice(
        start + '/skill:'.length,
        start + '/skill:'.length + match.name.length,
      );
      content.push({
        type: 'composerReference',
        attrs: { kind: 'skill', value: match.id, label: written },
      });
      at = start + '/skill:'.length + match.name.length;
    }
    plain += line.slice(at);
    if (plain) content.push({ type: 'text', text: plain });
    return content;
  };
  let offset = 0;
  const content: JSONContent[] = [];
  for (const line of text.split('\n')) {
    const nodes = lineContent(line, offset);
    content.push({ type: 'paragraph', ...(nodes.length ? { content: nodes } : {}) });
    offset += line.length + 1;
  }
  return { type: 'doc', content };
}

/** One traversal produces text and reference offsets so tokens cannot drift away from their wire positions. */
export function serializeComposer(doc: JSONContent): ComposerDocument {
  let text = '';
  const skillIds: string[] = [];
  const refs: ComposerDocument['workspaceFileReferences'] = [];
  const visit = (node: JSONContent) => {
    if (node.type === 'text') text += node.text ?? '';
    else if (node.type === 'hardBreak') text += '\n';
    else if (node.type === 'composerReference') {
      const value = String(node.attrs?.value ?? '');
      const token =
        node.attrs?.kind === 'file' ? `@${value}` : `/skill:${node.attrs?.label ?? value}`;
      if (node.attrs?.kind === 'file') refs.push({ value: token, start: text.length });
      else skillIds.push(value);
      text += token;
    } else {
      for (const child of node.content ?? []) visit(child);
    }
  };
  for (const [i, node] of (doc.content ?? []).entries()) {
    if (i) text += '\n';
    visit(node);
  }
  const leading = text.replace(/ /g, ' ').length - text.replace(/ /g, ' ').trimStart().length;
  return {
    text: composerWireText(text),
    skillIds: [...new Set(skillIds)],
    workspaceFileReferences: refs.map((ref) => ({ ...ref, start: ref.start - leading })),
  };
}
