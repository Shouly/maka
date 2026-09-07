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
