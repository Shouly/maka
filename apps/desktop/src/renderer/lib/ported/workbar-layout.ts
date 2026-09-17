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
 * The range a reader may drag the pane through, as shares of the content area.
 *
 * The reference's own bounds: it clamps the TRANSCRIPT to 30–80%, which is this
 * pane at 20–70%. The default sits at half, in the MIDDLE of that range, and
 * that is the point — the ceiling used to be half as well, so every pane opened
 * pinned against it and the widening half of the drag was dead on arrival.
 *
 * The floor here is a sanity bound; the real one is `SESSION_WORKBAR_MIN_WIDTH`,
 * applied to the pixels these shares resolve to.
 */
export const SESSION_WORKBAR_MIN_FRACTION = 0.2;
export const SESSION_WORKBAR_MAX_FRACTION = 0.7;
/** Half the content area — an even split, and the middle of the drag's range. */
export const SESSION_WORKBAR_DEFAULT_FRACTION = SESSION_WORKBAR_WIDTH_FRACTION;
export const SESSION_BOTTOM_PANEL_DEFAULT_HEIGHT = 300;
export const SESSION_BOTTOM_PANEL_MIN_HEIGHT = 180;
export const SESSION_BOTTOM_PANEL_MAX_HEIGHT = 520;

export interface WorkbarLayoutState {
  panels: SessionWorkbarPanelsState;
  activeSessionId: string | undefined;
  /** Whether the right column is hidden, per session. Absent means shown. */
  collapsedBySession: Record<string, boolean>;
  /**
   * WHICH viewer holds the right column, per session — a tab id, or absent for
   * the session panel.
   *
   * It is an id rather than a boolean, and that is the whole point. The two
   * facts have different grain: `panels` is ONE global topology, while holding
   * the column is per session. A boolean could say "the workbar holds it" while
   * the global list was empty, and then the pane rendered a body that mapped
   * over zero tabs — a blank column with the session panel suppressed behind
   * it. An id cannot: it either names a tab that is open, or it names nothing,
   * and `sessionWorkbarViewerId` is where that is checked.
   *
   * It also cannot be derived from the global list, for the original reason: a
   * face opened once in any session would otherwise claim the column in every
   * session, for good.
   */
  viewerBySession: Record<string, string | undefined>;
  bottomOpen: boolean;
  /**
   * The pane's share of the content area, not its size in pixels.
   *
   * A share rescales; a size does not. With pixels stored, collapsing the
   * session list handed all 260 of its pixels to the transcript and left the
   * pane exactly where it was — the split the reader had chosen quietly became
   * a different split. The reference stores a percentage of the content area
   * for this reason, and recomputes both columns from it.
   */
  rightFraction: number;
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

function clampFraction(fraction: number): number {
  return Math.min(SESSION_WORKBAR_MAX_FRACTION, Math.max(SESSION_WORKBAR_MIN_FRACTION, fraction));
}

// Its own key, not a version bump on the pixel one: the number answers a
// different question now — what SHARE of the content the pane takes — and a
// stored 756 read as a share would be nonsense.
const SESSION_SPLIT_KEY = 'maka-session-workbar-split-v1';
const RETIRED_WIDTH_KEYS = ['maka-session-workbar-width-v1', 'maka-session-workbar-width-v2'];

/**
 * Reads the persisted share without applying bounds. `loadWorkbarLayout`
 * applies the shared reducer policy so hydration and resize actions use one
 * clamping rule.
 */
export function readSessionWorkbarFraction(): number {
  const stored = Number(safeLocalStorageGet(SESSION_SPLIT_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : SESSION_WORKBAR_DEFAULT_FRACTION;
}

const SESSION_COLLAPSE_KEY = 'maka-session-workbar-collapsed-v2';
// v1 of this is the boolean it replaces — a different question with the same
// answer shape, so it gets its own name rather than a version bump.
const SESSION_VIEWER_KEY = 'maka-session-workbar-viewer-v1';
const RETIRED_OCCUPANT_KEY = 'maka-session-workbar-occupant-v1';

function readSessionStringMap(key: string): Record<string, string | undefined> {
  try {
    const stored: unknown = JSON.parse(safeLocalStorageGet(key) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(([, value]) => typeof value === 'string' && value.length > 0),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function readSessionBooleanMap(key: string): Record<string, boolean> {
  try {
    const stored: unknown = JSON.parse(safeLocalStorageGet(key) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(([, value]) => typeof value === 'boolean'),
    );
  } catch {
    return {};
  }
}

/**
 * Whether the right column is hidden. It is shown by default: with the session
 * panel as its resting occupant the column always has something to say, so
 * starting hidden would hide the session's own state until a reader went
 * looking for a switch.
 */
export function isSessionWorkbarCollapsed(state: WorkbarLayoutState): boolean {
  return sessionFlag(state.collapsedBySession, state.activeSessionId);
}

/**
 * The viewer holding the right column for the active session, or null for the
 * session panel — which is where a session starts and where it returns.
 *
 * The check against the open tab list is the invariant, not a precaution: a
 * remembered id whose tab is gone (closed in another session, or dropped on
 * restart because its kind is not persisted) means the viewer no longer
 * exists, and a column held by something that does not exist is a blank pane.
 */
export function sessionWorkbarViewerId(state: WorkbarLayoutState): string | null {
  const id =
    state.activeSessionId === undefined ? undefined : state.viewerBySession[state.activeSessionId];
  if (id === undefined) return null;
  return state.panels.right.tabs.some((tab) => tab.id === id) ? id : null;
}

function sessionFlag(map: Record<string, boolean>, id: string | undefined): boolean {
  return id !== undefined && Object.hasOwn(map, id) ? map[id]! : false;
}

function withRightCollapsed(state: WorkbarLayoutState, collapsed: boolean): WorkbarLayoutState {
  const id = state.activeSessionId;
  if (id === undefined || sessionFlag(state.collapsedBySession, id) === collapsed) return state;
  return { ...state, collapsedBySession: { ...state.collapsedBySession, [id]: collapsed } };
}

function withColumnViewer(state: WorkbarLayoutState, viewerId: string | null): WorkbarLayoutState {
  const id = state.activeSessionId;
  if (id === undefined) return state;
  const current = state.viewerBySession[id];
  if (current === (viewerId ?? undefined)) return state;
  const next = { ...state.viewerBySession };
  if (viewerId === null) delete next[id];
  else next[id] = viewerId;
  return { ...state, viewerBySession: next };
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
    collapsedBySession: readSessionBooleanMap(SESSION_COLLAPSE_KEY),
    viewerBySession: readSessionStringMap(SESSION_VIEWER_KEY),
    bottomOpen: readSessionBottomPanelOpen(),
    rightFraction: clampFraction(readSessionWorkbarFraction()),
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
    safeLocalStorageSet(SESSION_VIEWER_KEY, JSON.stringify(state.viewerBySession));
    // The old global preference has no Session owner and cannot be migrated
    // without giving an unrelated conversation its expanded state. The occupant
    // boolean cannot be migrated either — it said THAT a viewer held the
    // column, never which one, and guessing one would open a session on a face
    // nobody chose.
    for (const retired of ['maka-session-workbar-collapsed-v1', RETIRED_OCCUPANT_KEY]) {
      try {
        localStorage.removeItem(retired);
      } catch {
        // Storage may be unavailable in restricted renderer contexts.
      }
    }
  }
  if (target === 'all' || target === 'bottom-visibility') {
    safeLocalStorageSet('maka-session-bottom-panel-open-v1', state.bottomOpen ? 'true' : 'false');
  }
  if (target === 'all' || target === 'right-size') {
    safeLocalStorageSet(SESSION_SPLIT_KEY, String(state.rightFraction));
    for (const retired of RETIRED_WIDTH_KEYS) {
      try {
        localStorage.removeItem(retired);
      } catch {
        // Storage may be unavailable in restricted renderer contexts.
      }
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
    const viewers = Object.entries(state.viewerBySession).filter(([id]) =>
      action.sessionIds.has(id),
    );
    return entries.length === Object.keys(state.collapsedBySession).length &&
      viewers.length === Object.keys(state.viewerBySession).length
      ? state
      : {
          ...state,
          collapsedBySession: Object.fromEntries(entries),
          viewerBySession: Object.fromEntries(viewers),
        };
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
      // `size` is the share the caller measured against the content area; only
      // it knows how wide that is.
      const rightFraction = clampFraction(action.size);
      return state.rightFraction === rightFraction ? state : { ...state, rightFraction };
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
  let columnViewer = sessionWorkbarViewerId(state);
  let bottomOpen = state.bottomOpen;
  switch (action.type) {
    case 'open':
      // Opening a viewer is the act that hands it the column, and it reveals
      // the column if it was hidden. WHICH viewer is the one just opened — not
      // whatever the global topology happened to have active.
      if (action.placement === 'right') {
        rightCollapsed = false;
        columnViewer = action.tab.id;
      } else bottomOpen = true;
      break;
    case 'activate':
      if (action.placement === 'right') {
        rightCollapsed = false;
        columnViewer = action.tabId;
      } else bottomOpen = true;
      break;
    case 'open-launcher':
      if (action.placement === 'right') rightCollapsed = false;
      else bottomOpen = true;
      break;
    case 'move-to-panel':
      if (action.target === 'right') rightCollapsed = false;
      else bottomOpen = true;
      break;
    case 'close':
    case 'remove-stale':
      // The bottom panel has no resting occupant, so emptying it closes it.
      if (action.placement === 'bottom' && panels.bottom.tabs.length === 0) bottomOpen = false;
      break;
    default:
      break;
  }
  // Whatever the action, the column can only be held by a tab that is still
  // open. Closing the one on screen falls back to the panel's own next choice —
  // another open viewer if there is one, and otherwise the session panel.
  if (columnViewer !== null && !panels.right.tabs.some((tab) => tab.id === columnViewer)) {
    columnViewer = panels.right.activeTabId;
  }
  return withColumnViewer(
    withRightCollapsed({ ...state, panels, bottomOpen }, rightCollapsed),
    columnViewer,
  );
}
