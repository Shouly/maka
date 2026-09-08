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
 * Shell-facing view types that outlived their components.
 *
 * The enterprise renderer rewrite (Phase 0a) deleted the Astryx surfaces that
 * used to declare these (`chat-view.tsx`, `chat-turn.tsx`, `toast.tsx`,
 * `session-rail-context.tsx`), but each shape is a product model the ported
 * desktop logic still produces or consumes. They live here, in one place, so
 * Phases 1-3 can re-home them next to the stores and components that will own
 * them without another cross-package hunt.
 */

import type { AttachmentRef, DirectoryReference, InlineReference, QuoteRef } from '@maka/core/events';

/** Which grouping the session rail is currently listing. */
export type SessionViewMode = 'conversation' | 'project';

/**
 * What a toast's "copy report" action collects a diagnostic bundle for: a
 * session, one event inside a session's turn, or a Runtime Host profile.
 */
export type ToastDiagnosticTarget =
  | {
      sessionId: string;
      profileId?: never;
      turnId?: never;
      eventId?: never;
    }
  | {
      sessionId: string;
      turnId: string;
      eventId: string;
      profileId?: never;
    }
  | {
      profileId: string;
      sessionId?: never;
      turnId?: never;
      eventId?: never;
    };

/**
 * A user message the client has sent but the Host has not yet turned into a
 * stored one.
 *
 * Deliberately not a `StoredMessage`: a stored one belongs to a Turn, and the
 * Turn identity is exactly what a client does not have while Runtime Host is
 * still deciding what the Message becomes. These are the presentation fields
 * the transcript actually renders, plus `hostTurnId` for the grouping once the
 * Host names one.
 */
export interface TransientUserMessageProjection {
  /**
   * Local delivery state while the Host has not yet acknowledged the Message
   * (upstream #4956): a status line, an optional detail, and the actions the
   * transcript offers (retry, discard). Renderer-only; never persisted.
   */
  deliveryStatus?: string;
  deliveryDetail?: string;
  deliveryActions?: readonly { label: string; onClick(): void }[];
  id: string;
  text: string;
  ts: number;
  attachments?: readonly AttachmentRef[];
  directoryReferences?: readonly DirectoryReference[];
  quotes?: readonly QuoteRef[];
  inlineReferences?: readonly InlineReference[];
  /**
   * Presentation-only placement until canonical transcript grouping arrives:
   * `current_turn` renders beside the tail Turn, `next_turn` below it.
   */
  transientPlacement: 'current_turn' | 'next_turn';
  /** The Host Turn this Message is already bound to, once the Host named one. */
  hostTurnId?: string;
}

/**
 * Lineage badge rendered on a turn, either pointing to its origin or to a
 * descendant. The desktop renderer computes the labels and targets from the
 * lineage map; the transcript renders the badge.
 */
export interface TurnLineageBadge {
  /** Stable key for React. */
  id: string;
  /**
   * Localized label. The UI surfaces it verbatim — the caller is responsible
   * for generalized phrasing (never expose enum identifiers).
   */
  label: string;
  /** Optional tooltip / aria-label override. Falls back to `label`. */
  tooltip?: string;
  /** Click target turn id. The renderer scrolls to and highlights that turn. */
  targetTurnId: string;
  /**
   * Forward = "this turn was retried/regenerated from another";
   * reverse = "another turn descends from this one". The UI shows them in
   * different positions (forward at top, reverse at bottom).
   */
  direction: 'forward' | 'reverse';
}
