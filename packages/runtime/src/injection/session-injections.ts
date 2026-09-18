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

// Everything the system says into a session's conversation that is not the
// system prompt, in one place:
//
//   ahead of a turn's user text — the durable blocks (`injection` events):
//                                 contexts, held tools, session facts, date;
//                                 recorded once and again only on change
//   on every user message        — the moment it was sent, rendered from the
//                                 message's own timestamp, never stored
//
// The instance holds no conversation state. What was already said is read
// back from the ledger, so a Host restart or a compaction changes nothing
// about what the model is told next.

import type { RuntimeEvent } from '@maka/core/runtime-event';
import { wrapSystemReminder } from './system-reminder.js';
import {
  collectRecordedInjections,
  planTurnInjections,
  type PlannedInjection,
  type TurnInjectionFacts,
} from './turn-injections.js';
import { renderMessageSentReminder } from './user-message-injections.js';

export interface SessionInjectionsInput {
  readonly sessionId: string;
  /** IANA zone of the user's machine; UTC when unknown. */
  readonly timeZone?: string;
}

export class SessionInjections {
  readonly sessionId: string;
  readonly timeZone: string | undefined;

  constructor(input: SessionInjectionsInput) {
    this.sessionId = input.sessionId;
    this.timeZone = input.timeZone;
  }

  // ── ahead of the turn's user text ──────────────────────────────────────

  /**
   * The blocks a turn adds, given the ledger so far and what is true now.
   * Empty on a turn where nothing moved, which is most turns.
   */
  planTurn(priorEvents: readonly RuntimeEvent[], facts: TurnInjectionFacts): PlannedInjection[] {
    return planTurnInjections(collectRecordedInjections(priorEvents), facts, this.timeZone);
  }

  /** A block as the model reads it. */
  renderBlock(injection: Pick<PlannedInjection, 'text'>): string {
    return wrapSystemReminder(injection.text);
  }

  // ── on every user message ──────────────────────────────────────────────

  /** The reminders a user message sent at `ts` carries ahead of its text. */
  userMessageReminders(ts: number): string[] {
    return [
      renderMessageSentReminder({ ts, ...(this.timeZone ? { timeZone: this.timeZone } : {}) }),
    ];
  }
}
