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

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { StoredMessage } from '@maka/core/session';
import {
  useTranscriptProjection,
  useUiLocale,
  type LiveTurnProjection,
  type TurnViewModel,
} from '@maka/ui';
import { deriveLiveTurnSnapshot } from '../lib/ported/live-turn-snapshot.js';
import { RUNNING_STATUS_DELAY_MS, deriveTurnActive } from '../lib/ported/model-wait-state.js';
import { useDelayedFlag } from './use-delayed-flag.js';
import {
  activeSessionStore,
  sessionsStore,
  settingsStore,
  projectsStore,
  connectionsStore,
  hostScopeStore,
  startRendererStores,
  uiStore,
} from '../store/index.js';

/**
 * The Runtime Host every un-pinned read in the renderer resolves against: the
 * selected task's Host while one is open, the default Host otherwise.
 *
 * Exported because Settings (Phase 5) has to write to the SAME Host the rest
 * of the renderer is reading from — two answers to "which Host" is how a
 * settings page ends up showing one machine's values and saving to another's.
 */
export function useScopedRuntimeHost(): { profileId: string; hostId: string } | undefined {
  const activeId = useStore(sessionsStore, (s) => s.activeId);
  const selectedHost = useStore(
    sessionsStore,
    useShallow((s) => {
      const row = s.sessions.find((session) => session.id === s.activeId);
      return row ? { hostId: row.runtimeHostId, profileId: row.profileId } : undefined;
    }),
  );
  const defaultHost = useStore(hostScopeStore, (s) => s.host);
  return activeId ? selectedHost : defaultHost;
}

export function useRendererStores(): void {
  const locale = useUiLocale();
  const activeId = useStore(sessionsStore, (s) => s.activeId);
  const selectedHost = useStore(
    sessionsStore,
    useShallow((s) => {
      const row = s.sessions.find((session) => session.id === s.activeId);
      return row ? { hostId: row.runtimeHostId, profileId: row.profileId } : undefined;
    }),
  );
  const localPending = useStore(
    sessionsStore,
    (s) => s.sessions.find((row) => row.id === s.activeId)?.localState === 'pending',
  );
  const hostSessionId = localPending ? undefined : activeId;
  const projectIdentity = useStore(
    sessionsStore,
    useShallow((s) => {
      const row = s.sessions.find((session) => session.id === s.activeId);
      return [row?.projectId, row?.cwd] as const;
    }),
  );
  const defaultHost = useStore(hostScopeStore, (s) => s.host);
  const hostRevision = useStore(hostScopeStore, (s) => s.revision);
  const host = activeId ? selectedHost : defaultHost;
  useEffect(startRendererStores, []);
  useLayoutEffect(
    () => activeSessionStore.observe(activeId, locale, localPending),
    [activeId, locale, selectedHost?.profileId, hostRevision, localPending],
  );
  useEffect(() => {
    uiStore.dispatchWorkbar({ type: 'activate-session', sessionId: activeId });
  }, [activeId]);
  useLayoutEffect(() => {
    if (!defaultHost) {
      projectsStore.defaults.disconnect();
      return;
    }
    return projectsStore.connectDefault(defaultHost);
  }, [defaultHost?.profileId, defaultHost?.hostId]);
  useLayoutEffect(() => {
    if (!host) {
      connectionsStore.disconnect();
      settingsStore.host.disconnect();
      return;
    }
    const offConnections = connectionsStore.observe(hostSessionId, host);
    const offSettings = settingsStore.observeHost(host);
    return () => {
      offConnections();
      offSettings();
    };
  }, [hostSessionId, host?.profileId, host?.hostId, hostRevision]);
  useLayoutEffect(() => {
    if (!hostSessionId || !host) {
      projectsStore.active.disconnect();
      projectsStore.activeInfo.disconnect();
      return;
    }
    return projectsStore.connectActive(hostSessionId, host);
  }, [
    hostSessionId,
    host?.profileId,
    host?.hostId,
    hostRevision,
    projectIdentity[0],
    projectIdentity[1],
  ]);
}

const NO_MESSAGES: readonly StoredMessage[] = [];
export function useActiveTurns() {
  const selectedId = useStore(sessionsStore, (s) => s.activeId);
  const locale = useUiLocale();
  const input = useStore(
    activeSessionStore,
    useShallow((s) => ({
      sessionId: s.sessionId,
      messages: s.messages,
      liveTurn: s.sessionId ? s.liveTurns[s.sessionId] : undefined,
      shellRunUpdates: s.shellUpdates,
    })),
  );
  const turns = useTranscriptProjection(
    input.sessionId === selectedId
      ? { ...input, locale }
      : { sessionId: selectedId, locale, messages: NO_MESSAGES },
  );
  return useLiveStatusOverlay(turns, input.sessionId === selectedId ? input.liveTurn : undefined);
}

/**
 * Present the Turn the live projection is writing into as `running`.
 *
 * The Runtime records a `turn_state` row only when a Turn ENDS (upstream
 * #4879 derives transcripts from RuntimeEvents; there is no running row), so
 * `materializeTurns` infers `completed` for a Turn that is still streaming.
 * The live projection is the only evidence a Turn is in flight, and it is
 * what the upstream transcript keys on too. Everything downstream — footer
 * actions, the edit affordance, markdown completeness, `data-turn-status` —
 * reads `turn.status`, so the overlay is applied here, once, rather than
 * re-derived per consumer.
 *
 * A recorded terminal status always wins: a frozen live projection (missed
 * `complete`) must not keep a Turn the Host has ended looking alive. Object
 * identity is preserved for every other Turn so the presentation caches
 * keyed on it stay warm.
 */
function useLiveStatusOverlay(
  turns: readonly TurnViewModel[],
  liveTurn: LiveTurnProjection | undefined,
): readonly TurnViewModel[] {
  const cache = useRef<{ source: TurnViewModel; overlaid: TurnViewModel }>(undefined);
  const inFlightId = liveTurn && !liveTurn.terminal ? liveTurn.turnId : undefined;
  return useMemo(() => {
    if (!inFlightId) return turns;
    const index = turns.findIndex((turn) => turn.turnId === inFlightId);
    if (index < 0) return turns;
    const source = turns[index]!;
    if (source.status === 'running') return turns;
    if (source.statusSource === 'recorded') return turns;
    const overlaid =
      cache.current?.source === source
        ? cache.current.overlaid
        : { ...source, status: 'running' as const };
    cache.current = { source, overlaid };
    return turns.map((turn, i) => (i === index ? overlaid : turn));
  }, [turns, inFlightId]);
}
export function useLiveTurnSnapshot() {
  return useStore(
    activeSessionStore,
    useShallow((s) => deriveLiveTurnSnapshot(s.sessionId ? s.liveTurns[s.sessionId] : undefined)),
  );
}

/**
 * Everything the shell derives from the active Session's live turn (upstream
 * `useShellLiveTurn`, #646): whether a turn is running at all — the Stop
 * affordance and the composer lock — and whether the transcript's running
 * status line (label + elapsed clock) should be up.
 *
 * `turnActive` unions the live projection with the catalog's `runningTurnIds`
 * (turns this renderer did not send: another client, a scheduled task, one
 * still running across a reload) so neither witness can veto the other. The
 * unacknowledged send counts as active too: between the composer and the
 * Host's first word, nothing else moves.
 *
 * The status line rides `turnActive` with a rising-edge delay, so a turn that
 * finishes inside the window never flashes it, and stays up for the whole
 * turn — it asks "is the model working?", not "is anything streaming?".
 */
export function useShellLiveTurn(sessionId: string | undefined): {
  turnActive: boolean;
  activeStreamingLive: boolean;
  hasInFlightLiveTools: boolean;
  showRunningStatus: boolean;
} {
  const live = useLiveTurnSnapshot();
  const runningTurnIds = useStore(
    sessionsStore,
    (s) => s.sessions.find((row) => row.id === sessionId)?.runningTurnIds,
  );
  const submitting = useStore(
    activeSessionStore,
    (s) =>
      s.sessionId === sessionId &&
      (s.transientMessages.some(
        (message) =>
          message.deliveryStatus === undefined &&
          !s.localMessages.some(
            (local) =>
              local.messageId === message.id &&
              (local.state === 'accepted' || local.state === 'failed'),
          ),
      ) ||
        s.localMessages.some(
          (message) => message.state === 'sending' || message.state === 'saved',
        )),
  );
  const activeStreamingLive = live.hasStreamingText && live.streamingMessageId === undefined;
  const turnActive = deriveTurnActive({
    turnPhase: live.phase,
    armedTurnId: live.turnId,
    runningTurnIds,
  });
  const showRunningStatus = useDelayedFlag(turnActive || submitting, RUNNING_STATUS_DELAY_MS);
  return {
    turnActive,
    activeStreamingLive,
    hasInFlightLiveTools: live.hasInFlightTools,
    showRunningStatus,
  };
}
export function useProjectContext() {
  const activeId = useStore(sessionsStore, (s) => s.activeId);
  const active = useStore(projectsStore.active, (s) => s.data);
  const activeInfo = useStore(projectsStore.activeInfo, (s) => s.data);
  const defaults = useStore(projectsStore.defaults, (s) => s.data);
  const local = useStore(projectsStore.local, (s) => s.data);
  const selected = useStore(sessionsStore, (s) => s.sessions.find((row) => row.id === s.activeId));
  const snapshot = activeId ? active : defaults?.snapshot;
  const projectId = activeId ? selected?.projectId : defaults?.info.projectId;
  return {
    snapshot,
    projects: snapshot?.projects ?? [],
    capabilities: snapshot?.capabilities,
    currentProject: snapshot?.projects.find((row) => row.id === projectId),
    projectId,
    localProjects: local?.projects ?? [],
    info: activeId ? activeInfo : defaults?.info,
  };
}
