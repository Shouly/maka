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

import type { TurnViewModel, TransientUserMessageProjection } from '@maka/ui';

/** A pending first prompt precedes its live reply, without inventing a durable Turn. */
export function placeTransientMessages(
  turns: readonly TurnViewModel[],
  messages: readonly TransientUserMessageProjection[],
) {
  const before = new Map<string, TransientUserMessageProjection[]>();
  const tail: TransientUserMessageProjection[] = [];
  const shown = new Set(
    turns.flatMap((turn) => [
      ...(turn.user ? [turn.user.id] : []),
      ...turn.timeline.flatMap((item) => (item.kind === 'user' ? [item.messageId] : [])),
    ]),
  );
  for (const message of messages) {
    if (shown.has(message.id)) continue;
    const turn = message.hostTurnId
      ? turns.find((turn) => turn.turnId === message.hostTurnId)
      : turns.at(-1);
    if (message.transientPlacement === 'current_turn' && turn && !turn.user) {
      before.set(turn.turnId, [...(before.get(turn.turnId) ?? []), message]);
    } else tail.push(message);
  }
  return { before, tail };
}
