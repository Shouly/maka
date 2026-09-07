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

// The chrome around a page this renderer does not draw.
//
// The page is a native `WebContentsView` floating ABOVE the renderer DOM, not a
// React child. This component draws the address bar and the nav controls, then
// reserves a rectangle and publishes its on-screen position to main, which
// moves the native view to match. Everything about the face follows from that:
//
//   The rect is measured per animation frame, not by a ResizeObserver. The
//   strip MOVES without changing size — a sidebar drag, a window resize, the
//   pane's own resize — and an observer sees none of that. The IPC only fires
//   when the numbers actually change, so the steady state is one
//   `getBoundingClientRect` per frame and nothing else.
//
//   A null rect HIDES the native layer, and that is the only way to get the
//   DOM back in front of it. It is published whenever the face is not the one
//   on screen, whenever the pane is collapsed, and whenever a modal dialog is
//   open — a `dialog:modal` paints in the top layer of the DOM, which the
//   native view sits above, so without this a confirm dialog would open behind
//   the page (the same rule `titlebar-modal-sync.ts` applies to the titlebar).
//
//   `setActiveSession` tells main which session's view may be shown at all, so
//   switching tasks cannot leave the previous task's page hanging over the new
//   one's conversation.

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeBrowserAddressInput, type BrowserState } from '@maka/core/browser';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { PreviewNotice } from './PreviewNotice.js';
import {
  browserBack,
  browserForward,
  closeBrowser,
  getBrowserState,
  navigateBrowser,
  reloadBrowser,
  setActiveBrowserSession,
  setBrowserViewport,
  stopBrowser,
  subscribeBrowserState,
} from '../../bridge/browser.js';
import { toast } from '../../store/toast-store.js';
import { getBrowserCopy, type BrowserCopy } from '../../locales/browser-copy.js';

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false,
  secure: false,
  hasPage: false,
};

/** Any open modal dialog: the native view would otherwise cover it. */
const MODAL_SELECTOR = 'dialog[open], [role="dialog"][data-state="open"]';

function addressFailureCopy(
  reason: 'unsupported_scheme' | 'invalid_url',
  copy: BrowserCopy,
): string {
  return reason === 'unsupported_scheme' ? copy.unsupportedScheme : copy.invalidUrl;
}

export function BrowserTab(props: { sessionId: string; visible: boolean }) {
  const { sessionId, visible } = props;
  const copy = getBrowserCopy(useUiLocale());
  const stripRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserState>(EMPTY_STATE);
  // The address field is editable; it only snaps to the live URL when the user
  // is not mid-edit, so a `did-navigate` push never clobbers what is typed.
  const [address, setAddress] = useState('');
  const editingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    editingRef.current = false;
    setState(EMPTY_STATE);
    setAddress('');
    const apply = (next: BrowserState) => {
      if (!alive) return;
      setState(next);
      if (!editingRef.current) setAddress(next.url);
    };
    void getBrowserState(sessionId)
      .then((next) => apply(next ?? EMPTY_STATE))
      .catch(() => apply(EMPTY_STATE));
    const off = subscribeBrowserState((payload) => {
      if (payload.sessionId === sessionId) apply(payload.state);
    });
    return () => {
      alive = false;
      off();
    };
  }, [sessionId]);

  // Which session's native view main may show. Cleared on unmount so a task
  // with a live page cannot paint over the next task's conversation.
  useEffect(() => {
    setActiveBrowserSession(sessionId);
    return () => setActiveBrowserSession(null);
  }, [sessionId]);

  const showView = visible && state.hasPage;
  useEffect(() => {
    if (!showView) {
      setBrowserViewport({ sessionId, rect: null });
      return;
    }
    const element = stripRef.current;
    if (!element) return;
    let frame = 0;
    let last = '';
    const tick = () => {
      const modal = document.querySelector(MODAL_SELECTOR) !== null;
      const box = element.getBoundingClientRect();
      const rect = modal
        ? null
        : {
            x: Math.round(box.left),
            y: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
      const key = rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : 'hidden';
      if (key !== last) {
        last = key;
        setBrowserViewport({ sessionId, rect });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setBrowserViewport({ sessionId, rect: null });
    };
  }, [sessionId, showView]);

  const go = useCallback(() => {
    const result = normalizeBrowserAddressInput(address);
    if (!result.ok) {
      if (result.reason !== 'empty') {
        toast({
          title: copy.openFailed,
          description: addressFailureCopy(result.reason, copy),
          variant: 'destructive',
        });
      }
      return;
    }
    void navigateBrowser(sessionId, result.url).catch(() =>
      toast({
        title: copy.navigationFailed,
        description: copy.navigationFailedDetail,
        variant: 'destructive',
      }),
    );
  }, [address, copy, sessionId]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-maka-contract="session-browser"
      role="region"
      aria-label={state.title ? copy.panelAriaWithTitle(state.title) : copy.panelAria}
    >
      <div
        className="flex shrink-0 items-center gap-1 px-2 py-2"
        role="toolbar"
        aria-label={copy.panelAria}
      >
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={copy.backAria}
          disabled={!state.canGoBack}
          onClick={() => void browserBack(sessionId)}
        >
          <Anthropicon name="arrowLeft" size={16} />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={copy.forwardAria}
          disabled={!state.canGoForward}
          onClick={() => void browserForward(sessionId)}
        >
          <Anthropicon name="arrowRight" size={16} />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={state.loading ? copy.stopAria : copy.refreshAria}
          disabled={!state.hasPage && !state.loading}
          onClick={() =>
            state.loading ? void stopBrowser(sessionId) : void reloadBrowser(sessionId)
          }
        >
          <Anthropicon name={state.loading ? 'x' : 'arrowClockwise'} size={16} />
        </Button>
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          type="text"
          aria-label={copy.addressAria}
          placeholder={copy.addressPlaceholder}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            editingRef.current = false;
            setAddress(state.url);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.currentTarget.blur();
            go();
          }}
        />
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={copy.closeAria}
          disabled={!state.hasPage}
          onClick={() => void closeBrowser(sessionId)}
        >
          <Anthropicon name="x" size={16} />
        </Button>
      </div>
      {state.hasPage && !state.secure && (
        <p className="shrink-0 px-3 pb-2 text-xs leading-4 text-warning" role="status">
          {copy.insecure}
        </p>
      )}
      {/* The reserved rectangle. Empty by design: whatever is on screen here is
          painted by main, above this element. */}
      <div ref={stripRef} className="min-h-0 flex-1" data-maka-browser-strip="">
        {!state.hasPage && (
          <PreviewNotice icon="globe" title={copy.title} detail={copy.description} />
        )}
      </div>
    </div>
  );
}
