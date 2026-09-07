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

// Everything a turn shows that is not the turn's own content.
//
// Ported from the original shell's `app-shell-turn-view-model.ts`, cache and
// all. The footer actions, the lineage badges and the failed-turn labels are
// derived from the SAME `TurnViewModel[]` the transcript renders, never from a
// second pass over the raw message log: two derivations of "what happened in
// this turn" is how a footer starts offering to regenerate a turn the
// transcript has already replaced.
//
// The cache is a `WeakMap` keyed on the turn object, which only works because
// `transcript-projection.ts` hands the previous object back for a turn whose
// value did not change. A relaxation there breaks this here — see the note on
// `valuesEqual`.

import { useRef } from 'react';
import type { UiLocale } from '@maka/core/ui-locale';
import {
  deriveTurnLineageMap,
  finalAssistantReplyText,
  formatTurnDuration,
  isSandboxDeniedTool,
  type TurnLineageBadge,
  type TurnLineageTarget,
  type TurnViewModel,
} from '@maka/ui';
import {
  describeFailedTurnExecutionState,
  describeTurnErrorClass,
  deriveFailedTurnSeverity,
  type FailedTurnSeverity,
} from '../lib/ported/session-status-presentation.js';
import {
  deriveTurnFooterActions,
  type TurnFooterAction,
  type TurnFooterActionId,
} from '../lib/ported/turn-footer-actions.js';
import { deriveTurnLineageBadges } from '../lib/ported/derive-turn-lineage-badges.js';
import { latestInterruptedResumeTurnId } from '../lib/ported/interrupted-resume.js';

/** Everything outside the turn list that the per-turn presentation depends on. */
export interface TurnPresentationContext {
  readonly activeId: string | undefined;
  /** `"<sessionId>:<turnId>:<actionId>"` for every footer action in flight. */
  readonly pendingTurnActions: ReadonlySet<string>;
  readonly uiLocale: UiLocale;
}

export interface TurnPresentation {
  readonly footerActionsByTurn: Readonly<Record<string, readonly TurnFooterAction[]>>;
  readonly failedReasonLabels: Readonly<Record<string, string>>;
  readonly failedSeverities: Readonly<Record<string, FailedTurnSeverity>>;
  readonly failedExecutionStateLabels: Readonly<Record<string, string>>;
  readonly lineageBadgesByTurn: Readonly<Record<string, TurnLineageBadge[]>>;
  /** The tail turn a safe resume would continue, when there is one. */
  readonly resumeCandidateTurnId?: string;
}

export interface TurnPresentationDerivation {
  derive(turns: readonly TurnViewModel[], context: TurnPresentationContext): TurnPresentation;
}

/** What one turn contributes to the presentation; cached against that turn. */
interface TurnPresentationEntry {
  footerActions: readonly TurnFooterAction[];
  lineageBadges?: TurnLineageBadge[];
  failedReasonLabel?: string;
  failedSeverity?: FailedTurnSeverity;
  failedExecutionStateLabel?: string;
}

const PENDING_ACTION_IDS = ['regenerate', 'branch', 'copy'] as const;

export function pendingTurnActionKey(
  sessionId: string,
  turnId: string,
  action: TurnFooterActionId,
): string {
  return `${sessionId}:${turnId}:${action}`;
}

/**
 * A turn whose only failure was the sandbox refusing an action is not a failed
 * turn in the sense the reason label means — the tool rows already say
 * "blocked by sandbox" and offer the way past it, so a banner repeating it as
 * a turn-level error would name the same fact twice and offer nothing.
 */
function isSandboxOnlyToolFailure(turn: TurnViewModel): boolean {
  const erroredTools = turn.tools.filter((tool) => tool.status === 'errored');
  if (erroredTools.length === 0 || !erroredTools.every(isSandboxDeniedTool)) return false;
  const errorClass = turn.errorClass?.toLowerCase();
  return (
    errorClass === undefined ||
    errorClass === 'unknown' ||
    errorClass === 'tool_failed' ||
    errorClass === 'sandbox_denial' ||
    errorClass === 'sandbox_denied'
  );
}

export function createTurnPresentationDerivation(): TurnPresentationDerivation {
  let cache = new WeakMap<TurnViewModel, { key: string; entry: TurnPresentationEntry }>();
  let lastTurns: readonly TurnViewModel[] | undefined;
  let lastActiveId: string | undefined;
  let lastPendingTurnActions: ReadonlySet<string> | undefined;
  let lastUiLocale: UiLocale | undefined;
  let lastResult: TurnPresentation | undefined;

  function derive(
    turns: readonly TurnViewModel[],
    context: TurnPresentationContext,
  ): TurnPresentation {
    if (
      lastResult &&
      turns === lastTurns &&
      context.activeId === lastActiveId &&
      context.pendingTurnActions === lastPendingTurnActions &&
      context.uiLocale === lastUiLocale
    ) {
      // Idempotent for identical inputs, so calling this during render stays
      // safe under React's double invocation.
      return lastResult;
    }
    // The locale is baked into every cached label, so it invalidates wholesale
    // rather than participating in the per-turn key.
    if (context.uiLocale !== lastUiLocale) cache = new WeakMap();

    const lineage = deriveTurnLineageMap(turns);
    const turnIds = new Set(turns.map((turn) => turn.turnId));
    const existsTurn = (id: string) => turnIds.has(id);
    const footerActionsByTurn: Record<string, readonly TurnFooterAction[]> = {};
    const failedReasonLabels: Record<string, string> = {};
    const failedSeverities: Record<string, FailedTurnSeverity> = {};
    const failedExecutionStateLabels: Record<string, string> = {};
    const lineageBadgesByTurn: Record<string, TurnLineageBadge[]> = {};

    for (const turn of turns) {
      const lineageEntry = lineage.get(turn.turnId);
      const pendingForTurn = new Set<TurnFooterActionId>();
      for (const id of PENDING_ACTION_IDS) {
        if (
          context.activeId &&
          context.pendingTurnActions.has(pendingTurnActionKey(context.activeId, turn.turnId, id))
        ) {
          pendingForTurn.add(id);
        }
      }
      // Everything that can move while the turn object does not: the links
      // pointing AT this turn (a later regeneration), whether the turn it
      // points back at is still present, and its own pending actions.
      const key = [
        lineageEntry?.retriedToTurnId ?? '',
        lineageEntry?.regeneratedToTurnId ?? '',
        turn.retriedFromTurnId && existsTurn(turn.retriedFromTurnId) ? '1' : '0',
        turn.regeneratedFromTurnId && existsTurn(turn.regeneratedFromTurnId) ? '1' : '0',
        [...pendingForTurn].sort().join(','),
      ].join('�');
      const cached = cache.get(turn);
      let entry: TurnPresentationEntry;
      if (cached && cached.key === key) {
        entry = cached.entry;
      } else {
        entry = deriveTurnPresentationEntry({
          turn,
          lineageEntry,
          pendingForTurn,
          existsTurn,
          uiLocale: context.uiLocale,
        });
        cache.set(turn, { key, entry });
      }

      footerActionsByTurn[turn.turnId] = entry.footerActions;
      if (entry.lineageBadges) lineageBadgesByTurn[turn.turnId] = entry.lineageBadges;
      if (entry.failedReasonLabel !== undefined) {
        failedReasonLabels[turn.turnId] = entry.failedReasonLabel;
      }
      if (entry.failedSeverity !== undefined) failedSeverities[turn.turnId] = entry.failedSeverity;
      if (entry.failedExecutionStateLabel !== undefined) {
        failedExecutionStateLabels[turn.turnId] = entry.failedExecutionStateLabel;
      }
    }

    const resumeCandidateTurnId = latestInterruptedResumeTurnId(turns);
    lastTurns = turns;
    lastActiveId = context.activeId;
    lastPendingTurnActions = context.pendingTurnActions;
    lastUiLocale = context.uiLocale;
    lastResult = {
      footerActionsByTurn,
      failedReasonLabels,
      failedSeverities,
      failedExecutionStateLabels,
      lineageBadgesByTurn,
      ...(resumeCandidateTurnId ? { resumeCandidateTurnId } : {}),
    };
    return lastResult;
  }

  return { derive };
}

function deriveTurnPresentationEntry(input: {
  turn: TurnViewModel;
  lineageEntry: TurnLineageTarget | undefined;
  pendingForTurn: ReadonlySet<TurnFooterActionId>;
  existsTurn(id: string): boolean;
  uiLocale: UiLocale;
}): TurnPresentationEntry {
  const { turn, lineageEntry, pendingForTurn, uiLocale } = input;
  const metaParts: string[] = [];
  if (turn.modelId) metaParts.push(turn.modelId);
  // Below a second there is nothing to report: a turn's duration counts whole
  // seconds, so a 300ms turn would read "0s" — a number that says less than no
  // number at all.
  if (turn.durationMs && turn.durationMs >= 1_000) {
    metaParts.push(formatTurnDuration(turn.durationMs));
  }
  if (turn.tokens?.costUsd && turn.tokens.costUsd > 0) {
    metaParts.push(`$${turn.tokens.costUsd.toFixed(4)}`);
  }
  const metaSummary = metaParts.length > 0 ? metaParts.join(' · ') : undefined;
  const footerActions = deriveTurnFooterActions({
    status: turn.status,
    locale: uiLocale,
    hasContent: finalAssistantReplyText(turn).trim().length > 0,
    // Match the badge lineage rule (regenerate ?? legacy retry) so a turn that
    // already has a parallel answer hints at it in the tooltip too.
    ...((lineageEntry?.regeneratedToTurnId ?? lineageEntry?.retriedToTurnId)
      ? { alreadyRegenerated: true }
      : {}),
    ...(pendingForTurn.size > 0 ? { pendingActions: pendingForTurn } : {}),
    ...(metaSummary ? { metaSummary } : {}),
  });

  const entry: TurnPresentationEntry = { footerActions };

  if (turn.status === 'failed' && !isSandboxOnlyToolFailure(turn)) {
    entry.failedReasonLabel = describeTurnErrorClass(turn.errorClass, uiLocale);
    entry.failedSeverity = deriveFailedTurnSeverity(turn.errorClass);
    const executionState = describeFailedTurnExecutionState(
      {
        partialOutputRetained: turn.partialOutputRetained,
        toolActivityCount: turn.tools.length,
        erroredToolCount: turn.tools.filter((tool) => tool.status === 'errored').length,
      },
      uiLocale,
    );
    if (executionState) entry.failedExecutionStateLabel = executionState;
  }

  const lineageBadges = deriveTurnLineageBadges({
    turnId: turn.turnId,
    ...(turn.retriedFromTurnId ? { retriedFromTurnId: turn.retriedFromTurnId } : {}),
    ...(turn.regeneratedFromTurnId ? { regeneratedFromTurnId: turn.regeneratedFromTurnId } : {}),
    ...(lineageEntry?.retriedToTurnId ? { retriedToTurnId: lineageEntry.retriedToTurnId } : {}),
    ...(lineageEntry?.regeneratedToTurnId
      ? { regeneratedToTurnId: lineageEntry.regeneratedToTurnId }
      : {}),
    existsTurn: input.existsTurn,
    locale: uiLocale,
  });
  if (lineageBadges.length > 0) entry.lineageBadges = lineageBadges;

  return entry;
}

/**
 * One-shot derivation, for callers with no render loop to keep state across —
 * tests and fixtures. It throws the cache away every call, which is the entire
 * optimization; components use the hook.
 */
export function deriveTurnPresentation(
  turns: readonly TurnViewModel[],
  context: TurnPresentationContext,
): TurnPresentation {
  return createTurnPresentationDerivation().derive(turns, context);
}

/**
 * The transcript's presentation source. What matters is that the derivation —
 * and therefore its cache — survives across renders, which is why it lives in
 * a ref rather than being rebuilt in the render body.
 */
export function useTurnPresentation(
  turns: readonly TurnViewModel[],
  context: TurnPresentationContext,
): TurnPresentation {
  const derivation = useRef<TurnPresentationDerivation | undefined>(undefined);
  derivation.current ??= createTurnPresentationDerivation();
  return derivation.current.derive(turns, context);
}
