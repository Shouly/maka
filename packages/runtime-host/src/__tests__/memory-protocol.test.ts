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
import { describe, test } from 'node:test';
import { MEMORY_FILE_MAX_BYTES } from '@maka/core/memory-filesystem';
import { RuntimeHostProtocolError } from '../protocol/errors.js';
import { decodeClientFrame, decodeHostFrame } from '../protocol/index.js';

const document = {
  path: '/topics/food.md',
  content: '- [stated] drinks tea',
  version: 'abcdef012345',
  byteLength: 21,
  updatedAt: 1_700_000_000_000,
};

describe('Memory protocol', () => {
  test('accepts the closed query and mutation shapes and rejects open ones', () => {
    assert.doesNotThrow(() => request('memory.query', { kind: 'list' }));
    assert.doesNotThrow(() => request('memory.query', { kind: 'read', path: '/profile.md' }));
    assert.doesNotThrow(() =>
      request('memory.mutate', {
        kind: 'write',
        path: '/profile.md',
        content: 'x',
        ifVersion: 'new',
      }),
    );
    assert.doesNotThrow(() =>
      request('memory.mutate', { kind: 'delete', path: '/profile.md', ifVersion: 'abcdef012345' }),
    );

    assert.throws(() => request('memory.query', { kind: 'list', path: '/x.md' }), isInvalidFrame);
    assert.throws(() => request('memory.query', { kind: 'state' }), isInvalidFrame);
    assert.throws(
      () => request('memory.mutate', { kind: 'write', path: '/x.md', content: '' }),
      isInvalidFrame,
    );
    assert.throws(
      () =>
        request('memory.mutate', {
          kind: 'write',
          path: '/x.md',
          content: 'x'.repeat(MEMORY_FILE_MAX_BYTES + 1),
          ifVersion: 'new',
        }),
      isInvalidFrame,
    );
    assert.throws(
      () => request('memory.mutate', { kind: 'delete', path: '/x.md' }),
      isInvalidFrame,
    );
  });

  test('accepts the closed result shapes and rejects open ones', () => {
    assert.doesNotThrow(() =>
      response('memory.query', {
        kind: 'list',
        enabled: true,
        incognitoActive: false,
        directoryPath: '/tmp/root/memory',
        files: [
          {
            path: '/topics/food.md',
            byteLength: 21,
            updatedAt: 1,
            description: 'what they eat',
            aliases: [],
            sources: ['chat'],
          },
        ],
      }),
    );
    assert.doesNotThrow(() => response('memory.query', { kind: 'document', document }));
    assert.doesNotThrow(() => response('memory.query', { kind: 'document', document: null }));
    assert.doesNotThrow(() =>
      mutation({ kind: 'written', version: 'abcdef012345', byteLength: 21 }),
    );
    assert.doesNotThrow(() => mutation({ kind: 'deleted' }));
    assert.doesNotThrow(() =>
      mutation({ kind: 'rejected', reason: 'version_conflict', current: document }),
    );
    assert.doesNotThrow(() => mutation({ kind: 'rejected', reason: 'disabled', current: null }));

    assert.throws(
      () => mutation({ kind: 'rejected', reason: 'invalid_state', current: null }),
      isInvalidFrame,
    );
    assert.throws(() => mutation({ kind: 'written', version: 'abcdef012345' }), isInvalidFrame);
    assert.throws(
      () => response('memory.query', { kind: 'document', document: { ...document, extra: 1 } }),
      isInvalidFrame,
    );
  });

  test('keeps failure codes operation-specific', () => {
    assert.doesNotThrow(() => failure('memory.query', 'persistence_failed'));
    assert.doesNotThrow(() => failure('memory.mutate', 'commit_outcome_unknown'));
    assert.throws(() => failure('memory.query', 'commit_outcome_unknown'), isInvalidFrame);
    assert.throws(() => failure('memory.mutate', 'session_archived'), isInvalidFrame);
  });
});

function request(operation: 'memory.query' | 'memory.mutate', input: unknown): void {
  decodeClientFrame({ requestId: 'request', operation, input });
}

function response(operation: 'memory.query', result: unknown): void {
  decodeHostFrame({ requestId: 'response', operation, ok: true, result });
}

function mutation(result: unknown): void {
  decodeHostFrame({ requestId: 'response', operation: 'memory.mutate', ok: true, result });
}

function failure(operation: 'memory.query' | 'memory.mutate', code: string): void {
  decodeHostFrame({
    requestId: 'response',
    operation,
    ok: false,
    error: { code, message: 'Memory operation failed' },
  });
}

function isInvalidFrame(error: unknown): boolean {
  return error instanceof RuntimeHostProtocolError && error.code === 'invalid_frame';
}
