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

// What the artifact preview scheme answers with, without Electron in the way.
//
// The policy and the 404 rule are the whole security surface of the feature, so
// they live where a test can reach them; `artifact-preview-protocol.ts` is the
// thin binding that hands this to `protocol.handle`.

import type { ArtifactTextReadResult } from '@maka/core/artifacts';

/**
 * The previewed document's own policy.
 *
 * It exists because a document loaded from a local scheme — `srcdoc`, `blob:`,
 * `data:` — inherits the embedder's CSP, and the app's is `script-src 'self'`,
 * which blocks the inline script a single-file artifact is made of. Served
 * under a registered scheme, the response's own policy governs instead, and the
 * app's never has to loosen.
 *
 * What it permits is the whole of what a preview needs: inline script and
 * style, images, fonts and media that travel inside the document, and one
 * outside host — cdnjs, which the reference set allows a delivered file to
 * import scripts from, so a page built around a charting or layout library
 * renders here rather than only in the user's own browser.
 *
 * Everything else stays shut. `default-src 'none'` covers what is not named, so
 * `connect-src` is denied: the page cannot fetch, cannot beacon, and cannot
 * reach any host but that one. `form-action` and `base-uri` close the two ways
 * out that are not a fetch. The document has nothing to leak anyway — its
 * origin is opaque, so it reads no storage, no cookie, and nothing of the
 * app's — but the narrow hole is deliberate and is the only one.
 */
export const ARTIFACT_PREVIEW_SCRIPT_HOST = 'https://cdnjs.cloudflare.com';

export const ARTIFACT_PREVIEW_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${ARTIFACT_PREVIEW_SCRIPT_HOST}`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

export interface ArtifactPreviewResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

const NOT_FOUND: ArtifactPreviewResponse = Object.freeze({
  status: 404,
  body: '',
  headers: Object.freeze({ 'content-type': 'text/plain; charset=utf-8' }),
});

/**
 * A failed read answers 404 rather than surfacing its reason: the frame has no
 * way to show one, and the pane already draws the failure from its own read.
 */
export function artifactPreviewResponse(
  read: ArtifactTextReadResult | null,
): ArtifactPreviewResponse {
  if (!read || !read.ok) return NOT_FOUND;
  return {
    status: 200,
    body: read.text,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': ARTIFACT_PREVIEW_CSP,
      // The document is model output: nothing about it should be sniffed into
      // another type, kept, or referred anywhere.
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  };
}
