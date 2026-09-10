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

import { safeLocalStorageGet, safeLocalStorageSet } from './browser-storage.js';
import {
  persistableSessionWorkbarPanels,
  readSessionWorkbarPanels,
  reduceWorkbarPanels,
  type SessionWorkbarPanelsState,
  type SessionWorkbarPlacement,
  type WorkbarPanelsAction,
} from './workbar-tabs.js';

/**
 * Half the window: the width the pane opens at, and the widest it drags. Past
 * half the pane is no longer a pane beside the transcript, and the reader who
 * wants the whole frame has full screen for it.
 *
 * The window is not something this module can see, so the fraction is applied
 * in `use-workbar`, against a frame width it measures. What lives here is the
 * static part: the floor, and a ceiling on the persisted number.
 */
export const SESSION_WORKBAR_WIDTH_FRACTION = 0.5;
/**
 * 340 is the floor `astryx docs layout` gives a detail/inspector panel, and it
 * is also where the strip stops fitting: five faces need 386px of tab and have
 * 260px, so below this the strip is always scrolling.
 */
export const SESSION_WORKBAR_MIN_WIDTH = 340;
/**
 * The ceiling on a *stored* number, not the one a reader feels: half the window
 * is always the narrower of the two below a 3200px-wide frame. It is here so a
 * width carried over from a much wider display cannot open the pane onto the
 * whole of a small one before the live ceiling has anything to say.
 */
export const SESSION_WORKBAR_MAX_WIDTH = 1600;
/**
 * Not a width anyone sees: it is the static ceiling, and the live one — half
 * the window — undercuts it on any frame this app is opened on. A pane nobody
 * has dragged therefore opens at half, and goes on doing so once this number
 * has been written out, which the first change to the workbar does: persisting
 * writes every key at once.
 */
export const SESSION_WORKBAR_DEFAULT_WIDTH = SESSION_WORKBAR_MAX_WIDTH;
export const SESSION_BOTTOM_PANEL_DEFAULT_HEIGHT = 300;
export const SESSION_BOTTOM_PANEL_MIN_HEIGHT = 180;
export const SESSION_BOTTOM_PANEL_MAX_HEIGHT = 520;

export interface WorkbarLayoutState {
  panels: SessionWorkbarPanelsState;
  activeSessionId: string | undefined;
  collapsedBySession: Record<string, boolean>;
  bottomOpen: boolean;
  rightWidth: number;
  bottomHeight: number;
}

export type WorkbarLayoutAction =
  | WorkbarPanelsAction
  | {
      type: 'remove-stale';
      placement: SessionWorkbarPlacement;
      tabIds: readonly string[];
    }
  | { type: 'activate-session'; sessionId: string | undefined }
  | { type: 'retain-sessions'; sessionIds: ReadonlySet<string> }
  | {
      type: 'collapse';
      placement: 'right' | 'bottom';
      collapsed: boolean;
    }
  | {
      type: 'resize';
      placement: 'right' | 'bottom';
      size: number;
    };

export type WorkbarLayoutPersistenceTarget =
  | 'all'
  | 'topology'
  | 'right-visibility'
  | 'bottom-visibility'
  | 'right-size'
  | 'bottom-size';

function clampSize(size: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(size)));
}

// v2 because v1 was a number on a scale that no longer exists: it was picked
// under a fixed 340-600 range, and carrying it over would hold a pane at 600
// on a frame whose half is 760 — the reader would never see the width the pane
// is now supposed to open at.
const SESSION_WIDTH_KEY = 'maka-session-workbar-width-v2';

/**
 * Reads the persisted width without applying bounds. `loadWorkbarLayout`
 * applies the shared reducer policy so hydration and resize actions use one
 * clamping rule.
 */
export function readSessionWorkbarWidth(): number {
  const stored = Number(safeLocalStorageGet(SESSION_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? Math.round(stored) : SESSION_WORKBAR_DEFAULT_WIDTH;
}

const SESSION_COLLAPSE_KEY = 'maka-session-workbar-collapsed-v2';

function readSessionWorkbarCollapsed(): Record<string, boolean> {
  try {
    const stored: unknown = JSON.parse(safeLocalStorageGet(SESSION_COLLAPSE_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(([, value]) => typeof value === 'boolean'),
    );
  } catch {
    return {};
  }
}

export function isSessionWorkbarCollapsed(state: WorkbarLayoutState): boolean {
  const id = state.activeSessionId;
  return id !== undefined && Object.hasOwn(state.collapsedBySession, id)
    ? state.collapsedBySession[id]!
    : true;
}

function withRightCollapsed(state: WorkbarLayoutState, collapsed: boolean): WorkbarLayoutState {
  const id = state.activeSessionId;
  if (id === undefined || isSessionWorkbarCollapsed(state) === collapsed) return state;
  return { ...state, collapsedBySession: { ...state.collapsedBySession, [id]: collapsed } };
}

export function readSessionBottomPanelHeight(): number {
  const stored = Number(safeLocalStorageGet('maka-session-bottom-panel-height-v1'));
  return Number.isFinite(stored) && stored > 0
    ? Math.round(stored)
    : SESSION_BOTTOM_PANEL_DEFAULT_HEIGHT;
}

export function readSessionBottomPanelOpen(): boolean {
  return safeLocalStorageGet('maka-session-bottom-panel-open-v1') === 'true';
}

export function loadWorkbarLayout(activeSessionId?: string): WorkbarLayoutState {
  return {
    panels: readSessionWorkbarPanels(),
    activeSessionId,
    collapsedBySession: readSessionWorkbarCollapsed(),
    bottomOpen: readSessionBottomPanelOpen(),
    rightWidth: clampSize(
      readSessionWorkbarWidth(),
      SESSION_WORKBAR_MIN_WIDTH,
      SESSION_WORKBAR_MAX_WIDTH,
    ),
    bottomHeight: clampSize(
      readSessionBottomPanelHeight(),
      SESSION_BOTTOM_PANEL_MIN_HEIGHT,
      SESSION_BOTTOM_PANEL_MAX_HEIGHT,
    ),
  };
}

export function persistWorkbarLayout(
  state: WorkbarLayoutState,
  target: WorkbarLayoutPersistenceTarget = 'all',
): void {
  if (target === 'all' || target === 'topology') {
    safeLocalStorageSet(
      'maka-session-workbar-panels-v3',
      JSON.stringify(persistableSessionWorkbarPanels(state.panels)),
    );
  }
  if (target === 'all' || target === 'right-visibility') {
    safeLocalStorageSet(SESSION_COLLAPSE_KEY, JSON.stringify(state.collapsedBySession));
    // The old global preference has no Session owner and cannot be migrated
    // without giving an unrelated conversation its expanded state.
    try {
      localStorage.removeItem('maka-session-workbar-collapsed-v1');
    } catch {
      // Storage may be unavailable in restricted renderer contexts.
    }
  }
  if (target === 'all' || target === 'bottom-visibility') {
    safeLocalStorageSet('maka-session-bottom-panel-open-v1', state.bottomOpen ? 'true' : 'false');
  }
  if (target === 'all' || target === 'right-size') {
    safeLocalStorageSet(SESSION_WIDTH_KEY, String(state.rightWidth));
    try {
      localStorage.removeItem('maka-session-workbar-width-v1');
    } catch {
      // Storage may be unavailable in restricted renderer contexts.
    }
  }
  if (target === 'all' || target === 'bottom-size') {
    safeLocalStorageSet('maka-session-bottom-panel-height-v1', String(state.bottomHeight));
  }
}

export function reduceWorkbarLayout(
  state: WorkbarLayoutState,
  action: WorkbarLayoutAction,
): WorkbarLayoutState {
  if (action.type === 'activate-session') {
    return state.activeSessionId === action.sessionId
      ? state
      : { ...state, activeSessionId: action.sessionId };
  }
  if (action.type === 'retain-sessions') {
    const entries = Object.entries(state.collapsedBySession).filter(
      ([id]) => id === state.activeSessionId || action.sessionIds.has(id),
    );
    return entries.length === Object.keys(state.collapsedBySession).length
      ? state
      : { ...state, collapsedBySession: Object.fromEntries(entries) };
  }
  if (action.type === 'collapse') {
    if (action.placement === 'right') {
      return withRightCollapsed(state, action.collapsed);
    }
    const bottomOpen = !action.collapsed;
    return state.bottomOpen === bottomOpen ? state : { ...state, bottomOpen };
  }
  if (action.type === 'resize') {
    if (action.placement === 'right') {
      const rightWidth = clampSize(
        action.size,
        SESSION_WORKBAR_MIN_WIDTH,
        SESSION_WORKBAR_MAX_WIDTH,
      );
      return state.rightWidth === rightWidth ? state : { ...state, rightWidth };
    }
    const bottomHeight = clampSize(
      action.size,
      SESSION_BOTTOM_PANEL_MIN_HEIGHT,
      SESSION_BOTTOM_PANEL_MAX_HEIGHT,
    );
    return state.bottomHeight === bottomHeight ? state : { ...state, bottomHeight };
  }

  const panels = reduceWorkbarPanels(
    state.panels,
    action.type === 'remove-stale'
      ? { type: 'close', placement: action.placement, tabIds: action.tabIds }
      : action,
  );
  if (panels === state.panels) return state;
  let rightCollapsed = isSessionWorkbarCollapsed(state);
  let bottomOpen = state.bottomOpen;
  if (action.type === 'open' || action.type === 'open-launcher') {
    if (action.placement === 'right') rightCollapsed = false;
    else bottomOpen = true;
  } else if (action.type === 'move-to-panel') {
    if (action.target === 'right') rightCollapsed = false;
    else bottomOpen = true;
  } else if (
    action.type === 'close' ||
    (action.type === 'remove-stale' && action.placement === 'bottom')
  ) {
    if (
      state.panels[action.placement].tabs.length > 0 &&
      panels[action.placement].tabs.length === 0
    ) {
      if (action.placement === 'right') rightCollapsed = true;
      else bottomOpen = false;
    }
  }
  return withRightCollapsed({ ...state, panels, bottomOpen }, rightCollapsed);
}
