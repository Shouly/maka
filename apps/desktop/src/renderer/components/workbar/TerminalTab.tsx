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

// A live terminal, attached to one of the session's shell runs.
//
// One face with a run picker rather than one tab per run: multi-instance
// terminals are listed as low-usage in the pre-rewrite inventory (§8), and a
// picker keeps the strip readable while still reaching every run — including
// the ones the assistant started, which is how "Open in Terminal" on a shell
// row lands here.
//
// The three things that make an attached terminal correct, all ported:
//
//   HYDRATION. `attach` returns a buffer and the sequence it ends at; PTY
//   frames that arrived while that round trip was in flight are replayed
//   after it, in order, exactly once (`SessionTerminalHydration`). Writing the
//   live frames first and the snapshot after would print the past over the
//   present.
//
//   QUERY SUPPRESSION. xterm answers capability probes (DA, DSR, OSC colour
//   queries) on its own. Those replies would enter the durable Runtime
//   Resource input path and surface at the next prompt, so they are
//   intercepted (`suppressTerminalQueryReplies`); setters still reach xterm.
//
//   GEOMETRY. The fit addon runs on a ResizeObserver and on activation, and
//   the resulting cols/rows are pushed to the PTY only when they change — a
//   resize per frame would make a full-screen program redraw continuously.
//
// The colour theme is built from the design tokens at mount and rebuilt when
// the theme class flips, so the terminal is the same two surfaces as the pane
// around it rather than a black rectangle inside a white panel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { ShellRunUpdate } from '@maka/core/events';
import { generalizedErrorMessageForLocale } from '@maka/core/redaction';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { PreviewNotice } from './PreviewNotice.js';
import {
  attachShellRun,
  detachShellRun,
  startShellRun,
  stopShellRun,
  subscribeShellRunPtyData,
  subscribeShellRunResync,
  writeShellRun,
} from '../../bridge/shell-runs.js';
import { activeSessionStore } from '../../store/index.js';
import { workbarStore } from '../../store/workbar-store.js';
import { SessionTerminalHydration } from '../../lib/ported/session-terminal-hydration.js';
import { suppressTerminalQueryReplies } from '../../lib/ported/session-terminal-query.js';
import { scheduleTerminalFrame } from '../../lib/ported/session-terminal-frame.js';
import { getTerminalFontSize, subscribeTerminalFontSize } from '../../lib/theme.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import { getWorkbarCopy } from '../../locales/workbar-copy.js';

/**
 * The xterm palette, read from the tokens the pane itself paints with.
 *
 * The terminal follows the app theme rather than staying black: it sits inside
 * a light panel, and a black rectangle in the middle of `surface-3` reads as a
 * hole. The ANSI eight come from the Prism `--code-*` roles, which are already
 * declared once per theme and already contrast-checked against these surfaces
 * — so a `ls --color` and a highlighted code block agree on what green is.
 */
function terminalTheme(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const value = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: value('--surface-2', '#ffffff'),
    foreground: value('--text-primary', '#0b0b0b'),
    cursor: value('--text-primary', '#0b0b0b'),
    cursorAccent: value('--surface-2', '#ffffff'),
    selectionBackground: value('--bg-accent', 'rgba(128, 128, 128, 0.35)'),
    black: value('--code-punctuation', '#2b303b'),
    red: value('--code-property', '#b80a18'),
    green: value('--code-string', '#008000'),
    yellow: value('--code-variable', '#b84f05'),
    blue: value('--code-function', '#0051c2'),
    magenta: value('--code-keyword', '#8100c2'),
    cyan: value('--code-number', '#008080'),
    white: value('--code-text', '#14181f'),
  };
}

/**
 * The resolved mono stack, not the `var()` that names it.
 *
 * xterm measures a character cell by rendering into a canvas with this exact
 * string; a custom property is not resolved in that context, so the measure
 * would fall back to the browser default and every column would be misplaced.
 */
function monoFontStack(element: HTMLElement): string {
  return (
    getComputedStyle(element).getPropertyValue('--font-mono').trim() ||
    'ui-monospace, SFMono-Regular, Menlo, monospace'
  );
}

function runRef(update: ShellRunUpdate): string {
  return update.result.ref;
}

export function TerminalTab(props: { sessionId: string; active: boolean }) {
  const { active, sessionId } = props;
  const locale = useUiLocale();
  const copy = getDesktopConversationCopy(locale).terminalPanel;
  const workbarCopy = getWorkbarCopy(locale);
  const updates = useStore(activeSessionStore, (state) => state.shellUpdates);
  const selectedRef = useStore(workbarStore, (state) => state.terminalRefBySession[sessionId]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runs = useMemo(
    () => updates.filter((update) => update.sessionId === sessionId),
    [sessionId, updates],
  );
  // A stored ref that is no longer in the catalog falls back to the newest
  // running shell, then to the newest of any status — the run a reader who
  // just opened the face is almost always asking about.
  const fallback =
    [...runs].reverse().find((run) => run.result.status === 'running') ?? runs.at(-1);
  const ref =
    selectedRef && runs.some((run) => runRef(run) === selectedRef)
      ? selectedRef
      : fallback && runRef(fallback);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const update = await startShellRun(sessionId);
      workbarStore.selectTerminalRun(sessionId, runRef(update));
    } catch (unknownError) {
      setError(generalizedErrorMessageForLocale(unknownError, copy.startFailed, locale));
    } finally {
      setStarting(false);
    }
  }, [copy.startFailed, locale, sessionId]);

  const stop = useCallback(async () => {
    if (!ref) return;
    try {
      await stopShellRun({ sessionId, ref });
    } catch (unknownError) {
      setError(generalizedErrorMessageForLocale(unknownError, copy.stopFailed, locale));
    }
  }, [copy.stopFailed, locale, ref, sessionId]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-maka-contract="session-terminal"
      role="region"
      aria-label={copy.ariaLabel}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        {runs.length > 0 && (
          <Select
            value={ref ?? ''}
            onValueChange={(next) => workbarStore.selectTerminalRun(sessionId, next)}
          >
            <SelectTrigger
              aria-label={workbarCopy.terminal.selectRun}
              className="h-7 min-w-0 text-xs"
            >
              <SelectValue placeholder={copy.runCount(runs.length)} />
            </SelectTrigger>
            <SelectContent>
              {runs.map((run) => (
                <SelectItem key={runRef(run)} value={runRef(run)}>
                  {run.result.cmd.trim() || workbarCopy.terminal.unnamedRun}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="min-w-0 flex-1" />
        {ref && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={copy.stopTerminal}
            onClick={() => void stop()}
          >
            <Anthropicon name="stop" size={16} />
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={starting} onClick={() => void start()}>
          <Anthropicon name="add" size={16} />
          {copy.newTerminal}
        </Button>
      </div>

      {error && (
        <p className="mx-3 mb-2 shrink-0 rounded-lg bg-danger-subtle px-3 py-2 text-xs leading-5 text-danger">
          {error}
        </p>
      )}

      {ref ? (
        <XtermSurface
          key={`${sessionId}:${ref}`}
          sessionId={sessionId}
          shellRunRef={ref}
          active={active}
          onError={setError}
        />
      ) : (
        <PreviewNotice
          icon="terminal"
          title={copy.empty}
          detail={copy.emptyHelp}
          action={{
            label: copy.newTerminal,
            icon: 'add',
            onClick: () => void start(),
            pending: starting,
          }}
        />
      )}
    </div>
  );
}

function XtermSurface(props: {
  sessionId: string;
  shellRunRef: string;
  active: boolean;
  onError: (message: string | null) => void;
}) {
  const { active, sessionId, shellRunRef } = props;
  const locale = useUiLocale();
  const copy = getDesktopConversationCopy(locale).terminalPanel;
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;

  // Becoming visible is when the geometry is finally measurable: a hidden
  // panel has zero size, and fitting against that would send the PTY a 0x0.
  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    return scheduleTerminalFrame(() => {
      if (!activeRef.current) return;
      fit.fit();
      terminal.focus();
    });
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cancelHydrationFrame: (() => void) | null = null;
    let lastSize = '';
    const hydration = new SessionTerminalHydration();
    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: monoFontStack(host),
      fontSize: getTerminalFontSize(),
      letterSpacing: 0,
      lineHeight: 1.2,
      screenReaderMode: true,
      scrollback: 5_000,
      theme: terminalTheme(host),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const queryReplies = suppressTerminalQueryReplies(terminal);

    const resize = () => {
      if (disposed || !activeRef.current || host.clientWidth === 0 || host.clientHeight === 0) {
        return;
      }
      fit.fit();
      const key = `${terminal.cols}:${terminal.rows}`;
      if (lastSize === key) return;
      lastSize = key;
      void writeShellRun({
        sessionId,
        ref: shellRunRef,
        size: { cols: terminal.cols, rows: terminal.rows },
      }).catch(() => undefined);
    };

    const offPty = subscribeShellRunPtyData((event) => {
      if (disposed || event.sessionId !== sessionId || event.ref !== shellRunRef) return;
      const live = hydration.accept(event);
      if (live) terminal.write(live.data);
    });

    const hydrate = (epoch: number) => {
      void attachShellRun({ sessionId, ref: shellRunRef })
        .then((snapshot) => {
          if (disposed || !hydration.isCurrent(epoch)) return;
          if (!snapshot) {
            onErrorRef.current(copy.loadFailed);
            return;
          }
          const committed = hydration.commit(epoch, snapshot);
          if (!committed) return;
          terminal.reset();
          if (committed.snapshot.buffer) terminal.write(committed.snapshot.buffer);
          for (const event of committed.replay) terminal.write(event.data);
          onErrorRef.current(null);
          cancelHydrationFrame?.();
          cancelHydrationFrame = scheduleTerminalFrame(() => {
            cancelHydrationFrame = null;
            if (disposed) return;
            resize();
            if (activeRef.current) terminal.focus();
          });
        })
        .catch((unknownError: unknown) => {
          if (disposed || !hydration.isCurrent(epoch)) return;
          onErrorRef.current(
            generalizedErrorMessageForLocale(unknownError, copy.loadFailed, locale),
          );
        });
    };

    const offResync = subscribeShellRunResync((event) => {
      if (disposed || event.sessionId !== sessionId) return;
      hydrate(hydration.begin());
    });

    const input = terminal.onData((data) => {
      if (!data || disposed) return;
      void writeShellRun({ sessionId, ref: shellRunRef, input: data }).catch(
        (unknownError: unknown) => {
          if (disposed) return;
          onErrorRef.current(
            generalizedErrorMessageForLocale(unknownError, copy.writeFailed, locale),
          );
        },
      );
    });

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const offFontSize = subscribeTerminalFontSize((size) => {
      terminal.options.fontSize = size;
      lastSize = '';
      resize();
    });

    // The theme class flips on `<html>`; re-read the tokens rather than
    // recreating the terminal, which would drop the scrollback.
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme(host);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    onErrorRef.current(null);
    hydrate(hydration.begin());

    return () => {
      disposed = true;
      cancelHydrationFrame?.();
      cancelHydrationFrame = null;
      observer.disconnect();
      themeObserver.disconnect();
      offFontSize();
      offPty();
      offResync();
      input.dispose();
      queryReplies.dispose();
      void detachShellRun({ sessionId, ref: shellRunRef }).catch(() => undefined);
      fitRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [copy.loadFailed, copy.writeFailed, locale, sessionId, shellRunRef]);

  return (
    <div
      ref={hostRef}
      className="min-h-0 flex-1 overflow-hidden rounded-lg bg-surface-2 p-2 [&_.xterm-viewport]:overflow-y-auto"
      data-maka-contract="session-terminal-xterm"
      data-terminal-ref={shellRunRef}
    />
  );
}
