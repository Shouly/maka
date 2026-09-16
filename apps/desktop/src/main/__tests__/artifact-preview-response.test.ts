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

// The artifact preview's security surface, as assertions.
//
// Every claim here is one the feature rests on: the served policy is what keeps
// a running artifact from reaching the network, and the 404 is what keeps a
// crafted URL from reading anything at all.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactPreviewUrl, parseArtifactPreviewUrl } from '@maka/core/artifacts';
import { desktopSessionKey } from '../../shared/runtime-host-identity.js';
import {
  ARTIFACT_PREVIEW_CSP,
  ARTIFACT_PREVIEW_SCRIPT_HOST,
  artifactPreviewResponse,
  artifactPreviewTarget,
} from '../artifact-preview-response.js';

test('the preview URL round-trips exactly the two ids it carries', () => {
  const url = artifactPreviewUrl('session/one', 'Artifact_01');
  assert.deepEqual(parseArtifactPreviewUrl(url), {
    sessionId: 'session/one',
    artifactId: 'Artifact_01',
  });
});

test('a URL that is not exactly this scheme and shape is refused', () => {
  for (const url of [
    'https://preview/session/Artifact_01',
    'maka-artifact://elsewhere/session/Artifact_01',
    'maka-artifact://preview/session',
    'maka-artifact://preview/session/Artifact_01/extra',
    'maka-artifact://preview//Artifact_01',
    'maka-artifact://preview/session/not%20canonical',
    'not a url',
  ]) {
    assert.equal(parseArtifactPreviewUrl(url), null, url);
  }
});

test('the URL names the Host that can answer it, not just the Session', () => {
  // What the renderer holds is the Desktop key, so that is what the URL
  // carries; the Host is told its OWN id back. Passing the key through was the
  // 404 every HTML preview answered with.
  const key = desktopSessionKey({ hostId: 'host-a', sessionId: 'session-1' });
  assert.deepEqual(artifactPreviewTarget(artifactPreviewUrl(key, 'Artifact_01')), {
    hostId: 'host-a',
    sessionId: 'session-1',
    artifactId: 'Artifact_01',
  });
});

test('a session segment that is not a Desktop key is refused, not thrown at', () => {
  for (const session of ['session-1', '[]', '["host"]', '["host","a","b"]', '["host",""]', '{}']) {
    assert.equal(artifactPreviewTarget(artifactPreviewUrl(session, 'Artifact_01')), null, session);
  }
  assert.equal(artifactPreviewTarget('https://preview/x/y'), null);
});

test('the served policy runs the page and opens exactly one host', () => {
  // Scripts and styles inline, because a single-file artifact IS inline.
  assert.match(ARTIFACT_PREVIEW_CSP, /script-src 'unsafe-inline'/u);
  assert.match(ARTIFACT_PREVIEW_CSP, /style-src 'unsafe-inline'/u);
  // Everything not named is denied, which is what closes fetch and beacons.
  assert.match(ARTIFACT_PREVIEW_CSP, /default-src 'none'/u);
  assert.doesNotMatch(ARTIFACT_PREVIEW_CSP, /connect-src/u);
  // The two ways out that are not a fetch.
  assert.match(ARTIFACT_PREVIEW_CSP, /form-action 'none'/u);
  assert.match(ARTIFACT_PREVIEW_CSP, /base-uri 'none'/u);
  // And NO `frame-ancestors`: its `'self'` is this response's own origin, so
  // it refused the very frame the preview exists to fill.
  assert.doesNotMatch(ARTIFACT_PREVIEW_CSP, /frame-ancestors/u);

  // cdnjs is the ONE outside host, and only for scripts. Every other https
  // source in the policy would be a second hole, so the count is the assertion.
  assert.equal(ARTIFACT_PREVIEW_SCRIPT_HOST, 'https://cdnjs.cloudflare.com');
  assert.deepEqual(ARTIFACT_PREVIEW_CSP.match(/https:\/\/[^ ;]+/gu), [
    ARTIFACT_PREVIEW_SCRIPT_HOST,
  ]);
  const scriptSrc = ARTIFACT_PREVIEW_CSP.split('; ').find((d) => d.startsWith('script-src '));
  assert.equal(scriptSrc, `script-src 'unsafe-inline' ${ARTIFACT_PREVIEW_SCRIPT_HOST}`);
});

test('a served artifact carries the policy, and a failed read carries nothing', () => {
  const served = artifactPreviewResponse({ ok: true, text: '<p>hi</p>' });
  assert.equal(served.status, 200);
  assert.equal(served.body, '<p>hi</p>');
  assert.equal(served.headers['content-security-policy'], ARTIFACT_PREVIEW_CSP);
  assert.equal(served.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(served.headers['x-content-type-options'], 'nosniff');

  for (const read of [null, { ok: false as const, reason: 'not_found' as const }]) {
    const refused = artifactPreviewResponse(read);
    assert.equal(refused.status, 404);
    assert.equal(refused.body, '');
    // No policy header on a refusal, because there is no document to govern.
    assert.equal(refused.headers['content-security-policy'], undefined);
  }
});
