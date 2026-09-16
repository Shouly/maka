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
import {
  ARTIFACT_ENTITY_ID_MAX_CHARS,
  ARTIFACT_TURN_KEY_MAX_CHARS,
  ARTIFACT_SOURCES,
  canUserDeleteArtifact,
  isArtifactChildResultOutput,
  isArtifactSharedSessionReadable,
  isArtifactUserVisible,
  isArtifactTurnKey,
  isCanonicalArtifactEntityId,
  normalizeArtifactImagePreviewMime,
  normalizeArtifactPreviewImageMime,
  resolveArtifactImagePreview,
} from '../artifacts.js';

describe('canonical Artifact entity identity', () => {
  test('accepts the shared ASCII grammar through the 128-character boundary', () => {
    assert.equal(ARTIFACT_ENTITY_ID_MAX_CHARS, 128);
    assert.equal(isCanonicalArtifactEntityId('Artifact_01-session'), true);
    assert.equal(isCanonicalArtifactEntityId('a'.repeat(ARTIFACT_ENTITY_ID_MAX_CHARS)), true);
  });

  test('rejects values outside the canonical grammar', () => {
    for (const value of ['', 'a'.repeat(ARTIFACT_ENTITY_ID_MAX_CHARS + 1), 'artifact/id', null]) {
      assert.equal(isCanonicalArtifactEntityId(value), false, JSON.stringify(value));
    }
  });
});

describe('Artifact turn key', () => {
  test('accepts bounded opaque turn keys without coupling to synthetic namespaces', () => {
    assert.equal(isArtifactTurnKey('未来:sequence/分支'), true);
    assert.equal(isArtifactTurnKey('x'.repeat(ARTIFACT_TURN_KEY_MAX_CHARS)), true);
  });

  test('rejects empty, unbounded, and control-bearing turn keys', () => {
    for (const value of ['', 'turn\n1', 'x'.repeat(ARTIFACT_TURN_KEY_MAX_CHARS + 1), null]) {
      assert.equal(isArtifactTurnKey(value), false, JSON.stringify(value));
    }
  });
});

describe('Artifact source policy', () => {
  test('keeps workflow-owned evidence out of independent user deletion', () => {
    for (const source of ARTIFACT_SOURCES) {
      assert.equal(
        canUserDeleteArtifact({ source }),
        source === 'tool_result' || source === 'user_upload' || source === 'user_delivery',
        source,
      );
    }
  });

  test('treats a delivered file as a user-owned, shareable deliverable', () => {
    const delivery = { source: 'user_delivery' as const };

    assert.equal(isArtifactUserVisible(delivery), true);
    assert.equal(isArtifactUserVisible({ ...delivery, kind: 'file' }), true);
    assert.equal(canUserDeleteArtifact(delivery), true);
    assert.equal(isArtifactSharedSessionReadable(delivery), true);
    // A delivery is addressed at the user, not at a parent agent's result.
    assert.equal(isArtifactChildResultOutput(delivery), false);
  });
  test('includes produced outputs in child results without leaking internal artifacts', () => {
    assert.equal(isArtifactChildResultOutput({ source: 'tool_result' }), true);
    assert.equal(isArtifactChildResultOutput({ source: 'subagent_writeback' }), true);
    assert.equal(isArtifactChildResultOutput({ source: 'tool_result_archive' }), false);
    assert.equal(isArtifactChildResultOutput({ source: 'user_upload' }), false);
  });

  test('keeps projection artifacts internal, durable, and readable in shared sessions', () => {
    const projection = { source: 'tool_result_projection' as const };

    assert.equal(isArtifactUserVisible(projection), false);
    assert.equal(isArtifactSharedSessionReadable(projection), true);
  });

  test('exposes directly written HTML files while keeping other tool results internal', () => {
    assert.equal(isArtifactUserVisible({ source: 'tool_result', kind: 'html' }), true);
    assert.equal(isArtifactUserVisible({ source: 'tool_result', kind: 'file' }), false);
    assert.equal(isArtifactUserVisible({ source: 'tool_result', kind: 'diff' }), false);
  });
});

describe('SVG previews', () => {
  test('the preview admits an SVG by mime and by extension', () => {
    assert.deepEqual(
      resolveArtifactImagePreview({
        kind: 'image',
        name: 'diagram.svg',
        mimeType: 'image/svg+xml',
      }),
      {
        kind: 'image',
        reason: 'mime_match',
      },
    );
    assert.deepEqual(resolveArtifactImagePreview({ kind: 'image', name: 'diagram.SVG' }), {
      kind: 'image',
      reason: 'ext_fallback',
    });
  });

  test('the model-facing normalizer still refuses it', () => {
    // The durable tool-result projection gates on this one, and an
    // `image/svg+xml` part fails on every provider wire. The preview can take
    // an SVG because it draws it in an `<img>`, where scripts and external
    // subresources are inert; a provider image part has no such guarantee.
    assert.equal(normalizeArtifactImagePreviewMime('image/svg+xml'), null);
    assert.equal(normalizeArtifactImagePreviewMime(undefined, 'diagram.svg'), null);
    assert.equal(normalizeArtifactPreviewImageMime('image/svg+xml'), 'image/svg+xml');
  });

  test('a non-image kind and an oversize payload are refused before the mime is read', () => {
    assert.deepEqual(
      resolveArtifactImagePreview({ kind: 'file', name: 'diagram.svg', mimeType: 'image/svg+xml' }),
      {
        kind: 'unsupported',
        reason: 'kind_disallowed',
      },
    );
    assert.deepEqual(
      resolveArtifactImagePreview({
        kind: 'image',
        name: 'diagram.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: 3 * 1024 * 1024,
      }),
      { kind: 'unsupported', reason: 'oversize' },
    );
  });
});
