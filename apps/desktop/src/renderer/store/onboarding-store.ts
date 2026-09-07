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

// The onboarding snapshot, and the prefetch budget it is read under.
//
// `onboarding.getSnapshot()` is one composite read (sessions + connections +
// model choices + per-session send readiness). Two surfaces need it: the
// welcome hero, which asks "what is the single next thing this user must do",
// and the sidebar, which reads `sessionSendOutcomes` to mark rows the Host has
// already decided cannot send. Neither is on the first-paint path, so the
// bootstrap arms the read on a timer instead of racing the reveal handshake —
// the same 2500 ms budget the previous shell used.

import { createStore } from 'zustand/vanilla';
import type { SessionSendProjection } from '@maka/core/session-send-projection';
import type { OnboardingMilestoneId } from '@maka/core/onboarding';
import * as api from '../bridge/onboarding.js';
import { errorMessage } from './resource-store.js';

/** How long after mount the snapshot is fetched. Contract doc §4, kept as-is. */
export const ONBOARDING_PREFETCH_DELAY_MS = 2500;

export interface OnboardingStoreState {
  snapshot: api.OnboardingSnapshot | undefined;
  loading: boolean;
  error: string | undefined;
  /** Set once the user closed the hero; it does not come back this session. */
  dismissed: boolean;
}

export function createOnboardingStore(bridge = api) {
  const store = createStore<OnboardingStoreState>(() => ({
    snapshot: undefined,
    loading: false,
    error: undefined,
    dismissed: false,
  }));
  let generation = 0;
  const refresh = async (): Promise<void> => {
    const request = ++generation;
    store.setState({ loading: true, error: undefined });
    try {
      const snapshot = await bridge.getOnboardingSnapshot();
      if (request === generation) store.setState({ snapshot, loading: false });
    } catch (error) {
      // A snapshot that cannot be read is not an error the user can act on:
      // every surface reading it has a defined shape for "not known yet".
      if (request === generation) store.setState({ error: errorMessage(error), loading: false });
    }
  };
  return {
    ...store,
    refresh,
    dismiss() {
      store.setState({ dismissed: true });
    },
    /** Arm the deferred read. Returns the canceller; safe to call more than once. */
    prefetch(delayMs: number = ONBOARDING_PREFETCH_DELAY_MS): () => void {
      const timer = setTimeout(() => void refresh(), delayMs);
      return () => clearTimeout(timer);
    },
    async completeMilestone(id: OnboardingMilestoneId, status: 'completed' | 'skipped') {
      const request = ++generation;
      const snapshot = await bridge.setOnboardingMilestone(id, status);
      if (request === generation) store.setState({ snapshot, loading: false });
      return snapshot;
    },
  };
}

export const onboardingStore = createOnboardingStore();

/**
 * Per-session send readiness, or an empty record while the snapshot is unknown.
 *
 * The empty case is a shared frozen constant, not a fresh `{}`. This is read
 * through `useStore`, whose default equality is `Object.is`: a new object per
 * call would compare unequal to itself on every render and re-render forever.
 */
const NO_SEND_OUTCOMES: Readonly<Record<string, SessionSendProjection>> = Object.freeze({});

export function sendOutcomesOf(
  state: OnboardingStoreState,
): Readonly<Record<string, SessionSendProjection>> {
  return state.snapshot?.sessionSendOutcomes ?? NO_SEND_OUTCOMES;
}
