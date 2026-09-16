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
//
// A scheme is registered ONCE, for the whole app, while the Host that can read
// a given Session comes and goes — a profile switch or a reconnect builds a new
// client. So the handler is installed once at boot and each owner Host PUBLISHES
// its read here for as long as its IPC is registered; the URL says which one
// answers.

import { protocol } from 'electron';
import { ARTIFACT_PREVIEW_SCHEME, type ArtifactTextReadResult } from '@maka/core/artifacts';
import { artifactPreviewResponse, artifactPreviewTarget } from './artifact-preview-response.js';

export type ArtifactTextReader = (
  sessionId: string,
  artifactId: string,
) => Promise<ArtifactTextReadResult>;

const readers = new Map<string, ArtifactTextReader>();

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

/**
 * Must run once, after `app.ready`. `protocol.handle` throws on a second call
 * for the same scheme, which is why this is not per-Host.
 */
export function installArtifactPreviewProtocol(): void {
  protocol.handle(ARTIFACT_PREVIEW_SCHEME, async (request) => {
    const target = artifactPreviewTarget(request.url);
    const readText = target ? readers.get(target.hostId) : undefined;
    let read: ArtifactTextReadResult | null = null;
    if (target && readText) {
      try {
        read = await readText(target.sessionId, target.artifactId);
      } catch {
        read = null;
      }
    }
    const answer = artifactPreviewResponse(read);
    if (answer.status !== 200) {
      // Only the refusal is worth a line. A frame that stays blank says nothing
      // about whether the URL was wrong, the artifact was gone, or the read
      // failed — and the first version of this shipped broken for exactly that
      // reason.
      console.log(`[artifact-preview] ${request.url} -> ${answer.status}`);
    }
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  });
}

/**
 * One owner Host answers for its own Sessions, for as long as its IPC lives.
 *
 * The read is the caller's own guarded path — this never touches a file. The
 * returned release is idempotent and only ever removes ITS OWN reader, so a
 * disposal that lands after a reconnect cannot unhook the replacement.
 */
export function serveArtifactPreviewsFor(
  hostId: string,
  readText: ArtifactTextReader,
): () => void {
  readers.set(hostId, readText);
  return () => {
    if (readers.get(hostId) === readText) readers.delete(hostId);
  };
}
