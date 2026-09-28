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

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';
import type { SessionAttention } from '@maka/runtime-host/protocol';

/**
 * Pure decision + copy helpers for desktop Session notifications.
 *
 * Kept free of any `electron` import so the gating logic can be unit
 * tested under plain `node --test` (`notifications-main.ts` owns everything
 * Electron-shaped). The Runtime Host says *that* a Session finished, failed
 * or waits on the user; the main process decides whether to actually raise
 * an OS notification.
 */

export interface RunNotificationGate {
  /** Product toggle: `settings.notifications.runComplete`. */
  readonly enabled: boolean;
  /** Electron `Notification.isSupported()` for the current platform. */
  readonly supported: boolean;
  /**
   * Whether the main window currently holds OS focus. We suppress the
   * notification when focused — the user is already looking at Maka, so
   * a banner would be pure noise.
   */
  readonly windowFocused: boolean;
  /** Automated desktop runs must never emit native OS notifications. */
  readonly e2e: boolean;
}

/**
 * Single source of truth for "should we raise a native notification for
 * this Session". All gates must pass; order is irrelevant because the
 * predicate is a plain conjunction.
 */
export function shouldRaiseRunNotification(gate: RunNotificationGate): boolean {
  return gate.enabled && gate.supported && !gate.windowFocused && !gate.e2e;
}

export interface RunNotificationCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * Generic fallback text, keyed by attention kind. Used when there is no
 * session name / body (e.g. an unreadable Session or a tool-only turn with
 * no assistant text).
 */
const RUN_NOTIFICATION_COPY = {
  'zh-CN': {
    errored: { title: '任务出错', body: '本轮回答未能完成，点击查看详情。' },
    completed: { title: '回答已生成', body: 'Maka 已完成本轮回答，点击查看。' },
    waiting: { title: '等你回答', body: 'Maka 需要你的回答才能继续，点击查看。' },
  },
  'zh-TW': {
    errored: { title: '任務發生錯誤', body: '本次回答未能完成，按一下以檢視詳細資料。' },
    completed: { title: '回答已產生', body: 'Maka 已完成本次回答，按一下以檢視。' },
    waiting: { title: '等你回答', body: 'Maka 需要你的回答才能繼續，按一下以檢視。' },
  },
  en: {
    errored: { title: 'Conversation error', body: 'This response did not finish. Click to view details.' },
    completed: { title: 'Response ready', body: 'Maka finished this response. Click to view it.' },
    waiting: { title: 'Waiting for you', body: 'Maka needs your answer to continue. Click to view it.' },
  },
} satisfies UiCatalog<Record<SessionAttention['kind'], RunNotificationCopy>>;

/**
 * One Host attention event, with the Session's name as `title`. `body` is
 * the Host's own text (the question, the failure) or else the Session's
 * last message preview. Either may be missing/blank.
 */
export interface RunNotificationEvent extends SessionAttention {
  readonly title?: string;
  readonly hostEpoch: string;
  readonly sessionId: string;
}

const SEEN_EVENTS_MAX = 512;

/**
 * Raise each Host event once. An owner connection and a Guest connection to
 * the same Host can both deliver it; the set is bounded because attention is
 * live-only and never replayed.
 */
export function deduplicateRunNotifications(
  notify: (input: RunNotificationEvent) => Promise<void>,
): (input: RunNotificationEvent) => Promise<void> {
  const seen = new Set<string>();
  return async (input) => {
    const key = JSON.stringify([input.hostEpoch, input.sessionId, input.eventId]);
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > SEEN_EVENTS_MAX) seen.delete(seen.values().next().value!);
    await notify(input);
  };
}

// The OS truncates long banners anyway; cap defensively so a runaway
// reply (no-whitespace blob) can't bloat the payload.
const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 160;

/**
 * Collapse a string into a single trimmed line, hard-capped with an
 * ellipsis. Blanks return '' so the caller can fall back.
 */
function sanitizeLine(value: string | undefined, max: number): string {
  const collapsed = (value ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Final notification text: prefer the session name + body, falling back
 * per-field to the generic copy when a field is missing or blank.
 * Sanitization + capping live here so the notifier stays a thin shell and
 * the logic is unit-testable without Electron.
 */
export function resolveNotificationContent(
  input: Pick<RunNotificationEvent, 'kind' | 'title' | 'body'>,
  locale: UiLocale,
): RunNotificationCopy {
  const fallback = RUN_NOTIFICATION_COPY[locale][input.kind];
  return {
    title: sanitizeLine(input.title, MAX_TITLE_CHARS) || fallback.title,
    body: sanitizeLine(input.body, MAX_BODY_CHARS) || fallback.body,
  };
}
