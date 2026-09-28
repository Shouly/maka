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
//   ahead of a turn's user text — the user's preferences and who they are,
//                                 the memory snapshot, plugin contexts:
//                                 recorded once and again only on change;
//                                 the date, on every turn but a first one
//                                 whose system prompt names the day
//   after it                     — the environment, the held tools, the agent
//                                 types and the skills, recorded once and
//                                 again on change
//
// Every block is a durable `injection` event, rendered in its place on every
// replay.
//
// The instance holds no conversation state. What was already said is read
// back from the ledger, so a Host restart or a compaction changes nothing
// about what the model is told next.

import type { RuntimeEvent } from '@maka/core/runtime-event';
import {
  collectRecordedInjections,
  planTurnInjections,
  renderInjectionBlock,
  type PlannedInjection,
  type TurnInjectionFacts,
} from './turn-injections.js';

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

  /**
   * The blocks a turn adds, given the ledger so far and what is true now:
   * the date (unless the prompt already names it), anything else only when
   * it moved.
   */
  planTurn(priorEvents: readonly RuntimeEvent[], facts: TurnInjectionFacts): PlannedInjection[] {
    return planTurnInjections(collectRecordedInjections(priorEvents), facts, this.timeZone);
  }

  /** A block as the model reads it. */
  renderBlock(injection: Pick<PlannedInjection, 'text' | 'data'>): string {
    return renderInjectionBlock(injection);
  }
}
