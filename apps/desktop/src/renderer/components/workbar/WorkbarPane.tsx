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

// The right pane: the reference design's 8px inset frame, inside the content
// column.
//
// DOCKED, it is the window's second COLUMN — a sibling of the column that
// holds the titlebar and everything under it, not a child of the content area.
// That is what gives it the same 8px eave on all four sides and what makes the
// titlebar narrow when it opens, both without a line of code to arrange it.
//
// FULL SCREEN is this column growing to the whole frame. AppShell stops
// drawing the titlebar for the duration: its three controls all point at
// things the pane is covering, and a row of buttons that do nothing is worse
// than no row. This pane's header clears the OS window controls and takes
// over as the drag surface. The way back out is its own control, or Escape.
//
// EVERY OPEN FACE STAYS MOUNTED, hidden with the `hidden` attribute rather
// than unmounted. A terminal that unmounted would drop its PTY attachment and
// its scrollback, and the browser's native view would be torn down and rebuilt
// on every tab switch. Each face is told whether it is the visible one and
// decides for itself what to keep doing.

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { RightPaneHeader, RightPaneShell } from '../ui/right-pane-shell.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { WorkbarTabStrip } from './WorkbarTabStrip.js';
import { BrowserTab } from './BrowserTab.js';
import { FilesTab } from './FilesTab.js';
import { InspectorTab } from './InspectorTab.js';
import { ReviewTab } from './ReviewTab.js';
import { TerminalTab } from './TerminalTab.js';
import type { WorkbarFace, WorkbarModel } from '../../hooks/use-workbar.js';
import { getWorkbarCopy } from '../../locales/workbar-copy.js';

/** Below this the handle was a click, not a drag. */
const CLICK_SLOP_PX = 3;
const KEYBOARD_STEP = 10;
const KEYBOARD_LARGE_STEP = 50;

export function WorkbarPane(props: { sessionId: string; workbar: WorkbarModel }) {
  const copy = getWorkbarCopy(useUiLocale()).pane;
  const workbar = props.workbar;
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(workbar.width);
  widthRef.current = dragRef.current ? widthRef.current : workbar.width;

  const clamp = useCallback(
    (width: number) => Math.min(workbar.maxWidth, Math.max(workbar.minWidth, Math.round(width))),
    [workbar.maxWidth, workbar.minWidth],
  );

  // The handle sits on the pane's left edge, so its parent IS the box that
  // carries the width (`right-pane-shell` puts the resizer inside it). That is
  // how the drag reaches the element without forking the ported shell to add a
  // `ref` prop.
  const boxOf = (event: PointerEvent<HTMLDivElement>): HTMLElement | null =>
    event.currentTarget.parentElement;

  // During a drag the width is written straight to the element; the store
  // learns about it on release. A store write per pointermove would re-render
  // the transcript beside it sixty times a second.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Dragging left widens the pane: the handle is on its left edge.
    const next = clamp(drag.startWidth - (event.clientX - drag.startX));
    widthRef.current = next;
    boxOf(event)?.style.setProperty('width', `${next}px`);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    // React owns the inline width again; the drag's copy is removed either way.
    boxOf(event)?.style.removeProperty('width');
    if (Math.abs(event.clientX - drag.startX) <= CLICK_SLOP_PX) {
      widthRef.current = workbar.width;
      return;
    }
    workbar.resize(widthRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = widthRef.current + step;
    if (event.key === 'ArrowRight') next = widthRef.current - step;
    if (event.key === 'Home') next = workbar.maxWidth;
    if (event.key === 'End') next = workbar.minWidth;
    if (next === null) return;
    event.preventDefault();
    workbar.resize(clamp(next));
  };

  return (
    <RightPaneShell
      id="maka-workbar-pane"
      width={`${workbar.width}px`}
      minWidth={`${workbar.minWidth}px`}
      expanded={workbar.expanded}
      onExpandedChange={workbar.setExpanded}
      resizer={{
        ariaLabel: copy.resize,
        ariaControls: 'maka-workbar-pane',
        valueMin: workbar.minWidth,
        valueMax: workbar.maxWidth,
        valueNow: workbar.width,
        valueText: copy.resizeValue(workbar.width),
        isResizing,
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onLostPointerCapture: endDrag,
        onKeyDown,
      }}
    >
      <RightPaneHeader>
        <WorkbarTabStrip workbar={workbar} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={workbar.expanded ? copy.collapse : copy.expand}
              aria-pressed={workbar.expanded}
              onClick={() => workbar.setExpanded(!workbar.expanded)}
            >
              <Anthropicon name={workbar.expanded ? 'collapse' : 'expand'} size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {workbar.expanded ? copy.collapse : copy.expand}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={copy.close}
              onClick={() => workbar.setCollapsed(true)}
            >
              <Anthropicon name="x" size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{copy.close}</TooltipContent>
        </Tooltip>
      </RightPaneHeader>

      <div id="maka-workbar-body" className="flex min-h-0 flex-1 flex-col">
        {workbar.tabs.map((tab) => {
          const face = tab.kind as WorkbarFace;
          const active = tab.id === workbar.activeTabId;
          return (
            <div
              key={tab.id}
              role="tabpanel"
              aria-labelledby={`maka-workbar-tab-${tab.id}`}
              hidden={!active}
              className={active ? 'flex min-h-0 flex-1 flex-col' : undefined}
            >
              <Face face={face} sessionId={props.sessionId} active={active} />
            </div>
          );
        })}
      </div>
    </RightPaneShell>
  );
}

function Face(props: { face: WorkbarFace; sessionId: string; active: boolean }) {
  switch (props.face) {
    case 'files':
      return <FilesTab sessionId={props.sessionId} active={props.active} />;
    case 'review':
      return <ReviewTab sessionId={props.sessionId} active={props.active} />;
    case 'terminal':
      return <TerminalTab sessionId={props.sessionId} active={props.active} />;
    case 'inspector':
      return <InspectorTab sessionId={props.sessionId} active={props.active} />;
    case 'browser':
      return <BrowserTab sessionId={props.sessionId} visible={props.active} />;
  }
}
