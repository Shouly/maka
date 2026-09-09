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
import test from 'node:test';
import { serializeComposer, textDocument } from '../../lib/composer-document.js';
import { createComposerInputStore } from '../composer-input-store.js';
import { createComposerDraftStore } from '../composer-draft-store.js';
import { preflightAttachmentItems } from '../../lib/ported/attachment-preflight.js';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT } from '@maka/core/attachments';
import { createInteractionFormDrafts, buildInteractionFormResponse } from '@maka/ui';
import type { FormRequestEvent } from '@maka/core/events';

// The tests run under Node: the default store would touch `localStorage`,
// which does not exist here, so every store below gets an explicit storage.
const memoryStorage = () => {
  let saved: string | null = null;
  return {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
};

test('composer serializes references with offsets after whitespace normalization', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '  Read\u00a0' },
          {
            type: 'composerReference',
            attrs: { kind: 'file', value: 'src/a b.ts', label: 'src/a b.ts' },
          },
          { type: 'text', text: ' and ' },
          {
            type: 'composerReference',
            attrs: { kind: 'skill', value: 'immutable-skill', label: 'review' },
          },
        ],
      },
    ],
  };
  const result = serializeComposer(doc);
  assert.equal(result.text, 'Read @src/a b.ts and /skill:review');
  assert.deepEqual(result.workspaceFileReferences, [{ value: '@src/a b.ts', start: 5 }]);
  assert.deepEqual(result.skillIds, ['immutable-skill']);
});
test('paragraphs and hard breaks retain their wire newlines', () => {
  assert.equal(serializeComposer(textDocument('one\ntwo\n\nthree')).text, 'one\ntwo\n\nthree');
});
test('pending send cannot erase newer typing, files or directory references', () => {
  const store = createComposerInputStore(memoryStorage());
  store.setText('a', 'sent');
  const dir = { hostId: 'host', path: '/a' };
  store.patch('a', { directories: [dir] });
  const sent = store.read('a');
  store.setText('a', 'new');
  const next = { hostId: 'host', path: '/b' };
  store.patch('a', { directories: [dir, next] });
  store.acknowledge('a', sent);
  assert.equal(serializeComposer(store.read('a').document).text, 'new');
  assert.deepEqual(store.read('a').directories, [next]);
});
test('admission retry identity survives first-session transfer and outcome_unknown', () => {
  const store = createComposerInputStore(memoryStorage());
  store.setText('new', 'hello');
  const revision = store.read('new').revision,
    id = store.reserveIntent('new', revision);
  store.transfer('new', 'session');
  store.patch('session', { error: 'unknown' });
  assert.equal(store.reserveIntent('session', store.read('session').revision), id);
  store.setText('session', 'different');
  assert.notEqual(store.reserveIntent('session', store.read('session').revision), id);
});
test('draft and quote ownership follows only the intended newly created session', () => {
  const store = createComposerInputStore(memoryStorage());
  store.setText('a', 'A');
  store.setText('b', 'B');
  store.transfer('a', 'new-A');
  assert.equal(serializeComposer(store.read('b').document).text, 'B');
  assert.equal(serializeComposer(store.read('new-A').document).text, 'A');
  const quotes = createComposerDraftStore();
  const quote = quotes.addQuote('a', { text: 'quoted' });
  quotes.transferQuotes('a', 'new-A');
  assert.equal(quotes.quotesFor('new-A')[0]?.id, quote?.id);
  assert.equal(quotes.quotesFor('a').length, 0);
});
test('draft text and folder references persist across store recreation, attachments do not', () => {
  let saved: string | null = null;
  const storage = {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
  const first = createComposerInputStore(storage);
  first.setText('s1', 'kept across restart');
  first.patch('s1', { directories: [{ hostId: 'host', path: '/kept' }] });
  first.patch('s1', {
    attachments: [
      {
        stagingKey: 'a',
        displayName: 'a.txt',
        kind: 'file',
        size: 1,
        source: { type: 'retained', attachment: { id: 'a', kind: 'file', name: 'a.txt' } },
      } as never,
    ],
  });
  first.setText('empty', '');
  const second = createComposerInputStore(storage);
  assert.equal(serializeComposer(second.read('s1').document).text, 'kept across restart');
  assert.deepEqual(second.read('s1').directories, [{ hostId: 'host', path: '/kept' }]);
  assert.equal(second.read('s1').attachments.length, 0);
  assert.equal(second.read('empty').revision, 0);
  assert.ok(!(saved ?? '').includes('"empty"'));
  // Sending clears the persisted copy too.
  second.acknowledge('s1', second.read('s1'));
  const third = createComposerInputStore(storage);
  assert.equal(serializeComposer(third.read('s1').document).text, '');
});

test('persistence stays bounded: at most 32 drafts survive', () => {
  let saved: string | null = null;
  const storage = {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
  const store = createComposerInputStore(storage);
  for (let i = 0; i < 40; i++) store.setText(`k${i}`, `draft ${i}`);
  const reopened = createComposerInputStore(storage);
  assert.equal(Object.keys(reopened.getState().drafts).length, 32);
  assert.equal(serializeComposer(reopened.read('k39').document).text, 'draft 39');
  assert.equal(serializeComposer(reopened.read('k0').document).text, '');
});

test('attachment preflight rejects oversized files and aggregate count before session creation', () => {
  assert.throws(
    () =>
      preflightAttachmentItems([
        {
          size: MAX_ATTACHMENT_BYTES + 1,
          source: { type: 'file', file: { size: MAX_ATTACHMENT_BYTES + 1 } },
        },
      ]),
    /attachment_ingest:item_too_large/,
  );
  assert.throws(
    () =>
      preflightAttachmentItems(
        Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, () => ({
          size: 1,
          source: { type: 'retained' as const },
        })),
      ),
    /attachment_ingest:count_limit/,
  );
});
test('form submission preserves false, omits absent optionals, and rejects invalid integers', () => {
  const request = {
    type: 'form_request',
    requestId: 'r',
    id: 'e',
    turnId: 't',
    ts: 1,
    toolUseId: 'tool',
    message: 'form',
    requester: { name: 'tester' },
    fields: [
      { kind: 'boolean', name: 'enabled', label: 'Enabled', required: true },
      { kind: 'string', name: 'optional', label: 'Optional', required: false },
      { kind: 'integer', name: 'count', label: 'Count', required: true, minimum: 1, maximum: 3 },
    ],
  } satisfies FormRequestEvent;
  const drafts = createInteractionFormDrafts(request.fields);
  drafts[2] = { included: true, value: '1.5' };
  assert.equal(buildInteractionFormResponse(request, drafts), null);
  drafts[2] = { included: true, value: '2' };
  assert.deepEqual(buildInteractionFormResponse(request, drafts), {
    requestId: 'r',
    action: 'accept',
    values: { enabled: false, count: 2 },
  });
});

test('a refused first send restores the welcome draft without overwriting newer work', () => {
  const store = createComposerInputStore(memoryStorage());
  store.setText('welcome', 'first request');
  store.transfer('welcome', 'session');
  assert.equal(store.restoreTransfer('session', 'welcome'), true);
  assert.equal(serializeComposer(store.read('welcome').document).text, 'first request');
  store.transfer('welcome', 'session');
  store.setText('welcome', 'new request');
  assert.equal(store.restoreTransfer('session', 'welcome'), false);
  assert.equal(serializeComposer(store.read('welcome').document).text, 'new request');
  assert.equal(serializeComposer(store.read('session').document).text, 'first request');
});
