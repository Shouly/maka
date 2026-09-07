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

// Sidebar geometry: width, collapse, and the collapsed-state hover peek.
//
// Ported from the reference design system's `useResizableSidebarWidth` and
// `useSidebarPeek`, with two substitutions. Persistence moves from a cookie to
// `uiStore` (`maka-chat-list-width-v1` / `-collapsed-v1`, keys the main-process
// tests pin), and the width bounds become Maka's, which are wider on both ends
// than the reference's 200-420 because the rail carries a project line and a
// timestamp per row. Everything else — pointer capture, the 3px click slop that
// lets the handle double as a collapse button, keyboard steps, the 120 ms peek
// grace and the portal/keyboard-focus rules that keep peek open — is the
// reference behaviour unchanged.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useStore } from 'zustand';
import { uiStore } from '../store/index.js';
import {
  SESSION_LIST_EXPANDED_MAX_WIDTH,
  SESSION_LIST_EXPANDED_MIN_WIDTH,
  clampSessionListWidth,
} from '../lib/ported/session-list-layout.js';

const KEYBOARD_STEP = 10;
const KEYBOARD_LARGE_STEP = 20;
/** Pressing shakes the pointer a pixel or two; below this it was a click. */
const CLICK_SLOP_PX = 3;
/** Grace between the pointer leaving and peek closing; also the portal poll. */
const PEEK_CLOSE_DELAY_MS = 120;

/**
 * Only the sidebar's OWN overlays pin peek open. Menus and dialogs render
 * outside the panel, so the panel sees `pointerleave` when the pointer enters
 * them; these two attributes are how they are recognised again. Do not widen
 * this to `[role="dialog"]` — Radix popovers and tooltips carry that too, so a
 * tooltip anywhere would pin the panel open forever.
 */
const PEEK_PORTAL_SELECTOR = '[data-sidebar-overlay="true"], [data-app-dialog][data-state="open"]';

type PendingFocusTarget = 'opener' | 'close';

interface ResizeSession {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  moved: boolean;
}

export interface SidebarLayout {
  collapsed: boolean;
  width: number;
  isResizing: boolean;
  isPeekOpen: boolean;
  /** True when the panel is on screen: expanded, or collapsed and peeking. */
  visible: boolean;
  sidebarRef: RefObject<HTMLDivElement | null>;
  resizeHandleRef: RefObject<HTMLDivElement | null>;
  peekOpenerRef: RefObject<HTMLButtonElement | null>;
  sidebarCloseButtonRef: RefObject<HTMLButtonElement | null>;
  sidebarStyle: CSSProperties;
  toggle(): void;
  requestSidebarFocus(target: PendingFocusTarget): void;
  closePeek(): void;
  openerHoverProps: {
    onPointerEnter(event: ReactPointerEvent<HTMLDivElement>): void;
    onPointerLeave(): void;
    onFocus(): void;
    onBlur(): void;
  };
  panelHoverProps: Record<string, unknown>;
  wasResizeDragged(): boolean;
  onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizePointerMove(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizePointerEnd(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void;
}

export function useSidebarLayout(): SidebarLayout {
  const collapsed = useStore(uiStore, (state) => state.sidebarCollapsed);
  const storedWidth = useStore(uiStore, (state) => state.sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [isPeekOpen, setIsPeekOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const peekOpenerRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);
  const widthRef = useRef(storedWidth);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const frameRef = useRef<number | null>(null);
  const previousCursorRef = useRef('');
  const previousUserSelectRef = useRef('');
  const lastGestureMovedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusRef = useRef<PendingFocusTarget | null>(null);
  const suppressNextOpenerFocusRef = useRef(false);
  const lastInputModalityRef = useRef<'pointer' | 'keyboard'>('pointer');

  useEffect(() => {
    widthRef.current = storedWidth;
  }, [storedWidth]);

  const publish = useCallback((width: number) => {
    sidebarRef.current?.style.setProperty('--sidebar-expanded-width', `${width}px`);
    // The titlebar's left segment reads the same live width, so its edge
    // tracks the drag frame by frame instead of waiting for the React commit.
    sidebarRef.current
      ?.closest<HTMLElement>('.appFrame')
      ?.style.setProperty('--maka-sidenav-width', `${width}px`);
    resizeHandleRef.current?.setAttribute('aria-valuenow', String(width));
    resizeHandleRef.current?.setAttribute('aria-valuetext', `${width}px`);
  }, []);

  // During a drag the width is written straight to the DOM once per frame; the
  // store learns about it on release. A store write per pointermove would
  // re-render every row in the list sixty times a second.
  const scheduleWidth = useCallback(
    (width: number) => {
      widthRef.current = width;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        publish(widthRef.current);
      });
    },
    [publish],
  );

  const commitWidth = useCallback(
    (next: number) => {
      const width = clampSessionListWidth(next);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      widthRef.current = width;
      publish(width);
      uiStore.setSidebarWidth(width);
    },
    [publish],
  );

  const restoreDocumentInteraction = useCallback(() => {
    document.body.style.cursor = previousCursorRef.current;
    document.body.style.userSelect = previousUserSelectRef.current;
  }, []);

  const finishResize = useCallback(
    (handle?: HTMLDivElement, pointerId?: number) => {
      const session = resizeSessionRef.current;
      if (!session) return;
      if (pointerId !== undefined && session.pointerId !== pointerId) return;
      resizeSessionRef.current = null;
      lastGestureMovedRef.current = session.moved;
      if (handle && pointerId !== undefined && handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      commitWidth(session.width);
      restoreDocumentInteraction();
      setIsResizing(false);
    },
    [commitWidth, restoreDocumentInteraction],
  );

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || resizeSessionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      width: widthRef.current,
      moved: false,
    };
    previousCursorRef.current = document.body.style.cursor;
    previousUserSelectRef.current = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  }, []);

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = resizeSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientX - session.startX) > CLICK_SLOP_PX) session.moved = true;
      const width = clampSessionListWidth(session.startWidth + event.clientX - session.startX);
      session.width = width;
      scheduleWidth(width);
    },
    [scheduleWidth],
  );

  const onResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      finishResize(event.currentTarget, event.pointerId);
    },
    [finishResize],
  );

  const onResizeLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => finishResize(event.currentTarget, event.pointerId),
    [finishResize],
  );

  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
      let next: number | null = null;
      if (event.key === 'ArrowLeft') next = widthRef.current - step;
      if (event.key === 'ArrowRight') next = widthRef.current + step;
      if (event.key === 'Home') next = SESSION_LIST_EXPANDED_MIN_WIDTH;
      if (event.key === 'End') next = SESSION_LIST_EXPANDED_MAX_WIDTH;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      commitWidth(next);
    },
    [commitWidth],
  );

  useEffect(() => {
    if (!isResizing) return;
    const finishOnBlur = () => finishResize();
    window.addEventListener('blur', finishOnBlur);
    return () => window.removeEventListener('blur', finishOnBlur);
  }, [finishResize, isResizing]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (resizeSessionRef.current) restoreDocumentInteraction();
    },
    [restoreDocumentInteraction],
  );

  const cancelPeekClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPeek = useCallback(() => {
    if (!collapsed) return;
    cancelPeekClose();
    setIsPeekOpen(true);
  }, [cancelPeekClose, collapsed]);

  const closePeek = useCallback(() => {
    cancelPeekClose();
    setIsPeekOpen(false);
  }, [cancelPeekClose]);

  const closeWhenIdle = useCallback(() => {
    const active = document.activeElement;
    const hasKeyboardFocus =
      lastInputModalityRef.current === 'keyboard' &&
      active instanceof HTMLElement &&
      (sidebarRef.current?.contains(active) === true || peekOpenerRef.current === active);
    if (hasKeyboardFocus) {
      closeTimerRef.current = null;
      return;
    }
    // `:hover` is the browser's own bookkeeping. A hand-kept flag gets stuck
    // when React unmounts a child under the pointer and the synthetic
    // `pointerleave` arrives with a null relatedTarget.
    const pointerOnPanel =
      sidebarRef.current?.matches(':hover') === true ||
      peekOpenerRef.current?.matches(':hover') === true;
    if (pointerOnPanel) {
      closeTimerRef.current = null;
      return;
    }
    if (document.querySelector(PEEK_PORTAL_SELECTOR)) {
      closeTimerRef.current = setTimeout(closeWhenIdle, PEEK_CLOSE_DELAY_MS);
      return;
    }
    setIsPeekOpen(false);
    closeTimerRef.current = null;
  }, []);

  const schedulePeekClose = useCallback(() => {
    cancelPeekClose();
    closeTimerRef.current = setTimeout(closeWhenIdle, PEEK_CLOSE_DELAY_MS);
  }, [cancelPeekClose, closeWhenIdle]);

  const requestSidebarFocus = useCallback((target: PendingFocusTarget) => {
    pendingFocusRef.current = target;
  }, []);

  useEffect(() => {
    if (!collapsed) setIsPeekOpen(false);
    return cancelPeekClose;
  }, [cancelPeekClose, collapsed]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const frame = requestAnimationFrame(() => {
      if (pending === 'opener') {
        // Focusing the opener would reopen peek through its own onFocus.
        suppressNextOpenerFocusRef.current = true;
        peekOpenerRef.current?.focus();
        suppressNextOpenerFocusRef.current = false;
      } else sidebarCloseButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, isPeekOpen]);

  useEffect(() => {
    if (!isPeekOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector(PEEK_PORTAL_SELECTOR)
      )
        return;
      event.preventDefault();
      cancelPeekClose();
      if (peekOpenerRef.current !== document.activeElement) pendingFocusRef.current = 'opener';
      setIsPeekOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [cancelPeekClose, isPeekOpen]);

  useEffect(() => {
    if (!isPeekOpen) return;
    window.addEventListener('blur', closePeek);
    return () => window.removeEventListener('blur', closePeek);
  }, [closePeek, isPeekOpen]);

  useEffect(() => {
    const markPointer = () => {
      lastInputModalityRef.current = 'pointer';
    };
    const markKeyboard = () => {
      lastInputModalityRef.current = 'keyboard';
    };
    window.addEventListener('pointerdown', markPointer, true);
    window.addEventListener('pointermove', markPointer, true);
    window.addEventListener('keydown', markKeyboard, true);
    return () => {
      window.removeEventListener('pointerdown', markPointer, true);
      window.removeEventListener('pointermove', markPointer, true);
      window.removeEventListener('keydown', markKeyboard, true);
    };
  }, []);

  const visible = !collapsed || isPeekOpen;

  return {
    collapsed,
    width: storedWidth,
    isResizing,
    isPeekOpen,
    visible,
    sidebarRef,
    resizeHandleRef,
    peekOpenerRef,
    sidebarCloseButtonRef,
    sidebarStyle: { '--sidebar-expanded-width': `${storedWidth}px` } as CSSProperties,
    toggle: () => uiStore.setSidebarCollapsed(!uiStore.getState().sidebarCollapsed),
    requestSidebarFocus,
    closePeek,
    openerHoverProps: {
      onPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => {
        // Touch and pen have no hover: a tap fires pointerenter before click,
        // so without this the panel flashes open a frame before being pinned.
        if (event.pointerType !== 'mouse') return;
        openPeek();
      },
      onPointerLeave: schedulePeekClose,
      onFocus: () => {
        if (suppressNextOpenerFocusRef.current) {
          suppressNextOpenerFocusRef.current = false;
          return;
        }
        openPeek();
      },
      onBlur: schedulePeekClose,
    },
    panelHoverProps: isPeekOpen
      ? {
          onPointerEnter: openPeek,
          onPointerLeave: schedulePeekClose,
          onFocusCapture: openPeek,
          onBlurCapture: (event: React.FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              schedulePeekClose();
          },
        }
      : {},
    wasResizeDragged: () => lastGestureMovedRef.current,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerEnd,
    onResizeLostPointerCapture,
    onResizeKeyDown,
  };
}
