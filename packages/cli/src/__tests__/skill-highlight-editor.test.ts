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
import { test } from 'node:test';
import type { EditorTheme, TUI } from '@earendil-works/pi-tui';
import { MakaSkillHighlightEditor } from '../skill-highlight-editor.js';

const plain = (text: string) => text;
const theme = {
  borderColor: plain,
  selectList: {
    selectedPrefix: plain,
    selectedText: plain,
    description: plain,
    scrollInfo: plain,
    noMatch: plain,
  },
} as unknown as EditorTheme;

function rendered(text: string): string {
  const tui = { requestRender() {}, terminal: { rows: 40, columns: 80 } } as unknown as TUI;
  const editor = new MakaSkillHighlightEditor(tui, theme, { paddingX: 0 });
  editor.focused = true;
  editor.setSkillTokenValidator((name) => name === 'pdf');
  editor.setText(text);
  return editor.render(40)[1] ?? '';
}

const accented = (token: string) => new RegExp(`\\x1b\\[[0-9;]*m${token}\\x1b\\[39m`);

test('a skill token is highlighted with the cursor right after it', () => {
  // The inline cursor's escape sequence follows the token directly; it ends
  // the token as whitespace would.
  assert.match(rendered('use /pdf'), accented('/pdf'));
  assert.match(rendered('/pdf'), accented('/pdf'));
  assert.match(rendered('use /pdf now'), accented('/pdf'));
});

test('only a whole-word token that names a skill is highlighted', () => {
  assert.doesNotMatch(rendered('use /pdf, now'), accented('/pdf'));
  assert.doesNotMatch(rendered('use a/pdf now'), accented('/pdf'));
  assert.doesNotMatch(rendered('use /tmp now'), accented('/tmp'));
});
