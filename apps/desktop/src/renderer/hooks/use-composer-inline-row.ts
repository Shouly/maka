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

// Whether Send shares a line with a short draft (the session form) or drops
// under it (long drafts, attachments, and the welcome surface).
//
// Send stays `absolute bottom-0 right-0`; stacked mode adds a control's height
// of padding-bottom. Inline mode avoids it through a float on
// `.ProseMirror::before` so only the LAST line yields to it.
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
// Every constant here is a DEFAULT-ROOT pixel value (root 16px). The
// Appearance font-size setting scales the root, and the editor's line-height,
// padding and the controls are all rem, so the measurement scales them by the
// same factor (`rootScale`) or a one-line draft reads as wrapped at 18px.
const CONTROL_H = 32;
/** 16px × 1.4, the `.chat-composer-surface .tiptap.ProseMirror` line height. */
const LEADING = 22;
/** The editor's own `py-[5px]` × 2, subtracted when scrollHeight → text height. */
const EDITOR_PY = 10;
/** Below this much room for text, the single-line form is not worth it. */
const MIN_TEXT_W = 200;

export interface ComposerInlineRow {
  /** Send shares the draft's line when it fits and the text has not wrapped. */
  inline: boolean;
  /** First real measurement landed; callers attach transitions only after. */
  settled: boolean;
  /** CSS variables for the text block: trailing controls and text height. */
  vars: CSSProperties;
  hostRef: RefObject<HTMLDivElement | null>;
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

/** The root's font-size over the browser default: 1 at the default setting. */
function rootScale(): number {
  if (typeof document === 'undefined') return 1;
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px / 16 : 1;
}

export function useComposerInlineRow({ enabled, empty, forceStacked }: Options): ComposerInlineRow {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [metrics, setMetrics] = useState({
    trailW: 0,
    hostW: 0,
    textH: LEADING,
    scale: 1,
  });
  const [wrapped, setWrapped] = useState(false);
  const measure = useCallback(() => {
    const host = hostRef.current;
    const editor = editorRef.current;
    if (!host || !editor) return;
    const scale = rootScale();
    const leading = LEADING * scale;
    const next = {
      trailW: trailRef.current?.offsetWidth ?? 0,
      hostW: host.clientWidth,
      scale,
      // An empty draft is one line by definition. Measuring it would read the
      // previous text when the clear arrives from outside the editor (a send
      // acknowledged, a draft restored): the editor replaces its content in a
      // passive effect, after this layout measurement. A stale tall `textH`
      // then feeds the `::before` float, which keeps the box that tall, which
      // measures tall again — the empty composer never comes back down.
      textH: empty ? leading : Math.max(leading, editor.scrollHeight - EDITOR_PY * scale),
    };
    setMetrics((prev) =>
      prev.trailW === next.trailW &&
      prev.hostW === next.hostW &&
      prev.textH === next.textH &&
      prev.scale === next.scale
        ? prev
        : next,
    );
    setWrapped(empty ? false : next.textH > leading + 1 || wrapped);
  }, [empty, wrapped]);

  // Measure before paint so the first frame already fits the available width.
  useLayoutEffect(measure);

  // Changes outside a render (viewport, fonts) go through a ResizeObserver.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    for (const element of [hostRef.current, trailRef.current, editorRef.current]) {
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
    if (!settled && metrics.hostW > 0) setSettled(true);
  }, [settled, metrics.hostW]);

  const { trailW, hostW, textH, scale } = metrics;
  // Unmeasured (first commit) renders single-line: an empty draft IS single-line, and
  // drawing stacked first would be a visible 40px jump on every mount.
  const measured = hostW > 0;
  const inline =
    enabled && !forceStacked && !wrapped && (!measured || hostW - trailW >= MIN_TEXT_W * scale);

  const vars = {
    '--cmp-trail-w': `${trailW}px`,
    '--cmp-wrap-h': `${textH}px`,
    '--cmp-row-h': `${CONTROL_H * scale}px`,
  } as CSSProperties;

  return { inline, settled, vars, hostRef, trailRef, editorRef };
}
