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
import {
  MakaAutocompleteProvider,
  skillPickerItems,
  slashCommandSpellings,
} from '../pi-tui-pickers.js';

// A skill is named as `/<name>` in the message itself; completion writes the
// skill's id, which is what the model reads and the Skill tool loads.

const commands = [
  { name: 'model', description: 'Switch model' },
  { name: 'new', description: 'New session' },
  { name: 'exit', aliases: ['quit'], description: 'Exit' },
];
const skills = [
  { ref: 'project:maka:pdf', id: 'pdf', name: 'PDF', description: 'Read PDFs' },
  { ref: 'user:maka:model', id: 'model', name: 'Model Notes', description: 'Shadowed by /model' },
  { ref: 'user:maka:quit', id: 'quit', name: 'Quit Smoking', description: 'Shadowed by /quit' },
  { ref: 'user:maka:exit-upper', id: 'Exit', name: 'Exit Interview', description: '' },
  { ref: 'project:maka:deck-helper', id: 'deck-helper', name: 'Deck Helper', description: '' },
];

function provider() {
  return new MakaAutocompleteProvider(undefined, commands, async () => skills);
}

async function suggest(lines: string[], line: number, col: number) {
  return provider().getSuggestions(lines, line, col, { signal: new AbortController().signal });
}

test('a line-start slash lists the commands first, then skills a command does not shadow', async () => {
  const all = await suggest(['/'], 0, 1);
  // An alias shadows as its name does; `/Exit` is not a command, since the
  // submit path matches command spellings exactly.
  assert.deepEqual(
    all?.items.map((item) => item.label),
    ['/model', '/new', '/exit', '/pdf', '/Exit', '/deck-helper'],
  );
  assert.deepEqual([...slashCommandSpellings(commands)], ['model', 'new', 'exit', 'quit']);
  assert.equal(all?.prefix, '/');

  const narrowed = await suggest(['/de'], 0, 3);
  assert.deepEqual(
    narrowed?.items.map((item) => item.value),
    ['deck-helper'],
  );
  // The prefix keeps its `/`, so pi-tui's select-to-submit applies as before.
  const applied = provider().applyCompletion(['/de'], 0, 3, narrowed!.items[0]!, narrowed!.prefix);
  assert.deepEqual(applied, { lines: ['/deck-helper '], cursorLine: 0, cursorCol: 13 });
});

test('a mid-message slash lists skills only and inserts the id after the slash', async () => {
  const instance = provider();
  const lines = ['please /deck'];
  const found = await instance.getSuggestions(lines, 0, 12, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(
    found?.items.map((item) => item.label),
    ['/deck-helper'],
  );
  // No leading `/` in the prefix: selecting inserts and does not submit.
  assert.equal(found?.prefix, 'deck');
  assert.deepEqual(instance.applyCompletion(lines, 0, 12, found!.items[0]!, found!.prefix), {
    lines: ['please /deck-helper '],
    cursorLine: 0,
    cursorCol: 20,
  });
  // A command only runs at line start, so mid-message a skill named like one
  // is offered by its id (and by a name that contains the query).
  assert.deepEqual(
    (await suggest(['please /mod'], 0, 11))?.items.map((item) => item.label),
    ['/model'],
  );
  // Commands themselves are not offered mid-message; nothing matching is null.
  assert.equal(await suggest(['please /ne'], 0, 10), null);
  assert.equal(await suggest(['please /zz'], 0, 10), null);
});

test('skills complete on the first line only', async () => {
  assert.equal(await suggest(['first', '/de'], 1, 3), null);
  assert.deepEqual(
    (await suggest(['first', '/ne'], 1, 3))?.items.map((item) => item.label),
    ['/new'],
  );
});

test('the /skill picker offers ids to insert as /<id>', () => {
  assert.deepEqual(
    skillPickerItems(skills).map((item) => item.value),
    ['pdf', 'model', 'quit', 'Exit', 'deck-helper'],
  );
});
