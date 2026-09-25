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

// The right pane's geometry, as one object the shell and the titlebar share.
//
// The model underneath is the ported one (`lib/ported/workbar-layout.ts` over
// `workbar-tabs.ts`), so the persisted keys and the transition rules are the
// pre-rewrite ones unchanged. This hook is the only place the renderer
// dispatches into it, which is what keeps the titlebar toggle, the tab strip,
// the keyboard map and the E2E fixture describing the same panel.
//
// Two deliberate narrowings against the stored model (plan §2.11, §6):
//
//   The BOTTOM placement is readable but not rendered. Its state survives —
//   `persistableSessionWorkbarPanels` still writes it, so a profile that had a
//   bottom panel keeps it — but nothing here mounts one; a face that was in it
//   is simply not on screen until a later phase draws that dock.
//
//   `work-board` and `side-chat` are deferred features. A persisted tab of
//   either kind would otherwise sit in the strip with no body behind it, so
//   the strip lists only the five faces this phase implements.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { uiStore } from '../store/index.js';
import { workbarStore } from '../store/workbar-store.js';
import {
  SESSION_WORKBAR_MAX_WIDTH,
  SESSION_WORKBAR_MAX_FRACTION,
  SESSION_WORKBAR_MIN_WIDTH,
  SESSION_WORKBAR_WIDTH_FRACTION,
  isSessionWorkbarCollapsed,
  sessionWorkbarViewerId,
} from '../lib/ported/workbar-layout.js';
import {
  staticSessionWorkbarTabId,
  type SessionWorkbarTab,
  type SessionWorkbarTabKind,
} from '../lib/ported/workbar-tabs.js';
import { WORKBAR_TOOL_DEFINITIONS } from '../lib/ported/workbar-tool-definitions.js';

/** The faces Phase 4 draws, in strip order. */
export const WORKBAR_FACES = ['files', 'review', 'terminal', 'inspector', 'browser'] as const;

export type WorkbarFace = (typeof WORKBAR_FACES)[number];

export function isWorkbarFace(kind: SessionWorkbarTabKind): kind is WorkbarFace {
  return (WORKBAR_FACES as readonly string[]).includes(kind);
}

/** Definition rows for the faces this phase draws, in registry order. */
export const WORKBAR_FACE_DEFINITIONS = WORKBAR_TOOL_DEFINITIONS.filter((definition) =>
  isWorkbarFace(definition.kind),
);

/**
 * The faces a reader can SUMMON, which is not all of them.
 *
 * Files is opened by choosing a file — from the session panel's Outputs, from
 * a delivered card, from a `file_write` row. Offering it in a menu would open a
 * viewer onto nothing and take the column away from the very list the reader
 * would use to pick a file.
 */
export const WORKBAR_LAUNCHER_DEFINITIONS = WORKBAR_FACE_DEFINITIONS.filter(
  (definition) => definition.kind !== 'files',
);

export interface WorkbarModel {
  /** Faces open in the right dock, deferred kinds removed. */
  tabs: readonly SessionWorkbarTab[];
  activeTabId: string | null;
  activeFace: WorkbarFace | undefined;
  collapsed: boolean;
  /** True when the workbar holds the column; false when the session panel does. */
  workbarHasColumn: boolean;
  expanded: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  open(face: WorkbarFace): void;
  activate(tabId: string): void;
  close(tabId: string): void;
  /** Opens the face and reveals the pane, or hides the pane if it is already showing it. */
  toggleFace(face: WorkbarFace): void;
  setCollapsed(collapsed: boolean): void;
  toggle(): void;
  showActivity(): void;
  /** The session panel has content for the first time: reveal the column once for that session. */
  revealOnce(sessionId: string): void;
  setExpanded(expanded: boolean): void;
  resize(width: number): void;
}

/**
 * Open a face on something a transcript row names.
 *
 * Not part of `WorkbarModel`: the callers are tool rows deep inside the
 * transcript, and threading the model down to them would make every row
 * re-render whenever the pane's width changed. Both dispatch through the same
 * store the hook does, so the strip and the persisted topology stay in step.
 */
export function openWorkbarFile(sessionId: string, path: string | undefined): void {
  workbarStore.requestArtifactPath(sessionId, path);
  uiStore.dispatchWorkbar({
    type: 'open',
    placement: 'right',
    tab: { id: staticSessionWorkbarTabId('files'), kind: 'files' },
  });
}

/**
 * The same handoff by ARTIFACT ID, for a row that already knows one.
 *
 * `openWorkbarFile` leaves a path for the Files face to resolve, because a
 * `file_write` row has only a path. A delivered file carries the id the Host
 * minted for it, and going back through the path would let the face pick a
 * different artifact that happens to share the path.
 */
export function openWorkbarArtifact(sessionId: string, artifactId: string): void {
  workbarStore.selectArtifact(sessionId, artifactId);
  uiStore.dispatchWorkbar({
    type: 'open',
    placement: 'right',
    tab: { id: staticSessionWorkbarTabId('files'), kind: 'files' },
  });
}

/**
 * Put the file viewer away — the column falls back to another open viewer, or
 * to the session panel.
 *
 * The viewer is closed rather than left showing an empty notice because it has
 * no reason to hold the column without a file, and because the list a reader
 * would pick the next file from is the thing behind it.
 */
export function closeWorkbarArtifact(sessionId: string): void {
  workbarStore.selectArtifact(sessionId, undefined);
  workbarStore.setPaneExpanded(false);
  uiStore.dispatchWorkbar({
    type: 'close',
    placement: 'right',
    tabIds: [staticSessionWorkbarTabId('files')],
  });
}

export function openWorkbarTerminal(sessionId: string, ref: string): void {
  workbarStore.selectTerminalRun(sessionId, ref);
  uiStore.dispatchWorkbar({
    type: 'open',
    placement: 'right',
    tab: { id: staticSessionWorkbarTabId('terminal'), kind: 'terminal' },
  });
}

function subscribeToFrameWidth(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/**
 * The window's own width, kept live.
 *
 * The pane's ceiling is a fraction of it, so a reader who narrows the window
 * has to see the pane give way — a stored width taken on a wide display would
 * otherwise open the pane over most of a small one.
 */
function useFrameWidth(): number {
  return useSyncExternalStore(subscribeToFrameWidth, () => window.innerWidth);
}

export function useWorkbar(sessionId: string | undefined): WorkbarModel {
  const layout = useStore(uiStore, (state) => state.workbar);
  const expanded = useStore(workbarStore, (state) => state.paneExpanded);
  const sidebarWidth = useStore(uiStore, (state) => state.sidebarWidth);
  const sidebarCollapsed = useStore(uiStore, (state) => state.sidebarCollapsed);
  const frameWidth = useFrameWidth();

  // Half of what the CONVERSATION has, not half of the window.
  //
  // The session list is a column of its own, so counting it into the half gave
  // the pane a share of space the conversation never had: at 1512 with a 260
  // list, half the window is 756 and leaves the transcript 496 — the pane wide,
  // the thing being read narrow. Against the content the two come out even, at
  // 626 each, which is what the reference splits.
  //
  // A collapsed list takes no layout width (`w-0`), and a peeking one is
  // `fixed` — out of flow, and only reachable while collapsed — so one flag
  // covers both.
  const contentWidth = Math.max(0, frameWidth - (sidebarCollapsed ? 0 : sidebarWidth));

  // How far the handle may TRAVEL — not where the pane opens. Those were the
  // same number, which made every pane open pinned against its own ceiling:
  // dragging narrower worked, dragging wider moved nothing at all.
  const maxWidth = Math.max(
    SESSION_WORKBAR_MIN_WIDTH,
    Math.min(SESSION_WORKBAR_MAX_WIDTH, Math.round(contentWidth * SESSION_WORKBAR_MAX_FRACTION)),
  );

  // The layout remembers collapse per task, so it has to be told which task is
  // in front before `isSessionWorkbarCollapsed` can answer.
  useEffect(() => {
    uiStore.dispatchWorkbar({ type: 'activate-session', sessionId });
    workbarStore.setPaneExpanded(false);
  }, [sessionId]);

  const tabs = useMemo(
    () => layout.panels.right.tabs.filter((tab) => isWorkbarFace(tab.kind)),
    [layout.panels.right.tabs],
  );
  // ONE answer to "what is in the column", for this session: the viewer's tab
  // id, or null for the session panel. The pane, the strip and the column's
  // occupant all read this same value, so they cannot disagree — the blank
  // pane came from a boolean occupant and a global active tab that could.
  const columnViewerId = sessionWorkbarViewerId(layout);
  const activeTabId = tabs.some((tab) => tab.id === columnViewerId) ? columnViewerId : null;
  const activeFace = tabs.find((tab) => tab.id === activeTabId)?.kind as WorkbarFace | undefined;
  // Hidden until the session has something to show or the reader opens it
  // (`isSessionWorkbarCollapsed`); what it holds when shown is the line above.
  const collapsed = isSessionWorkbarCollapsed(layout);
  const workbarHasColumn = activeTabId !== null;

  const open = useCallback((face: WorkbarFace) => {
    uiStore.dispatchWorkbar({
      type: 'open',
      placement: 'right',
      tab: { id: staticSessionWorkbarTabId(face), kind: face },
    });
  }, []);

  const activate = useCallback((tabId: string) => {
    uiStore.dispatchWorkbar({ type: 'activate', placement: 'right', tabId });
  }, []);

  const close = useCallback((tabId: string) => {
    uiStore.dispatchWorkbar({ type: 'close', placement: 'right', tabIds: [tabId] });
    // Full screen is a posture taken for ONE file, not a setting. Keeping it
    // across a close means the next file a reader opens — often one the model
    // just delivered — covers the conversation they were reading, and they
    // never asked for that.
    workbarStore.setPaneExpanded(false);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    uiStore.dispatchWorkbar({ type: 'collapse', placement: 'right', collapsed: next });
    if (next) workbarStore.setPaneExpanded(false);
  }, []);

  const tabIdOf = staticSessionWorkbarTabId;

  const toggleFace = useCallback(
    (face: WorkbarFace) => {
      // A shortcut is a switch, not an accumulator: pressing ⌘P while Files is
      // already the face on screen hands the column back to the session panel
      // rather than re-opening the same face onto itself.
      if (!collapsed && workbarHasColumn && activeFace === face) {
        uiStore.dispatchWorkbar({ type: 'close', placement: 'right', tabIds: [tabIdOf(face)] });
      } else open(face);
    },
    [activeFace, collapsed, open, workbarHasColumn],
  );

  // Hide the column, or bring it back. Which occupant it comes back to is not
  // this switch's business.
  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  // The session panel has something in it for the first time. The reference
  // opens itself then, once per session, and only where there is room for a
  // column beside the conversation (768px).
  const revealOnce = useCallback((session: string) => {
    if (window.innerWidth < 768) return;
    uiStore.dispatchWorkbar({ type: 'reveal-once', sessionId: session });
  }, []);

  const showActivity = useCallback(() => {
    uiStore.dispatchWorkbar({ type: 'show-session-panel' });
    workbarStore.setPaneExpanded(false);
  }, []);

  // Full screen covers the window outright, so it no longer has to make room
  // by putting the sidebar away — which it used to do, and which outlived the
  // full-screen state: the reader came back out to a rail they never collapsed.
  const setExpanded = useCallback((next: boolean) => {
    workbarStore.setPaneExpanded(next);
  }, []);

  const resize = useCallback(
    (width: number) => {
      // The drag measures pixels; the store keeps the share they represent, so
      // only this edge — which knows how wide the content area is — converts.
      uiStore.dispatchWorkbar({
        type: 'resize',
        placement: 'right',
        size: contentWidth > 0 ? width / contentWidth : SESSION_WORKBAR_WIDTH_FRACTION,
      });
    },
    [contentWidth],
  );

  return {
    tabs,
    activeTabId,
    activeFace,
    collapsed,
    workbarHasColumn,
    expanded: expanded && !collapsed && workbarHasColumn,
    // The share, resolved against the content area and held inside the floor
    // and the live ceiling. Collapsing the session list widens the content, so
    // the same share is more pixels — which is the whole point of storing one.
    width: Math.min(
      maxWidth,
      Math.max(SESSION_WORKBAR_MIN_WIDTH, Math.round(contentWidth * layout.rightFraction)),
    ),
    minWidth: SESSION_WORKBAR_MIN_WIDTH,
    maxWidth,
    open,
    activate,
    close,
    toggleFace,
    setCollapsed,
    toggle,
    showActivity,
    revealOnce,
    setExpanded,
    resize,
  };
}
