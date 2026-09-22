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
 * Renderer-side presentation rules that only Desktop has: which blocked reasons
 * are worth acting on, and what to offer after a turn fails.
 *
 * Separated from the React component layer so the rules can be unit-tested
 * without a DOM, mirroring the `session-health-notice.ts` pattern.
 *
 * Turning a `SessionStatus` into a label and a dot, and a `SessionBlockedReason`
 * into copy, is NOT here — both live in `@maka/ui`'s file of the same name,
 * which is also where the contract that a UI label never shows a raw enum
 * identifier is stated and enforced. This file used to re-export those and
 * document a tone matrix "consumed by both the SessionStatusIcon and the
 * chat-header status badge", naming two consumers that do not exist; the tone
 * layer and the re-exports are gone (#2984).
 */

import { SANDBOX_BOUNDARY_RESTART_CLOSURE_CLASS } from '@maka/core/sandbox-boundary';
import type { SessionBlockedReason, SessionSummary } from '@maka/core/session';
import type { ToolFailureKind } from '@maka/core/events';
import type { ModelRetryDecision } from '@maka/core/model-failure';
import type { UiLocale } from '@maka/core/ui-locale';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import { describeSessionErrorReason } from './session-error-presentation.js';

/**
 * Session-level "blocked" is only worth interrupting the user when
 * they can ACT on it: configure a connection, re-login, or confirm a
 * permission. `tool_failed` / `unknown` mean "the last run's bookkeeping
 * didn't close cleanly" — the conversation itself is intact and
 * retryable, and the failure detail already surfaces on the failed
 * turn inside the chat. Runtime keeps writing the strict status (the
 * #397/#410 terminal-fact invariant is untouched); this is a
 * display-layer distinction only.
 */
const ACTIONABLE_BLOCKED_REASONS: ReadonlySet<SessionBlockedReason> = new Set([
  'NO_REAL_CONNECTION',
  'auth',
  'permission_required',
]);

export function isActionableBlocked(reason: SessionBlockedReason | undefined): boolean {
  return reason !== undefined && ACTIONABLE_BLOCKED_REASONS.has(reason);
}

/**
 * Normalize a SessionSummary as it enters renderer state. Authoritative
 * known-empty live state clears a persisted `running` value that may have
 * survived a crash, while an omitted live state keeps the legacy fallback.
 * Non-actionable blocked sessions read as ordinary resumable sessions
 * (`active`), so every display consumer agrees on the same projection.
 */
export function normalizeSessionSummaryForDisplay<
  T extends SessionSummary & { localState?: 'pending' | 'cached' },
>(session: T): T {
  const liveNormalized: T =
    session.status === 'running' &&
    (session.runningTurnIds?.length === 0 || session.localState === 'cached')
      ? ({ ...session, status: 'active' as const } as T)
      : session;
  if (liveNormalized.status !== 'blocked' || isActionableBlocked(liveNormalized.blockedReason)) {
    return liveNormalized;
  }
  const { blockedReason: _blockedReason, ...rest } = liveNormalized;
  void _blockedReason;
  return { ...rest, status: 'active' } as T;
}

export function describeTurnErrorClass(errorClass: string | undefined, locale: UiLocale): string {
  const copy = getDesktopConversationCopy(locale).turnError;
  if (!errorClass) return copy.unknown;
  const reasonDescription = describeSessionErrorReason(errorClass, locale);
  if (reasonDescription) return reasonDescription;
  switch (errorClass.toLowerCase()) {
    // Before #3758, transport failures could persist their raw code as the class.
    case 'econnreset':
    case 'econnrefused':
    case 'econnaborted':
      return copy.network;
    case SANDBOX_BOUNDARY_RESTART_CLOSURE_CLASS:
      return copy.sandboxBoundaryClosed;
    case 'server_error':
    case 'providerunavailable':
      return copy.provider;
    case 'contextlength':
      return copy.contextOverflow;
    case 'providerbilling':
      return copy.providerBilling;
    case 'providercapacity':
      return copy.providerCapacity;
    case 'ratelimit':
      return copy.rateLimit;
    case 'requestrejected':
      return copy.requestRejected;
    case 'tool_step_cap_reached':
      return copy.stepCap;
    case 'tool_failed':
      return copy.tool;
    case 'permission_required':
      return copy.permission;
    case 'app_restarted':
      return copy.restarted;
    default:
      return copy.unknown;
  }
}

/**
 * How loud a failed turn should look. `warning` is for the outcomes where the
 * work itself survived and the session just needs another nudge — the app
 * restarted mid-turn, the step cap stopped it, a permission prompt outlived
 * its turn. Everything else is an `error`: the user has to fix, pay, wait, or
 * inspect something before the next attempt can differ from this one.
 *
 * The two tiers exist because a single `error` red made "restarted, press
 * continue" look as severe as "billing is blocked". Matches how the rest of
 * the app grades its Banners (`tone === 'destructive' ? 'error' : 'warning'`).
 */
export type FailedTurnSeverity = 'error' | 'warning';

export function deriveFailedTurnSeverity(errorClass: string | undefined): FailedTurnSeverity {
  const lower = errorClass?.toLowerCase() ?? '';
  if (lower === SANDBOX_BOUNDARY_RESTART_CLOSURE_CLASS) return 'warning';
  if (lower === 'app_restarted') return 'warning';
  if (lower === 'tool_step_cap_reached') return 'warning';
  if (lower === 'permission_required' || lower.includes('permission')) return 'warning';
  return 'error';
}

export interface FailedTurnExecutionState {
  retry?: ModelRetryDecision;
  /** Calls that ran without a failure grade — they may already have changed things. */
  ranCount: number;
  /** The grades of the calls that failed, so a refusal is not read as damage. */
  failureKinds: readonly ToolFailureKind[];
}

/**
 * What the reader should do next, given what this turn left behind.
 *
 * Not a report of what went wrong — that is the first sentence
 * (`describeTurnErrorClass`), and this is the second. A reader does not need
 * to know which tool it was or why the runtime declined to retry; they need to
 * know whether anything on disk is half-changed and whether resending is safe.
 * So the branches are ordered by what is at stake rather than by what the
 * runtime happens to record.
 *
 * `failed` outranks everything because it is the loudest evidence that work
 * was left half-done. A refusal ranks below it but is NOT a promise that
 * nothing happened: a Bash command graded `denied` reached that grade from its
 * terminal result (`tool-runtime.ts`, `terminalFailure.sandboxDenied`), so it
 * ran, and it may have written inside the workspace before the sandbox stopped
 * it. The refusal line therefore says the step did not get done, and still
 * sends the reader to look — never that nothing changed.
 *
 * Both facts survive at once — the retired `deriveFailedTurnRecovery()` ranked
 * this against the error class and let this one win, so `auth` plus a failed
 * tool advised "inspect the tool result" and dropped "sign in again", the only
 * step that could change the outcome. The banner has a slot for each, so
 * neither has to lose, and nothing here may contradict the line above it.
 *
 * `side_effects` and `policy` / `budget` have no line of their own: the first
 * is already told by the tool rows, and the other two answer "why was there no
 * automatic retry", which is the runtime's business and not the reader's.
 */
export function describeFailedTurnExecutionState(
  state: FailedTurnExecutionState,
  locale: UiLocale,
): string | undefined {
  const copy = getDesktopConversationCopy(locale).turnError.executionState;
  if (state.failureKinds.includes('failed')) return copy.halfDone;
  if (state.ranCount > 0) return copy.checkChanges;
  if (state.failureKinds.length > 0) return copy.notAllowed;
  // Text the model had already written is the one thing the tool rows cannot
  // show, so the retry decision still carries it.
  if (state.retry?.decision === 'declined' && state.retry.because === 'observable_output') {
    return copy.checkOutput;
  }
  if (state.retry?.decision === 'exhausted') return copy.retriedAlready;
  return undefined;
}
