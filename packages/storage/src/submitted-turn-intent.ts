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

import { isDeepStrictEqual } from 'node:util';
import {
  isOrchestrationMode,
  isTurnOrchestrationSource,
  type TurnOrchestration,
} from '@maka/core/orchestration';

/**
 * What a submit asked of its Turn beyond the words: the orchestration to run
 * under. Content and placement do not describe it, so this is the rest of
 * what makes a submit the same submit.
 *
 * It is one value and every durable record keeps it whole. A record that kept
 * only a digest it could not rebuild could not answer a retry that arrives
 * after the Host recovered the Message from that record.
 */
export interface SubmittedTurnIntent {
  readonly turnOrchestration: TurnOrchestration;
}

/**
 * Validate an intent from any source — a caller, a durable record, or a JSON
 * column — into the one canonical shape the equality below compares.
 */
export function normalizeSubmittedTurnIntent(value: unknown): SubmittedTurnIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid submitted Turn intent');
  }
  // An intent that asks for nothing is not an intent: a submit without an
  // orchestration override records no intent at all, so `{}` is not a second
  // spelling of that. Every key is exact, so a record from an older shape (one
  // that carried skill ids) is refused rather than read as something else.
  if (!hasExactKeys(value, ['turnOrchestration'])) {
    throw new Error('Invalid submitted Turn intent');
  }
  const { turnOrchestration } = value as { turnOrchestration: unknown };
  if (
    typeof turnOrchestration !== 'object' ||
    turnOrchestration === null ||
    Array.isArray(turnOrchestration) ||
    !hasExactKeys(turnOrchestration, ['mode', 'source']) ||
    !isOrchestrationMode((turnOrchestration as TurnOrchestration).mode) ||
    !isTurnOrchestrationSource((turnOrchestration as TurnOrchestration).source)
  ) {
    throw new Error('Invalid submitted Turn intent orchestration');
  }
  const { mode, source } = turnOrchestration as TurnOrchestration;
  return Object.freeze({ turnOrchestration: Object.freeze({ mode, source }) });
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function submittedTurnIntentsEqual(
  left: SubmittedTurnIntent | undefined,
  right: SubmittedTurnIntent | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return isDeepStrictEqual(left.turnOrchestration, right.turnOrchestration);
}
