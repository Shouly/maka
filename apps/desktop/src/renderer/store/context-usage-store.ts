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

// How full the model's context is, for the ring above the composer.
//
// The number is the LAST COMPLETED REQUEST's input size, which is the only
// context size that is a measured fact rather than a prediction: what the next
// request will carry depends on what the user types and on what compaction
// does to the history first. So the ring lags one turn, deliberately, and the
// projection below refuses to report anything when the Host has no completed
// request to describe.

import { createStore } from 'zustand/vanilla';
import type { ContextDiagnosticsResult } from '@maka/runtime-host/protocol';
import * as inspector from '../bridge/inspector.js';
import { errorMessage } from './resource-store.js';

export interface ContextUsageState {
  readonly sessionId: string | undefined;
  readonly data: ContextDiagnosticsResult | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
}

/** Where the ring changes colour. Aligned with the runtime's 80% auto-compact. */
export const CONTEXT_WARNING_PERCENT = 80;
export const CONTEXT_CRITICAL_PERCENT = 90;

export interface ContextUsageProjection {
  readonly usedTokens: number;
  readonly contextWindow: number | undefined;
  /** Absent when there is no window to divide by — a share of nothing is not 0%. */
  readonly percent: number | undefined;
  readonly tier: 'ok' | 'warning' | 'critical';
  readonly modelId: string;
}

/**
 * The ring's numbers, or `undefined` when the Host cannot describe a request.
 *
 * `cacheReadInputTokens` counts toward the window: the provider read those
 * tokens from its cache, but they still occupy the request. Leaving them out
 * makes a heavily cached conversation read as nearly empty right up to the
 * turn that overflows.
 */
export function projectContextUsage(
  data: ContextDiagnosticsResult | undefined,
): ContextUsageProjection | undefined {
  if (!data || data.status !== 'available') return undefined;
  const usedTokens = (data.inputTokens ?? 0) + (data.cacheReadInputTokens ?? 0);
  if (usedTokens <= 0) return undefined;
  const contextWindow =
    data.contextWindow !== undefined && data.contextWindow > 0 ? data.contextWindow : undefined;
  const percent =
    contextWindow === undefined
      ? undefined
      : Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  const tier =
    percent === undefined
      ? 'ok'
      : percent >= CONTEXT_CRITICAL_PERCENT
        ? 'critical'
        : percent >= CONTEXT_WARNING_PERCENT
          ? 'warning'
          : 'ok';
  return { usedTokens, contextWindow, percent, tier, modelId: data.modelId };
}

export function createContextUsageStore(api = inspector) {
  const store = createStore<ContextUsageState>(() => ({
    sessionId: undefined,
    data: undefined,
    loading: false,
    error: undefined,
  }));
  let generation = 0;
  return {
    ...store,
    /**
     * Follow one task's usage. Every observation carries a generation, so a
     * read that lands after the caller moved to another task is dropped rather
     * than published under the new task's id.
     */
    observe(sessionId: string | undefined): () => void {
      const owner = ++generation;
      store.setState({ sessionId, data: undefined, error: undefined, loading: Boolean(sessionId) });
      if (!sessionId) return () => undefined;
      const read = async () => {
        try {
          // The namespace answers in a Result envelope; a failure to describe
          // the context is not an error the reader can act on, so it lands as
          // "nothing to show" rather than as a banner.
          const result = await api.readSessionContextDiagnostics(sessionId);
          if (owner === generation) {
            store.setState({
              data: result.ok ? result.data : undefined,
              loading: false,
              error: undefined,
            });
          }
        } catch (error) {
          if (owner === generation) store.setState({ error: errorMessage(error), loading: false });
        }
      };
      const off = api.subscribeSessionUsageChanges(sessionId, () => {
        if (owner === generation) void read();
      });
      void read();
      return () => {
        off();
        if (owner === generation) {
          generation++;
          store.setState({ sessionId: undefined, data: undefined, loading: false });
        }
      };
    },
  };
}

export const contextUsageStore = createContextUsageStore();
