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

// Everything the transcript has to say about the conversation rather than in
// it: will the next send work, is the workspace still there, did the last run
// stop halfway, is the event stream still arriving, what did compaction do.
//
// One region rather than one banner per source, and it renders in a fixed
// order, because these overlap: a session whose connection is gone is also a
// session whose readiness probe fails, and stacking both says one thing twice.
// The order below is worst-first, and each rule already declines to fire when
// a more specific one owns the case (see `deriveTaskReadinessNotice`, which
// leaves model blockers to the health notice).

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { ContextCompactionOutcome } from '@maka/core/events';
import type { TaskSubmissionReadinessSnapshot } from '@maka/core/task-submission-readiness';
import { getConversationCopy, resumeParkToastCopy, useUiLocale } from '@maka/ui';
import { toastApi } from '../../../store/toast-api.js';
import { getShellCopy } from '../../../locales/shell-copy.js';
import { getTaskReadinessSnapshot } from '../../../bridge/task-readiness.js';
import {
  activeSessionStore,
  connectionsStore,
  onboardingStore,
  sessionsStore,
  turnActionsStore,
} from '../../../store/index.js';
import { pendingActionsOf } from '../../../store/turn-actions-store.js';
import { deriveSessionHealthNotice } from '../../../lib/ported/session-health-notice.js';
import { deriveWorkspaceReadinessRecovery } from '../../../lib/ported/workspace-readiness-recovery.js';
import { deriveTaskReadinessNotice } from '../../../lib/ported/task-readiness-notice.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { NoticeCard } from './NoticeCard.js';

/**
 * The Host's readiness answer for THIS session.
 *
 * Read here rather than in a store because it has exactly one reader and no
 * subscription: readiness changes when the user acts on it, and the retry
 * action is what asks again.
 */
function useSessionReadiness(sessionId: string): {
  snapshot: TaskSubmissionReadinessSnapshot | undefined;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<TaskSubmissionReadinessSnapshot | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);
    void getTaskReadinessSnapshot(undefined, sessionId)
      .then((result) => {
        if (!cancelled) setSnapshot(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, nonce]);
  return { snapshot, refresh: () => setNonce((value) => value + 1) };
}

function compactionText(
  outcome: ContextCompactionOutcome,
  copy: ReturnType<typeof getTranscriptCopy>['notices'],
): { tone: 'info' | 'warning'; text: string } {
  if (outcome.kind === 'compacted') return { tone: 'info', text: copy.compactionDone };
  if (outcome.kind === 'unchanged') {
    return { tone: 'info', text: copy.compactionUnchanged(outcome.reason) };
  }
  return { tone: 'warning', text: copy.compactionFailed(outcome.reason) };
}

export function SessionNotices(props: {
  sessionId: string;
  /** The tail turn a safe resume would continue, from the turn presentation. */
  resumeCandidateTurnId?: string;
  onOpenModelPicker: () => void;
  onOpenSettings: (section?: 'models' | 'projects') => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const session = useStore(sessionsStore, (state) =>
    state.sessions.find((row) => row.id === props.sessionId),
  );
  const onboarding = useStore(onboardingStore, (state) => state.snapshot);
  const connections = useStore(connectionsStore, (state) => state.data);
  const connectionsLoading = useStore(connectionsStore, (state) => state.loading);
  const health = useStore(activeSessionStore, (state) => state.health);
  // Phase 3b answers these; until then the transcript at least says one is
  // waiting, so a session that has stopped for an answer does not read as a
  // session that has hung.
  const awaitingAnswer = useStore(
    activeSessionStore,
    (state) => (state.interactions[props.sessionId]?.length ?? 0) > 0,
  );
  const compaction = useStore(activeSessionStore, (state) => state.compactionOutcome);
  const transcriptError = useStore(activeSessionStore, (state) =>
    state.sessionId === props.sessionId ? state.transcriptError : undefined,
  );
  const transcriptLoading = useStore(activeSessionStore, (state) => state.loading);
  const pending = useStore(turnActionsStore, (state) => pendingActionsOf(state, props.sessionId));
  const readiness = useSessionReadiness(props.sessionId);
  const [dismissedCompaction, setDismissedCompaction] = useState<
    ContextCompactionOutcome | undefined
  >(undefined);

  const sendOutcome = onboarding?.sessionSendOutcomes?.[props.sessionId];
  const healthNotice = deriveSessionHealthNotice({
    locale,
    session,
    outcome: sendOutcome,
    connections: connections?.connections ?? [],
    hasModelChoices: (connections?.chatModelChoices.length ?? 0) > 0,
    modelChoicesSettled: connections !== undefined && !connectionsLoading,
    modelPickerDisabled: session?.status === 'running',
    lastTestStatus: undefined,
  });

  // The ported rule refuses to fire when a session is active, because the
  // session's own send projection is more specific. Here that projection is
  // `healthNotice`, and it is present or it is not — so the suppression is
  // expressed as "a more specific notice already speaks" rather than as "a
  // session is open", which in this surface is always true and would make the
  // recovery unreachable. Deviation recorded in the phase report.
  const workspace = deriveWorkspaceReadinessRecovery({
    state: onboarding?.state,
    locale,
    activeSessionId: undefined,
    showOnboardingHero: healthNotice !== undefined,
  });

  const readinessNotice = deriveTaskReadinessNotice(readiness.snapshot, locale);
  const streamStatus = health?.status;
  const resuming = pending.includes('resume');
  const compactionNotice =
    compaction && compaction !== dismissedCompaction
      ? compactionText(compaction, copy.notices)
      : undefined;

  const anything =
    transcriptError !== undefined ||
    awaitingAnswer ||
    healthNotice ||
    workspace ||
    readinessNotice ||
    props.resumeCandidateTurnId ||
    streamStatus === 'stale' ||
    streamStatus === 'closed' ||
    compactionNotice;
  if (!anything) return null;

  return (
    <div
      className="flex flex-col gap-2"
      role="region"
      aria-label={copy.notices.ariaLabel}
      data-maka-contract="session-notices"
    >
      {transcriptError !== undefined && (
        <NoticeCard
          tone="destructive"
          title={copy.notices.transcriptLoadFailed}
          description={copy.notices.transcriptLoadFailedDetail}
          actions={[
            {
              label: copy.notices.retry,
              disabled: transcriptLoading,
              onClick: () => activeSessionStore.retryTranscript(),
            },
          ]}
        />
      )}

      {awaitingAnswer && (
        <div data-maka-contract="interaction-pending">
          <NoticeCard
            tone="warning"
            role="status"
            title={getConversationCopy(locale).composer.awaitingPermission}
          />
        </div>
      )}

      {healthNotice && (
        <NoticeCard
          tone={healthNotice.tone}
          title={healthNotice.label}
          {...(healthNotice.tooltip ? { description: healthNotice.tooltip } : {})}
          actions={[
            healthNotice.onClickTarget === 'model_picker'
              ? {
                  label: healthNotice.actionLabel ?? copy.notices.chooseModel,
                  onClick: props.onOpenModelPicker,
                  disabled: healthNotice.actionDisabled === true,
                }
              : healthNotice.onClickTarget === 'model_choices_refresh'
                ? {
                    label: healthNotice.actionLabel ?? copy.notices.retry,
                    onClick: () => void connectionsStore.refresh(),
                  }
                : {
                    label: copy.notices.openSettings,
                    onClick: () => props.onOpenSettings('models'),
                  },
          ]}
        />
      )}

      {workspace && (
        <NoticeCard
          tone={workspace.tone}
          title={workspace.title}
          description={workspace.description}
          actions={[
            // Every onboarding recovery target — the provider catalog, the
            // models page, one connection — lives on the same Settings page.
            { label: workspace.actionLabel, onClick: () => props.onOpenSettings('models') },
          ]}
        />
      )}

      {readinessNotice && (
        <NoticeCard
          tone={readinessNotice.tone}
          title={readinessNotice.title}
          description={readinessNotice.description}
          actions={[
            {
              label: readinessNotice.actionLabel,
              onClick: () => {
                if (readinessNotice.action === 'workspace_picker') props.onOpenSettings('projects');
                else readiness.refresh();
              },
            },
          ]}
        />
      )}

      {props.resumeCandidateTurnId && (
        <NoticeCard
          tone="warning"
          title={copy.notices.resumeTitle}
          description={copy.notices.resumeDescription}
          actions={[
            {
              label: copy.notices.resumeAction,
              disabled: resuming,
              onClick: () => {
                const sessionId = props.sessionId;
                const shellCopy = getShellCopy(locale).app;
                void turnActionsStore
                  .resume(sessionId)
                  .then((result) => {
                    // A parked resume is an answer, not a no-op: the Host
                    // says why it will not continue this turn.
                    if (result.disposition === 'park') {
                      const park = resumeParkToastCopy(result.rejectionReasons, locale);
                      toastApi.error(park.title, park.description, undefined, { sessionId });
                      return;
                    }
                    toastApi.info(shellCopy.resumeStartedTitle, shellCopy.resumeStartedDescription);
                  })
                  .catch((error: unknown) => {
                    toastApi.error(
                      shellCopy.resumeFailedTitle,
                      error instanceof Error ? error.message : shellCopy.resumeFailedFallback,
                      undefined,
                      { sessionId },
                    );
                  });
              },
            },
          ]}
        />
      )}

      {(streamStatus === 'stale' || streamStatus === 'closed') && (
        <NoticeCard
          tone="warning"
          role="status"
          title={
            streamStatus === 'closed' ? copy.notices.streamStalled : copy.notices.streamDegraded
          }
        />
      )}

      {compactionNotice && (
        <NoticeCard
          tone={compactionNotice.tone}
          role="status"
          title={compactionNotice.text}
          actions={[
            {
              label: copy.notices.dismiss,
              onClick: () => setDismissedCompaction(compaction),
            },
          ]}
        />
      )}
    </div>
  );
}
