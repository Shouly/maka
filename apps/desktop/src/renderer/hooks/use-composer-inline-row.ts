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

// Ported from the reference design system's `useComposerInlineRow`: whether
// the composer's two control groups share a line with a short draft (the
// session form) or drop under it (long drafts, attachments, and the welcome
// surface, which always stacks).
//
// The controls are always `absolute bottom-0` at the two ends of the text
// block; switching forms only moves the text block's padding — inline gives
// up padding-left to the lead group, stacked takes it back and adds a
// control's height of padding-bottom. The trail group is avoided through a
// float on `.ProseMirror::before` so only the LAST line yields to it.
//
// Two traps the reference documents and this port keeps:
// 1. Hysteresis holds the invariant "empty ⇒ not wrapped". Listening for
//    `empty` changes alone is not enough: one tall measurement at mount would
//    pin the stacked form forever while `empty` never changes.
// 2. Measure after every render. Controls mount in batches and a
//    ResizeObserver alone misses some of them.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

/** `--cds-h-control`: the control row's box height, also the single-line target. */
const CONTROL_H = 32;
/** 16px × 1.4, the `.chat-composer-surface .tiptap.ProseMirror` line height. */
const LEADING = 22;
/** The editor's own `py-[5px]` × 2, subtracted when scrollHeight → text height. */
const EDITOR_PY = 10;
/** Below this much room for text, the single-line form is not worth it. */
const MIN_TEXT_W = 200;

export interface ComposerInlineRow {
  /** Controls share the draft's line (not wrapped, and the two groups fit). */
  inline: boolean;
  /** First real measurement landed; callers attach transitions only after. */
  settled: boolean;
  /** CSS variables for the text block: both groups' widths, the text height. */
  vars: CSSProperties;
  hostRef: RefObject<HTMLDivElement | null>;
  leadRef: RefObject<HTMLDivElement | null>;
  trailRef: RefObject<HTMLDivElement | null>;
  editorRef: RefObject<HTMLDivElement | null>;
}

interface Options {
  /** Only the session form; welcome always stacks. */
  enabled: boolean;
  /** The draft is empty. See the hysteresis note above. */
  empty: boolean;
  /** Attachments, read-only and the like pin the stacked form. */
  forceStacked?: boolean;
}

export function useComposerInlineRow({ enabled, empty, forceStacked }: Options): ComposerInlineRow {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leadRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [metrics, setMetrics] = useState({ leadW: 0, trailW: 0, hostW: 0, textH: LEADING });
  const [wrapped, setWrapped] = useState(false);
  const measure = useCallback(() => {
    const host = hostRef.current;
    const editor = editorRef.current;
    if (!host || !editor) return;
    const next = {
      leadW: leadRef.current?.offsetWidth ?? 0,
      trailW: trailRef.current?.offsetWidth ?? 0,
      hostW: host.clientWidth,
      // An empty draft is one line by definition. Measuring it would read the
      // previous text when the clear arrives from outside the editor (a send
      // acknowledged, a draft restored): the editor replaces its content in a
      // passive effect, after this layout measurement. A stale tall `textH`
      // then feeds the `::before` float, which keeps the box that tall, which
      // measures tall again — the empty composer never comes back down.
      textH: empty ? LEADING : Math.max(LEADING, editor.scrollHeight - EDITOR_PY),
    };
    setMetrics((prev) =>
      prev.leadW === next.leadW &&
      prev.trailW === next.trailW &&
      prev.hostW === next.hostW &&
      prev.textH === next.textH
        ? prev
        : next,
    );
    setWrapped(empty ? false : next.textH > LEADING + 1 || wrapped);
  }, [empty, wrapped]);

  // Layout effect, not effect: the first frame can only render stacked
  // (leadW is 0), and measuring before paint lets it switch to the real form
  // without the stacked frame ever showing.
  useLayoutEffect(measure);

  // Changes outside a render (viewport, fonts) go through a ResizeObserver.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    for (const element of [hostRef.current, leadRef.current, trailRef.current, editorRef.current]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (empty && wrapped) setWrapped(false);
  }, [empty, wrapped]);

  // `settled` flips after the frame with real measurements has PAINTED: that
  // commit already has the real padding and no transition class, so the first
  // jump does not animate; the next render attaches the class to stable styles.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!settled && metrics.leadW > 0) setSettled(true);
  }, [settled, metrics.leadW]);

  const { leadW, trailW, hostW, textH } = metrics;
  // Unmeasured (first commit) renders single-line with one control plus its
  // gap reserved on the left: an empty draft's real form IS single-line, and
  // drawing stacked first would be a visible 40px jump on every mount.
  const measured = leadW > 0;
  const inline =
    enabled && !forceStacked && !wrapped && (!measured || hostW - leadW - trailW >= MIN_TEXT_W);

  const vars = {
    '--cmp-lead-w': `${measured ? leadW : CONTROL_H + 8}px`,
    '--cmp-trail-w': `${trailW}px`,
    '--cmp-wrap-h': `${textH}px`,
    '--cmp-row-h': `${CONTROL_H}px`,
  } as CSSProperties;

  return { inline, settled, vars, hostRef, leadRef, trailRef, editorRef };
}
