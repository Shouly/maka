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

/**
 * The onboarding snapshot: the Session list and whether each Session's next
 * send can go out. The sidebar marks the Sessions that cannot, a Session's
 * notices say why, and preload seeds the Session catalog from the list.
 *
 * Credential presence is resolved per connection in PARALLEL via
 * `hasCredential`, which covers API-key and OAuth-subscription connections
 * and MUST be read-only: reading the snapshot never refreshes a token or
 * otherwise mutates credential state. Adapters project ordinary read failures
 * to `false` and propagate connection failures before they reach this service.
 */

import { projectSessionSendOutcome, type SessionSendProjection } from '@maka/core/session-send-projection';
import { type SessionSummary } from '@maka/core/session';
import type { ProjectedLlmConnection } from '@maka/core/llm-connections';
import type { LlmConnection } from '@maka/core/llm-connections';

export interface OnboardingSnapshot {
  /** Included so preload can seed the Session catalog without a `sessions:list` IPC. */
  sessions: SessionSummary[];
  sessionSendOutcomes: Record<string, SessionSendProjection>;
}

export interface OnboardingServiceDeps {
  listConnections(): Promise<ProjectedLlmConnection[]>;
  listSessions(): Promise<SessionSummary[]>;
  /**
   * Whether `connection` has a usable credential — an API key OR (for
   * OAuth-subscription providers) a stored OAuth token. MUST be
   * read-only: implementations must not refresh tokens or otherwise
   * mutate credential state as a side effect of this check.
   */
  hasCredential(connection: LlmConnection): Promise<boolean>;
}

export interface OnboardingService {
  getSnapshot(): Promise<OnboardingSnapshot>;
}

/**
 * Build the desktop OnboardingService. The constructor takes injected
 * deps (rather than reading the global stores) so the service is
 * trivially unit-testable: a fake `OnboardingServiceDeps` mirrors the
 * real stores in tests.
 */
export function createOnboardingService(deps: OnboardingServiceDeps): OnboardingService {
  return {
    async getSnapshot(): Promise<OnboardingSnapshot> {
      const [connections, sessions] = await Promise.all([
        deps.listConnections(),
        deps.listSessions(),
      ]);
      // Per-connection credential lookups run in parallel, never serialized:
      // even a handful of serial credential-store reads is noticeable at
      // cold open.
      const secretEntries = await Promise.all(
        connections.map(async (connection) => {
          const hasSecret = await deps.hasCredential(connection);
          return [connection.slug, hasSecret] as const;
        }),
      );
      const secrets: Record<string, boolean> = Object.fromEntries(secretEntries);
      return {
        sessions,
        sessionSendOutcomes: Object.fromEntries(
          sessions.map((session) => [
            session.id,
            projectSessionSendOutcome({
              session,
              connections,
              hasSecret: (slug) => secrets[slug] ?? false,
            }),
          ]),
        ),
      };
    },
  };
}
