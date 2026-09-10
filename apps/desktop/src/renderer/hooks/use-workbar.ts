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

import { useCallback, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { uiStore } from '../store/index.js';
import { workbarStore } from '../store/workbar-store.js';
import {
  SESSION_WORKBAR_MAX_WIDTH,
  SESSION_WORKBAR_MIN_WIDTH,
  isSessionWorkbarCollapsed,
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

export interface WorkbarModel {
  /** Faces open in the right dock, deferred kinds removed. */
  tabs: readonly SessionWorkbarTab[];
  activeTabId: string | null;
  activeFace: WorkbarFace | undefined;
  collapsed: boolean;
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

export function openWorkbarTerminal(sessionId: string, ref: string): void {
  workbarStore.selectTerminalRun(sessionId, ref);
  uiStore.dispatchWorkbar({
    type: 'open',
    placement: 'right',
    tab: { id: staticSessionWorkbarTabId('terminal'), kind: 'terminal' },
  });
}

export function useWorkbar(sessionId: string | undefined): WorkbarModel {
  const layout = useStore(uiStore, (state) => state.workbar);
  const expanded = useStore(workbarStore, (state) => state.paneExpanded);

  // The layout remembers collapse per task, so it has to be told which task is
  // in front before `isSessionWorkbarCollapsed` can answer.
  useEffect(() => {
    uiStore.dispatchWorkbar({ type: 'activate-session', sessionId });
  }, [sessionId]);

  const tabs = useMemo(
    () => layout.panels.right.tabs.filter((tab) => isWorkbarFace(tab.kind)),
    [layout.panels.right.tabs],
  );
  const activeTabId = tabs.some((tab) => tab.id === layout.panels.right.activeTabId)
    ? layout.panels.right.activeTabId
    : (tabs[0]?.id ?? null);
  const activeFace = tabs.find((tab) => tab.id === activeTabId)?.kind as WorkbarFace | undefined;
  const collapsed = isSessionWorkbarCollapsed(layout) || tabs.length === 0;

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
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    uiStore.dispatchWorkbar({ type: 'collapse', placement: 'right', collapsed: next });
    if (next) workbarStore.setPaneExpanded(false);
  }, []);

  const toggleFace = useCallback(
    (face: WorkbarFace) => {
      // A shortcut is a switch, not an accumulator: pressing ⌘P while Files is
      // already the face on screen puts the pane away rather than re-opening
      // the same face onto itself.
      if (!collapsed && activeFace === face) setCollapsed(true);
      else open(face);
    },
    [activeFace, collapsed, open, setCollapsed],
  );

  const toggle = useCallback(() => {
    if (!collapsed) {
      setCollapsed(true);
      return;
    }
    // Nothing is open yet on a first use: the pane needs a face to show, and
    // Files is the one that has something to say about most tasks.
    if (tabs.length === 0) open('files');
    else setCollapsed(false);
  }, [collapsed, open, setCollapsed, tabs.length]);

  // Full screen covers the window outright, so it no longer has to make room
  // by putting the sidebar away — which it used to do, and which outlived the
  // full-screen state: the reader came back out to a rail they never collapsed.
  const setExpanded = useCallback((next: boolean) => {
    workbarStore.setPaneExpanded(next);
  }, []);

  const resize = useCallback((width: number) => {
    uiStore.dispatchWorkbar({ type: 'resize', placement: 'right', size: width });
  }, []);

  return {
    tabs,
    activeTabId,
    activeFace,
    collapsed,
    expanded: expanded && !collapsed,
    width: layout.rightWidth,
    minWidth: SESSION_WORKBAR_MIN_WIDTH,
    maxWidth: SESSION_WORKBAR_MAX_WIDTH,
    open,
    activate,
    close,
    toggleFace,
    setCollapsed,
    toggle,
    setExpanded,
    resize,
  };
}
