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
 * Pure model-wait derivation for the two turn-wait cues (#646).
 *
 * A turn has two kinds of "nothing is streaming right now" lulls, and they must
 * read differently:
 *   - `processing` — the connect-to-first-token wait at the turn head, before
 *     any event has arrived. The screen is otherwise empty, so it earns the
 *     prominent "正在处理…" indicator.
 *   - `continuing` — a mid-turn lull AFTER the turn has already produced content
 *     (a tool settled, a step's text finished) while the model works on the next
 *     step. The prior steps are already on screen, so this earns only a calm
 *     "继续中…" hint, never "正在处理…" (which would flicker on after every step
 *     and read as if the live thinking had been swallowed — the #646 regression
 *     this split fixes).
 *
 * The single dimension that separates them is the turn PHASE: `'waiting'` until
 * the first content event, `'streamed'` after. Kept free of React.
 */

/** Rising-edge delay before the first-token processing indicator appears. Tunable. */
export const MODEL_PROCESSING_DELAY_MS = 200;

/**
 * Rising-edge delay before the mid-turn "继续中…" hint appears. Longer than the
 * first-token delay so a quick hop between two fast steps never flashes it — the
 * hint is only worth showing once a step-to-step lull is visibly stalling.
 */
export const MODEL_CONTINUING_DELAY_MS = 600;

/**
 * A turn's coarse phase from the renderer's point of view. Absent (no entry) =
 * no turn in flight. `'waiting'` = armed at send, no content event yet.
 * `'streamed'` = the turn has emitted at least one content event.
 */
export type TurnPhase = 'waiting' | 'streamed';

/**
 * Whether a turn is running for the active session — the Stop affordance, and
 * the composer lock that rides with it.
 *
 * Two witnesses, ORed. They must never be ANDed: the local arm is the only
 * instant one, and gating it on a session-level witness meant a send opened
 * nothing until a status round-trip landed, then had it retracted by any list
 * refresh that resolved before the runtime's `running` write.
 *
 * `runningTurnIds` is read only for turns OTHER than the arm's. For the arm's
 * own turn the local projection knows more — it sees the terminal event first —
 * so a snapshot taken before that event must not light Stop back up. For any
 * other turn (another client, a scheduled task, one still running across a reload)
 * it is the only witness there is. It is a set because a session can run
 * concurrent turns, and the arm's own turn lingering in it must not hide a
 * sibling that is genuinely still running.
 */
export function deriveTurnActive(input: {
  /** The active session's live projection, if this renderer has one. */
  turnPhase: TurnPhase | undefined;
  armedTurnId: string | undefined;
  /** The turns the authority is running for this session, or `undefined` when
   *  the snapshot cannot say. */
  runningTurnIds: readonly string[] | undefined;
  /** The most recent reading that DID carry a set; see `retainRunningTurnIds`. */
  retainedRunningTurnIds?: readonly string[] | undefined;
  /** The turn the local projection saw end; see `rememberEndedTurn`. */
  endedTurnId?: string | undefined;
}): boolean {
  if (input.turnPhase !== undefined) return true;
  const running = input.runningTurnIds ?? input.retainedRunningTurnIds;
  return (
    running?.some((turnId) => turnId !== input.armedTurnId && turnId !== input.endedTurnId) === true
  );
}

/**
 * The turn the local projection saw end, carried after the projection lets it
 * go. The catalog keeps listing that turn as running for a few milliseconds
 * more; with nothing armed left to set it apart, it read as another turn still
 * running and lit the running status and Stop back up for a frame. Forgotten
 * once the catalog stops listing it: there is no lag left to cover.
 */
export function rememberEndedTurn(
  previous: string | undefined,
  live: { readonly turnId: string | undefined; readonly phase: TurnPhase | undefined },
  /** The catalog's last informative running set; see `retainRunningTurnIds`. */
  running: readonly string[] | undefined,
): string | undefined {
  if (live.turnId !== undefined && live.phase === undefined) return live.turnId;
  if (previous !== undefined && running !== undefined && !running.includes(previous)) {
    return undefined;
  }
  return previous;
}

/**
 * Whether a send the Host accepted by opening a turn is still waiting for that
 * turn to be seen. The acceptance lands a few milliseconds before the turn is
 * reported running, and between the two neither witness spoke for it: the
 * running status blinked out for a frame. Only a message the Host names a turn
 * for counts, so this ends when that turn does; a queued message is accepted
 * into a turn already running, which speaks for itself.
 */
export function awaitingAcceptedTurn(input: {
  readonly localMessages: readonly {
    readonly messageId: string;
    readonly state: string;
    readonly turnId?: string;
  }[];
  /** The sent messages still on screen with no delivery trouble. */
  readonly pendingTransientIds: readonly string[];
  readonly endedTurnId: string | undefined;
}): boolean {
  return input.localMessages.some(
    (message) =>
      message.state === 'accepted' &&
      message.turnId !== undefined &&
      message.turnId !== input.endedTurnId &&
      input.pendingTransientIds.includes(message.messageId),
  );
}

/**
 * Carry the last informative running-turn reading across an uninformative one.
 *
 * `runningTurnIds: undefined` is NOT an empty set. `DesktopSessionLocalService`
 * strips the field from every row it serves out of the desktop cache, because a
 * read it could not make authoritative has no standing to say which turns are
 * running — the same reason `settledSessionTransientIds` refuses to settle on
 * one. Those cached reads interleave with authoritative ones on every catalog
 * refresh, so reading `undefined` as "nothing is running" retracts the answer a
 * few milliseconds after the authority gave it.
 *
 * That retraction is invisible for most of a turn, because the live projection
 * answers first. It is NOT invisible before the first token: there is no
 * projection yet, so `runningTurnIds` is the only witness the wait has, and
 * losing it takes the running status line, the Stop affordance and the composer
 * lock with it — each returning only after the rising-edge delay. A session's
 * first turn is where this shows, because naming the Session from its first
 * message fires an extra burst of catalog refreshes right into that window.
 *
 * An uninformative snapshot must therefore leave the previous answer standing.
 * Any reading that carries a set — including an empty one, which is how a
 * finished turn is reported — replaces it.
 */
export function retainRunningTurnIds(
  previous: readonly string[] | undefined,
  snapshot: readonly string[] | undefined,
): readonly string[] | undefined {
  return snapshot ?? previous;
}

export interface ModelWaitInputs {
  /** Turn phase, or undefined when no turn is in flight. */
  turnPhase: TurnPhase | undefined;
  /** Whether the active assistant answer buffer has any content. */
  hasStreamingText: boolean;
  /** Whether the active reasoning buffer has any content. */
  hasThinkingText: boolean;
  /** Whether any live tool is still pending / running / awaiting permission. */
  hasInFlightTools: boolean;
}

/** Which wait cue (if any) the current turn state calls for. */
export type ModelWaitKind = 'none' | 'processing' | 'continuing';

/**
 * Which turn-wait cue to show. `'none'` whenever something is actively on
 * screen (streaming text / reasoning / an in-flight tool) or no turn is in
 * flight. Otherwise the turn is idle-waiting, and the PHASE decides: the
 * first-token head is `'processing'`, every later step-to-step lull is
 * `'continuing'`.
 */
export function deriveModelWait(input: ModelWaitInputs): ModelWaitKind {
  const idle = !input.hasStreamingText && !input.hasThinkingText && !input.hasInFlightTools;
  if (!idle || input.turnPhase === undefined) return 'none';
  return input.turnPhase === 'waiting' ? 'processing' : 'continuing';
}
