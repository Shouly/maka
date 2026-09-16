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

// Binding the artifact preview scheme to Electron.
//
// The preview used to be `<iframe sandbox="" srcdoc>`: nothing executed, so a
// page with a button was a picture of a button. Two things had to change
// together, and neither alone is enough:
//
//   THE POLICY. A `srcdoc` document inherits the embedder's CSP, and the app's
//   is `script-src 'self'`, so an artifact's inline script was blocked no
//   matter what the sandbox said. A registered scheme is not a local scheme, so
//   the response's own policy governs — see `artifact-preview-response.ts`.
//
//   THE SANDBOX. `allow-scripts` and never `allow-same-origin`. The pair is
//   worth no sandbox at all (the framed document can reach its own frame
//   element and drop the attribute), and apart is exactly what is wanted here:
//   scripts run, and the document's origin stays opaque, so it can read no
//   storage, no cookie and nothing of the app's.

import { protocol } from 'electron';
import {
  ARTIFACT_PREVIEW_SCHEME,
  parseArtifactPreviewUrl,
  type ArtifactTextReadResult,
} from '@maka/core/artifacts';
import { artifactPreviewResponse } from './artifact-preview-response.js';

/**
 * Must run before `app.ready`, from module evaluation.
 *
 * `standard` gives the scheme ordinary URL parsing, `secure` keeps it a secure
 * context so the APIs a real page has are present; fetch and CORS stay off
 * because nothing is ever meant to request this URL except a frame.
 */
export function registerArtifactPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARTIFACT_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        allowServiceWorkers: false,
        stream: false,
      },
    },
  ]);
}

/** Reads go through the caller's own guarded path — this never touches a file. */
export function installArtifactPreviewProtocol(deps: {
  readText: (sessionId: string, artifactId: string) => Promise<ArtifactTextReadResult>;
}): void {
  protocol.handle(ARTIFACT_PREVIEW_SCHEME, async (request) => {
    const target = parseArtifactPreviewUrl(request.url);
    let read: ArtifactTextReadResult | null = null;
    if (target) {
      try {
        read = await deps.readText(target.sessionId, target.artifactId);
      } catch {
        read = null;
      }
    }
    const answer = artifactPreviewResponse(read);
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  });
}
