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

// The launch inside the main window — there is no startup window of its own
// (main's startup-presentation.ts):
//
// - StartupLoading, until the Runtime Host is ready: the window's own surface,
//   silent for a short wait, then a quiet spinner with the step, then (a long
//   wait) the elapsed time, a word on why and the diagnostics.
// - StartupHandoff, a modal dialog over whatever the window shows: a Runtime
//   Host handoff — an update, a repair, a replacement — under way or waiting
//   on a decision.
//
// Pure: StartupGate owns the store and the clock, so every state can be
// rendered from plain values.

import { useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/index.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { LoginSurface } from '../account/LoginScreen.js';
import type {
  DesktopStartupHandoff,
  DesktopStartupHandoffAction,
  DesktopStartupPhase,
} from '../../bridge/startup.js';
import { formatStartupElapsed, startupStage } from '../../lib/startup-view.js';
import { getStartupCopy } from '../../locales/startup-copy.js';

const NOTE = 'text-[0.8125rem] leading-5';

export function StartupLoading(props: {
  phase: DesktopStartupPhase;
  elapsedMs: number;
  onCopyDiagnostics: () => Promise<void>;
}) {
  const copy = getStartupCopy(useUiLocale());
  const stage = startupStage(props.elapsedMs);
  return (
    <LoginSurface>
      <div
        className="flex max-w-[26rem] flex-col items-center gap-3 text-center"
        data-maka-contract="startup-loading"
        data-stage={stage}
      >
        {/* Mounted from the first paint, empty while the wait is short: a
            live region that arrives with its words is often not read out. */}
        <div className="flex items-center gap-2 text-text-secondary" role="status">
          {stage !== 'quiet' && (
            <>
              <Anthropicon name="spinner" size={16} className="animate-spin" />
              <span className={NOTE}>{copy.phases[props.phase]}</span>
            </>
          )}
        </div>
        {stage === 'slow' && (
          <>
            <p className={`${NOTE} text-balance text-text-muted`}>{copy.slow}</p>
            <div className="flex items-center gap-3">
              <span className={`${NOTE} tabular-nums text-text-muted`}>
                {copy.elapsed(formatStartupElapsed(props.elapsedMs))}
              </span>
              <CopyDiagnosticsButton onCopy={props.onCopyDiagnostics} />
            </div>
          </>
        )}
      </div>
    </LoginSurface>
  );
}

export interface StartupHandoffProps {
  handoff: DesktopStartupHandoff;
  /** Since the handoff's work got under way; shown while it is. */
  elapsedMs: number;
  onAction: (action: DesktopStartupHandoffAction) => void;
  onCopyDiagnostics: () => Promise<void>;
}

/** What keeps the dialog a decision only its own actions make. */
export const handoffDialogGuards = {
  // Focus lands on the dialog itself, not on a button: Cancel ends the app,
  // and a keystroke meant for the composer must not answer it.
  onOpenAutoFocus(event: Event, content: HTMLElement | null): void {
    event.preventDefault();
    content?.focus();
  },
  // Not Escape, not a click outside.
  onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
  onInteractOutside: (event: Event) => event.preventDefault(),
  // Keys pressed in it stay in it: the shell's shortcuts listen on the
  // document and do not act beneath. (The native menu's accelerators are the
  // operating system's, not the page's, and still reach the app.)
  onKeyDown: (event: { stopPropagation(): void }) => event.stopPropagation(),
};

/** A modal the person did not open, answered once per view (`createHandoffAnswerGuard`). */
export function StartupHandoff(props: StartupHandoffProps) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open>
      <DialogContent
        ref={content}
        className="outline-none md:max-w-[30rem]"
        data-maka-contract="startup-handoff"
        data-handoff={props.handoff.state}
        onOpenAutoFocus={(event) => handoffDialogGuards.onOpenAutoFocus(event, content.current)}
        onEscapeKeyDown={handoffDialogGuards.onEscapeKeyDown}
        onInteractOutside={handoffDialogGuards.onInteractOutside}
        onKeyDown={handoffDialogGuards.onKeyDown}
      >
        <StartupHandoffCard {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's content; inside a `Dialog` (its title and description need one). */
export function StartupHandoffCard(props: StartupHandoffProps) {
  const copy = getStartupCopy(useUiLocale());
  const { handoff } = props;
  return (
    <>
      <DialogHeader hideCloseButton>
        <DialogTitle className="text-balance">{handoff.title}</DialogTitle>
        {/* The detail (versions, the work still running) is part of what the
            decision rests on, so it is read out with the description; while
            the work is under way, each step is announced as it changes. */}
        <DialogDescription asChild>
          <div
            className="flex flex-col gap-4"
            {...(handoff.state === 'progress' ? { 'aria-live': 'polite' as const } : {})}
          >
            <p className="text-pretty">{handoff.description}</p>
            {handoff.detail && <p className="whitespace-pre-line">{handoff.detail}</p>}
          </div>
        </DialogDescription>
      </DialogHeader>
      {handoff.diagnostic && (
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-hairline bg-surface-2 p-3 font-mono text-xs leading-5 text-text-secondary">
          {handoff.diagnostic}
        </pre>
      )}
      {handoff.state === 'progress' && (
        <div className="flex items-center gap-2 text-text-secondary">
          <Anthropicon name="spinner" size={16} className="animate-spin" />
          {/* A timer, not a status: it is not read out every second. */}
          <span className={`${NOTE} tabular-nums`} role="timer">
            {copy.elapsed(formatStartupElapsed(props.elapsedMs))}
          </span>
        </div>
      )}
      <DialogFooter className="md:mt-1 md:flex-wrap md:items-center">
        <span className="md:mr-auto">
          <CopyDiagnosticsButton onCopy={props.onCopyDiagnostics} />
        </span>
        {handoff.actions.map((item) => (
          <Button
            key={item.action}
            // Cancel is the view's default answer (`defaultAction`), drawn as
            // the dialogs' Cancel is; nothing else is pressed on its behalf.
            variant={
              item.action === 'cancel'
                ? 'outline'
                : item.action === 'interrupt'
                  ? 'destructive'
                  : 'secondary'
            }
            className="w-full md:w-auto"
            onClick={() => props.onAction(item.action)}
          >
            {item.label}
          </Button>
        ))}
      </DialogFooter>
    </>
  );
}

function CopyDiagnosticsButton(props: { onCopy: () => Promise<void> }) {
  const copy = getStartupCopy(useUiLocale());
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        void props.onCopy().then(
          () => setOutcome('copied'),
          () => setOutcome('failed'),
        )
      }
    >
      {outcome === 'copied'
        ? copy.copied
        : outcome === 'failed'
          ? copy.copyFailed
          : copy.copyDiagnostics}
    </Button>
  );
}
