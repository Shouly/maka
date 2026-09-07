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

// The Inspector's three reads, kept apart.
//
// Ported from the pre-rewrite `use-session-trace.ts`, with the services swapped
// for `bridge/inspector` and the event stream taken from the shell's one
// subscription. The separation is the whole point and is unchanged:
//
//   TRACE — what happened, page by page, newest page first. Paging depth
//   survives a refresh: a reader who loaded three pages and then watched a turn
//   land still has three pages.
//   SUMMARY — what every recorded call in the session cost, independent of
//   which pages are loaded. Its own authority (`subscribeUsageChanges`).
//   CONTEXT — what the context holds right now. Enrichment: a failure leaves
//   the previous answer standing rather than blanking the composition block,
//   because the last snapshot is still the newest one anybody has.
//
// None is derived from another, so one unavailable source cannot falsify the
// others.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generalizedErrorMessageForLocale } from '@maka/core/redaction';
import type { UiLocale } from '@maka/core/ui-locale';
import { mergeSessionTraces, type SessionTrace } from '@maka/core/session-trace';
import type { ContextDiagnosticsResult } from '@maka/runtime-host/protocol';
import {
  readSessionContextDiagnostics,
  readSessionTrace,
  readSessionUsageSummary,
  subscribeSessionUsageChanges,
  type SessionTracePage,
  type SessionUsageSummary,
} from '../bridge/inspector.js';
import { activeSessionStore } from '../store/index.js';
import {
  createRefreshCoalescer,
  createTraceRefreshCoalescer,
  TRACE_REFRESH_DEBOUNCE_MS,
} from '../lib/ported/session-trace-refresh.js';

type TracePage = Extract<SessionTracePage, { ok: true }>['data'];
type UsageSummary = Extract<SessionUsageSummary, { ok: true }>['data'];
type ContextDiagnostics = ContextDiagnosticsResult;

interface TraceState {
  sessionId?: string;
  pages?: readonly TracePage[];
  context?: ContextDiagnostics;
  summary?: UsageSummary;
  loading: boolean;
  loadingEarlier: boolean;
  summaryLoading: boolean;
  summaryError: boolean;
  error?: string;
}

export interface SessionTraceSnapshot {
  trace?: SessionTrace;
  context?: ContextDiagnostics;
  summary?: UsageSummary;
  nextCursor?: string | null;
  loading: boolean;
  loadingEarlier: boolean;
  summaryLoading: boolean;
  summaryError: boolean;
  error?: string;
  canHideEarlier: boolean;
  retry(): void;
  loadEarlier(): void;
  hideEarlier(): void;
}

const EMPTY: TraceState = {
  loading: false,
  loadingEarlier: false,
  summaryLoading: false,
  summaryError: false,
};

export function useSessionTrace(
  sessionId: string | undefined,
  active: boolean,
  copy: { loadFailed: string; locale: UiLocale },
): SessionTraceSnapshot {
  const traceRevision = useRef(0);
  const summaryRevision = useRef(0);
  const contextRevision = useRef(0);
  const desiredPages = useRef<{ sessionId: string; count: number } | undefined>(undefined);
  const pageWindow = useRef<{ sessionId: string; pages: readonly TracePage[] } | undefined>(
    undefined,
  );
  const [state, setState] = useState<TraceState>(EMPTY);
  const loadFailed = copy.loadFailed;
  const locale = copy.locale;

  const readWindow = useCallback(
    (target: string) => {
      const revision = ++traceRevision.current;
      const desired = desiredPages.current;
      const pageCount = desired?.sessionId === target ? desired.count : 1;
      setState((current) =>
        current.sessionId === target
          ? { ...current, loading: true, error: undefined }
          : { ...EMPTY, sessionId: target, loading: true },
      );
      void readTracePages(target, pageCount, loadFailed, () => revision === traceRevision.current)
        .then((pages) => {
          if (revision !== traceRevision.current) return;
          pageWindow.current = { sessionId: target, pages };
          setState((current) =>
            current.sessionId === target
              ? { ...current, pages, loading: false, loadingEarlier: false }
              : current,
          );
        })
        .catch((error: unknown) => {
          if (revision !== traceRevision.current) return;
          setState((current) =>
            current.sessionId === target
              ? {
                  ...current,
                  loading: false,
                  loadingEarlier: false,
                  error: generalizedErrorMessageForLocale(error, loadFailed, locale),
                }
              : current,
          );
        });
    },
    [loadFailed, locale],
  );

  const readEarlier = useCallback(
    (target: string, cursor: string) => {
      const revision = ++traceRevision.current;
      setState((current) =>
        current.sessionId === target
          ? { ...current, loadingEarlier: true, error: undefined }
          : current,
      );
      void (async () => {
        try {
          const result = await readSessionTrace(target, cursor);
          if (revision !== traceRevision.current) return;
          const loaded = pageWindow.current;
          if (loaded?.sessionId !== target) return;
          if (!result.ok) throw new Error(result.error.message || loadFailed);
          const nextCursor = result.data.nextCursor;
          // A cursor that repeats itself or one already in the window would
          // page forever; the Host is not supposed to answer that way, and
          // when it does the read fails loudly rather than looping.
          if (
            nextCursor !== null &&
            (nextCursor === cursor || loaded.pages.some((page) => page.nextCursor === nextCursor))
          ) {
            throw new Error(loadFailed);
          }
          const pages = [...loaded.pages, result.data];
          pageWindow.current = { sessionId: target, pages };
          desiredPages.current = { sessionId: target, count: pages.length };
          setState((current) =>
            current.sessionId === target
              ? { ...current, pages, loading: false, loadingEarlier: false }
              : current,
          );
        } catch (error) {
          if (revision !== traceRevision.current) return;
          const loaded = pageWindow.current;
          desiredPages.current = {
            sessionId: target,
            count: loaded?.sessionId === target ? Math.max(loaded.pages.length, 1) : 1,
          };
          setState((current) =>
            current.sessionId === target
              ? {
                  ...current,
                  loading: false,
                  loadingEarlier: false,
                  error: generalizedErrorMessageForLocale(error, loadFailed, locale),
                }
              : current,
          );
        }
      })();
    },
    [loadFailed, locale],
  );

  const readSummary = useCallback((target: string) => {
    const revision = ++summaryRevision.current;
    setState((current) =>
      current.sessionId === target
        ? { ...current, summaryLoading: true, summaryError: false }
        : { ...EMPTY, sessionId: target, summaryLoading: true },
    );
    void readSessionUsageSummary(target)
      .then((result) => {
        if (revision !== summaryRevision.current) return;
        setState((current) =>
          current.sessionId === target
            ? {
                ...current,
                summaryLoading: false,
                ...(result.ok
                  ? { summary: result.data, summaryError: false }
                  : { summary: undefined, summaryError: true }),
              }
            : current,
        );
      })
      .catch(() => {
        if (revision !== summaryRevision.current) return;
        setState((current) =>
          current.sessionId === target
            ? { ...current, summary: undefined, summaryLoading: false, summaryError: true }
            : current,
        );
      });
  }, []);

  const readContext = useCallback((target: string) => {
    const revision = ++contextRevision.current;
    void readSessionContextDiagnostics(target)
      .then((result) => {
        if (revision !== contextRevision.current || !result.ok) return;
        setState((current) =>
          current.sessionId === target ? { ...current, context: result.data } : current,
        );
      })
      .catch(() => {
        // Deliberate: the previous snapshot stays. Blanking it would report
        // "no composition" for a read that merely failed.
      });
  }, []);

  const load = useCallback(
    (target: string) => {
      readWindow(target);
      readSummary(target);
      readContext(target);
    },
    [readContext, readSummary, readWindow],
  );

  useEffect(() => {
    traceRevision.current += 1;
    summaryRevision.current += 1;
    contextRevision.current += 1;
    if (!sessionId || !active) {
      if (!sessionId) {
        pageWindow.current = undefined;
        desiredPages.current = undefined;
        setState(EMPTY);
      }
      return;
    }
    if (desiredPages.current?.sessionId !== sessionId) {
      desiredPages.current = { sessionId, count: 1 };
    }
    const traceCoalescer = createTraceRefreshCoalescer({
      refresh: () => {
        readWindow(sessionId);
        readContext(sessionId);
      },
      delayMs: TRACE_REFRESH_DEBOUNCE_MS,
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    const summaryCoalescer = createRefreshCoalescer({
      refresh: () => readSummary(sessionId),
      delayMs: TRACE_REFRESH_DEBOUNCE_MS,
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    const offEvents = activeSessionStore.subscribeSessionEvents((eventSessionId, event) => {
      if (eventSessionId === sessionId) traceCoalescer.observe(event);
    });
    const offUsage = subscribeSessionUsageChanges(sessionId, () => summaryCoalescer.request());
    load(sessionId);
    return () => {
      traceRevision.current += 1;
      summaryRevision.current += 1;
      contextRevision.current += 1;
      traceCoalescer.cancel();
      summaryCoalescer.cancel();
      offEvents();
      offUsage();
    };
  }, [active, load, readContext, readSummary, readWindow, sessionId]);

  const retry = useCallback(() => {
    if (sessionId) load(sessionId);
  }, [load, sessionId]);

  const trace = useMemo(
    () => (state.pages ? mergeSessionTraces(state.pages.map((page) => page.trace)) : undefined),
    [state.pages],
  );
  const nextCursor = state.pages?.at(-1)?.nextCursor;
  const canHideEarlier = Boolean(state.pages && state.pages.length > 1 && !nextCursor);

  const loadEarlier = useCallback(() => {
    if (!sessionId || !nextCursor || state.loading || state.loadingEarlier) return;
    const desired = desiredPages.current;
    desiredPages.current = {
      sessionId,
      count: (desired?.sessionId === sessionId ? desired.count : 1) + 1,
    };
    readEarlier(sessionId, nextCursor);
  }, [nextCursor, readEarlier, sessionId, state.loading, state.loadingEarlier]);

  const hideEarlier = useCallback(() => {
    if (!sessionId || !canHideEarlier) return;
    const loaded = pageWindow.current;
    if (loaded?.sessionId !== sessionId || loaded.pages.length < 2) return;
    const pages = loaded.pages.slice(0, 1);
    pageWindow.current = { sessionId, pages };
    desiredPages.current = { sessionId, count: 1 };
    setState((current) => (current.sessionId === sessionId ? { ...current, pages } : current));
  }, [canHideEarlier, sessionId]);

  if (state.sessionId !== sessionId) {
    return {
      loading: Boolean(sessionId) && active,
      loadingEarlier: false,
      summaryLoading: false,
      summaryError: false,
      canHideEarlier: false,
      retry,
      loadEarlier,
      hideEarlier,
    };
  }
  return {
    ...(trace ? { trace } : {}),
    ...(state.context ? { context: state.context } : {}),
    ...(state.summary ? { summary: state.summary } : {}),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    loading: state.loading,
    loadingEarlier: state.loadingEarlier,
    summaryLoading: state.summaryLoading,
    summaryError: state.summaryError,
    ...(state.error ? { error: state.error } : {}),
    canHideEarlier,
    retry,
    loadEarlier,
    hideEarlier,
  };
}

/**
 * The first `pageCount` pages, oldest request last.
 *
 * Re-reading the whole window rather than only the head is what keeps a
 * reader's paging depth across a refresh; `seen` fences a Host that answers
 * with a cursor it has already given.
 */
async function readTracePages(
  sessionId: string,
  pageCount: number,
  loadFailed: string,
  isCurrent: () => boolean,
): Promise<TracePage[]> {
  const pages: TracePage[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  while (pages.length < pageCount) {
    const result = await readSessionTrace(sessionId, cursor);
    if (!result.ok) throw new Error(result.error.message || loadFailed);
    pages.push(result.data);
    if (!isCurrent()) return pages;
    const nextCursor = result.data.nextCursor;
    if (nextCursor === null) return pages;
    if (seen.has(nextCursor)) throw new Error(loadFailed);
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  return pages;
}
