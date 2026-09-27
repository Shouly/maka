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

// The launch's two gates. StartupHandoffLayer, at the app root and outside
// its error boundary, starts the store and opens a Runtime Host handoff as a
// dialog over everything — the sign-in screens and the app included — without
// unmounting them. HostReadyGate holds the app itself until the Runtime Host
// is ready: the app's stores read the Host on mount, so it mounts when they
// can, as it always has; the window around it has simply been open the whole
// time.

import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import {
  copyStartupDiagnostics,
  type DesktopStartupHandoff,
  submitStartupHandoff,
} from '../../bridge/startup.js';
import {
  createHandoffAnswerGuard,
  startupHoldsApp,
  startupWaitSince,
} from '../../lib/startup-view.js';
import { startupStore } from '../../store/index.js';
import { StartupHandoff, StartupLoading } from './StartupScreens.js';

/** Milliseconds since `since`, ticking while `running`. */
function useElapsed(since: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);
  return since === undefined ? 0 : Math.max(0, now - since);
}

export function StartupHandoffLayer(props: { children: ReactNode }) {
  const handoff = useStore(startupStore, (state) => state.startup?.handoff);
  useEffect(() => startupStore.start(), []);
  return (
    <>
      {props.children}
      {/* Keyed by owner: another target's handoff is another dialog, with
          nothing (a "copied" note, a held press) carried over from this one. */}
      {handoff && <HandoffDialog key={handoff.owner} handoff={handoff} />}
    </>
  );
}

function HandoffDialog(props: { handoff: DesktopStartupHandoff }) {
  const { handoff } = props;
  // The handoff's own clock, stamped by main when its work got under way —
  // not the launch's, nor the time a decision took.
  const underWay = handoff.state === 'progress';
  const elapsedMs = useElapsed(underWay ? handoff.since : undefined, underWay);
  const guard = useRef(createHandoffAnswerGuard()).current;
  guard.show(handoff.revision);
  const answer = (action: Parameters<typeof submitStartupHandoff>[1]) => {
    if (!guard.take()) return;
    void submitStartupHandoff(handoff.revision, action).then(
      (accepted) => {
        if (!accepted) guard.release();
      },
      () => guard.release(),
    );
  };
  return (
    <HandoffBoundary handoff={handoff} onAction={answer}>
      <StartupHandoff
        handoff={handoff}
        elapsedMs={elapsedMs}
        onAction={answer}
        onCopyDiagnostics={copyStartupDiagnostics}
      />
    </HandoffBoundary>
  );
}

/**
 * Main waits on this dialog's answer, and a render error here would take the
 * whole window with it — so a failure falls back to the plainest dialog that
 * can still be answered.
 */
class HandoffBoundary extends Component<
  {
    handoff: DesktopStartupHandoff;
    onAction: (action: DesktopStartupHandoff['actions'][number]['action']) => void;
    children: ReactNode;
  },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.error('[startup] handoff dialog failed:', error);
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { handoff, onAction } = this.props;
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={handoff.title}
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-surface-1 p-6 text-center"
      >
        <p className="text-base font-semibold text-text-primary">{handoff.title}</p>
        <p className="max-w-md text-sm text-text-secondary">{handoff.description}</p>
        <div className="flex gap-2">
          {handoff.actions.map((item) => (
            <button
              key={item.action}
              type="button"
              className="rounded-lg border border-hairline px-3 py-1.5 text-sm text-text-primary"
              onClick={() => onAction(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
}

export function HostReadyGate(props: { children: ReactNode }) {
  const startup = useStore(startupStore, (state) => state.startup);
  const holds = startupHoldsApp(startup);
  const [mountedAt] = useState(() => Date.now());
  const since = startupWaitSince(startup?.startedAt, mountedAt, performance.timeOrigin);
  const elapsedMs = useElapsed(since, holds);
  if (!holds) return props.children;
  return (
    <StartupLoading
      phase={startup?.phase ?? 'prepare'}
      elapsedMs={elapsedMs}
      onCopyDiagnostics={copyStartupDiagnostics}
    />
  );
}
