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

import { useEffect, useState } from 'react';
import type { MermaidConfig } from 'mermaid';
import mermaidPackage from 'mermaid/package.json' with { type: 'json' };
import { useUiLocale, getSharedUiCopy } from '@maka/ui';
import { Button } from './button.js';
import { Dialog, DialogContent, DialogTitle } from './dialog.js';

export const MAX_MERMAID_SOURCE_LENGTH = 20_000;
export const MAX_MERMAID_EDGES = 500;
export const MERMAID_RENDER_CACHE_LIMIT = 24;
export const MERMAID_RENDER_CACHE_MAX_CHARS = 4 * 1024 * 1024;
export const MIN_MERMAID_ZOOM = 0.5;
export const MAX_MERMAID_ZOOM = 3;
export const MERMAID_ZOOM_STEP = 0.25;
const MERMAID_RENDER_CACHE_SCHEMA_VERSION = 1;
const MERMAID_ID_REFERENCE_ATTRIBUTES = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'aria-flowto',
  'aria-labelledby',
  'aria-owns',
  'for',
  'headers',
]);

type MermaidTheme = 'default' | 'dark';

type MermaidRenderState =
  | { status: 'deferred' }
  | { status: 'loading' }
  | { status: 'rendered'; svg: string; naturalWidth: number; naturalHeight: number }
  | { status: 'error'; reason: 'invalid' | 'too-large' };

type MermaidRenderTemplate = {
  svg: string;
  namespace: string;
  naturalWidth: number;
  naturalHeight: number;
};

type MermaidRenderInFlight = {
  promise: Promise<MermaidRenderTemplate | null>;
  consumers: Set<() => boolean>;
};

let mermaidModule: Promise<typeof import('mermaid').default> | undefined;
let renderQueue: Promise<void> = Promise.resolve();
let diagramSequence = 0;
const MERMAID_RENDERER_VERSION = `${mermaidPackage.version}:${MERMAID_RENDER_CACHE_SCHEMA_VERSION}`;
const mermaidRenderCache = new Map<string, MermaidRenderTemplate>();
const mermaidRenderInFlight = new Map<string, MermaidRenderInFlight>();
let mermaidRenderCacheChars = 0;

export function createMermaidConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: MAX_MERMAID_SOURCE_LENGTH,
    maxEdges: MAX_MERMAID_EDGES,
    htmlLabels: false,
    logLevel: 'fatal',
    theme,
  };
}

function loadMermaid() {
  mermaidModule ??= import('mermaid').then((module) => module.default);
  return mermaidModule;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMermaidLocalUrlReferences(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  return value.replace(
    /url\(\s*(['"]?)#([^\s)'"}]+)\1\s*\)/g,
    (match, quote: string, id: string) => {
      const replacement = replacements.get(id);
      return replacement ? `url(${quote}#${replacement}${quote})` : match;
    },
  );
}

function replaceMermaidStyleIdReferences(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let rewritten = replaceMermaidLocalUrlReferences(value, replacements);
  for (const [id, replacement] of replacements) {
    const attributeSelector = new RegExp(
      `(\\[\\s*id\\s*=\\s*)(['"]?)${escapeRegExp(id)}\\2(\\s*(?:[iIsS]\\s*)?\\])`,
      'g',
    );
    rewritten = rewritten.replace(
      attributeSelector,
      (_match, prefix: string, quote: string, suffix: string) =>
        `${prefix}${quote}${replacement}${quote}${suffix}`,
    );
    const selector = new RegExp(`(^|[\\s,>+~}(.])#${escapeRegExp(id)}(?=$|[\\s,.:>+~{\\[])`, 'gm');
    rewritten = rewritten.replace(selector, `$1#${replacement}`);
  }
  return rewritten;
}

function namespaceRenderedMermaidIds(documentNode: Document, namespace: string): void {
  const replacements = new Map<string, string>();
  for (const element of documentNode.querySelectorAll('[id]')) {
    const id = element.getAttribute('id');
    if (!id || id.includes(namespace)) continue;
    let replacement = replacements.get(id);
    if (!replacement) {
      replacement = `${namespace}-scoped-${replacements.size}`;
      replacements.set(id, replacement);
    }
    element.setAttribute('id', replacement);
  }
  if (replacements.size === 0) return;

  for (const element of documentNode.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase() === 'id') continue;
      const name = attribute.name.toLowerCase();
      let value = replaceMermaidLocalUrlReferences(attribute.value, replacements);
      if ((name === 'href' || name.endsWith(':href')) && value.startsWith('#')) {
        const replacement = replacements.get(value.slice(1));
        if (replacement) value = `#${replacement}`;
      } else if (MERMAID_ID_REFERENCE_ATTRIBUTES.has(name)) {
        value = value
          .split(/(\s+)/)
          .map((token) => replacements.get(token) ?? token)
          .join('');
      } else if (name === 'begin' || name === 'end') {
        for (const [id, replacement] of replacements) {
          value = value.replace(
            new RegExp(`(^|;\\s*)${escapeRegExp(id)}(?=\\.)`, 'g'),
            `$1${replacement}`,
          );
        }
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
  for (const style of documentNode.querySelectorAll('style')) {
    style.textContent = replaceMermaidStyleIdReferences(style.textContent ?? '', replacements);
  }
}

function sanitizeRenderedMermaidSvg(svg: string, namespace: string): string {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (documentNode.querySelector('parsererror')) throw new Error('Invalid Mermaid SVG output');

  for (const element of documentNode.querySelectorAll('script, foreignObject')) element.remove();
  for (const link of documentNode.querySelectorAll('a')) {
    link.replaceWith(...Array.from(link.childNodes));
  }
  for (const element of documentNode.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const unsafeReference =
        (name === 'href' || name.endsWith(':href')) &&
        !value.startsWith('#') &&
        !value.startsWith('data:image/');
      const unsafeStyle = name === 'style' && /(?:javascript:|expression\s*\()/i.test(value);
      if (name.startsWith('on') || unsafeReference || unsafeStyle) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  namespaceRenderedMermaidIds(documentNode, namespace);

  return new XMLSerializer().serializeToString(documentNode.documentElement);
}

function mermaidRenderCacheKey(code: string, theme: MermaidTheme): string {
  return `${MERMAID_RENDERER_VERSION}\0${theme}\0${code}`;
}

function touchMermaidRenderCacheEntry(key: string, entry: MermaidRenderTemplate): void {
  mermaidRenderCache.delete(key);
  mermaidRenderCache.set(key, entry);
}

function trimMermaidRenderCache(): void {
  while (
    mermaidRenderCache.size > MERMAID_RENDER_CACHE_LIMIT ||
    mermaidRenderCacheChars > MERMAID_RENDER_CACHE_MAX_CHARS
  ) {
    const oldestKey = mermaidRenderCache.keys().next().value;
    if (oldestKey === undefined) break;
    mermaidRenderCacheChars -= mermaidRenderCache.get(oldestKey)?.svg.length ?? 0;
    mermaidRenderCache.delete(oldestKey);
  }
}

function writeMermaidRenderCache(key: string, template: MermaidRenderTemplate): void {
  if (template.svg.length > MERMAID_RENDER_CACHE_MAX_CHARS) return;
  const existing = mermaidRenderCache.get(key);
  if (existing) mermaidRenderCacheChars -= existing.svg.length;
  mermaidRenderCache.delete(key);
  mermaidRenderCache.set(key, template);
  mermaidRenderCacheChars += template.svg.length;
  trimMermaidRenderCache();
}

function nextMermaidRenderId(kind: 'template' | 'instance', code = ''): string {
  let id: string;
  do id = `maka-mermaid-${kind}-${++diagramSequence}`;
  while (code.includes(id));
  return id;
}

function instantiateMermaidSvg(template: MermaidRenderTemplate): string {
  return template.svg.replaceAll(template.namespace, nextMermaidRenderId('instance', template.svg));
}

/**
 * Mermaid owns global configuration, so initialization and rendering must be
 * one serialized operation. This also caps concurrent layout work when one
 * assistant turn contains several diagrams.
 */
function renderMermaid(
  code: string,
  theme: MermaidTheme,
  shouldRender: () => boolean,
): Promise<MermaidRenderTemplate | null> {
  if (!shouldRender()) return Promise.resolve(null);
  const cacheKey = mermaidRenderCacheKey(code, theme);
  const cached = mermaidRenderCache.get(cacheKey);
  if (cached) {
    touchMermaidRenderCacheEntry(cacheKey, cached);
    return Promise.resolve(shouldRender() ? cached : null);
  }

  const inFlight = mermaidRenderInFlight.get(cacheKey);
  if (inFlight) {
    inFlight.consumers.add(shouldRender);
    return inFlight.promise.then((template) => (shouldRender() ? template : null));
  }

  const consumers = new Set([shouldRender]);
  const promise = renderQueue.then(async () => {
    if (![...consumers].some((isActive) => isActive())) return null;
    const mermaid = await loadMermaid();
    if (![...consumers].some((isActive) => isActive())) return null;
    mermaid.initialize(createMermaidConfig(theme));
    const id = nextMermaidRenderId('template', code);
    const { svg } = await mermaid.render(id, code);
    const sanitizedSvg = sanitizeRenderedMermaidSvg(svg, id);
    const { width: naturalWidth, height: naturalHeight } = mermaidViewBoxSize(sanitizedSvg);
    return { svg: sanitizedSvg, namespace: id, naturalWidth, naturalHeight };
  });
  const entry = { promise, consumers };
  mermaidRenderInFlight.set(cacheKey, entry);
  void promise
    .then(
      (template) => {
        if (template) writeMermaidRenderCache(cacheKey, template);
      },
      () => {},
    )
    .finally(() => {
      if (mermaidRenderInFlight.get(cacheKey) === entry) mermaidRenderInFlight.delete(cacheKey);
      consumers.clear();
    });

  renderQueue = promise.then(
    () => undefined,
    () => undefined,
  );
  return promise.then((template) => (shouldRender() ? template : null));
}

function currentMermaidTheme(): MermaidTheme {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

function mermaidViewBoxSize(svg: string): { width: number; height: number } {
  const viewBox =
    /\bviewBox=["']\s*[-+\d.e]+[\s,]+[-+\d.e]+[\s,]+([-+\d.e]+)[\s,]+([-+\d.e]+)/i.exec(svg);
  const width = Number(viewBox?.[1]);
  const height = Number(viewBox?.[2]);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height }
    : { width: 1200, height: 675 };
}

function clampMermaidZoom(value: number): number {
  return Math.min(MAX_MERMAID_ZOOM, Math.max(MIN_MERMAID_ZOOM, value));
}

function useMermaidTheme(): MermaidTheme {
  const [theme, setTheme] = useState<MermaidTheme>(currentMermaidTheme);

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => setTheme(currentMermaidTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    updateTheme();
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function MermaidDiagram({
  code,
  autoRender = true,
}: {
  code: string;
  density?: 'default' | 'compact';
  autoRender?: boolean;
}) {
  const copy = getSharedUiCopy(useUiLocale()).markdown;
  const theme = useMermaidTheme();
  const [manual, setManual] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<MermaidRenderState>({ status: 'deferred' });
  useEffect(() => {
    if (code.length > MAX_MERMAID_SOURCE_LENGTH) {
      setState({ status: 'error', reason: 'too-large' });
      return;
    }
    if (!autoRender && !manual) {
      setState({ status: 'deferred' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void renderMermaid(code, theme, () => !cancelled)
      .then((template) => {
        if (!cancelled && template)
          setState({
            status: 'rendered',
            svg: instantiateMermaidSvg(template),
            naturalWidth: template.naturalWidth,
            naturalHeight: template.naturalHeight,
          });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', reason: 'invalid' });
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme, autoRender, manual]);
  const diagram = () =>
    state.status === 'rendered' ? (
      <div
        role="region"
        aria-label={copy.mermaidViewport}
        className="max-h-[65vh] overflow-auto p-3"
      >
        <div style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: state.svg }} />
      </div>
    ) : null;
  const toolbar = (
    <div
      role="toolbar"
      aria-label={copy.mermaidToolbar}
      className="flex flex-wrap items-center gap-2 p-2"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={copy.mermaidZoomOut}
        onClick={() => setZoom((value) => clampMermaidZoom(value - MERMAID_ZOOM_STEP))}
      >
        −
      </Button>
      <span className="text-xs">{copy.mermaidZoomLevel(Math.round(zoom * 100))}</span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={copy.mermaidZoomIn}
        onClick={() => setZoom((value) => clampMermaidZoom(value + MERMAID_ZOOM_STEP))}
      >
        +
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
        {copy.mermaidResetView}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
        {expanded ? copy.mermaidCollapseView : copy.mermaidExpandView}
      </Button>
    </div>
  );
  return (
    <figure
      className="min-w-0 rounded-lg border border-hairline bg-surface-2"
      data-maka-contract="mermaid"
      data-maka-mermaid-state={state.status}
    >
      {state.status === 'rendered' ? (
        <>
          {!expanded && (
            <>
              {toolbar}
              {diagram()}
            </>
          )}
        </>
      ) : (
        <p role="status" className="p-3 text-sm text-text-secondary">
          {state.status === 'loading'
            ? copy.mermaidRendering
            : state.status === 'error'
              ? state.reason === 'too-large'
                ? copy.mermaidTooLarge
                : copy.mermaidRenderFailed
              : copy.mermaidDeferred}
        </p>
      )}
      {state.status === 'deferred' && (
        <Button variant="ghost" onClick={() => setManual(true)}>
          {copy.mermaidRender}
        </Button>
      )}
      <details className="p-3 text-sm">
        <summary className="cursor-pointer">{copy.mermaidViewSource}</summary>
        <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs">{code}</pre>
      </details>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw]">
          <DialogTitle>{copy.mermaidDiagram}</DialogTitle>
          {toolbar}
          {diagram()}
        </DialogContent>
      </Dialog>
    </figure>
  );
}

export const MAX_AUTOMATIC_MERMAID_DIAGRAMS = 3;
export const MAX_AUTOMATIC_MERMAID_SOURCE_LENGTH = 4_000;
export const MAX_AUTOMATIC_MERMAID_TOTAL_SOURCE_LENGTH = 8_000;
const DEFERRED_MERMAID_LANGUAGE = 'makamermaiddeferred';

/**
 * Mark settled Mermaid fences that exceed the per-document automatic-render
 * budget. The private language marker survives Astryx parsing without changing
 * the source shown to the user; the code renderer turns it into an explicit
 * source + Render action instead of scheduling more main-thread layout work.
 */
export function applyMermaidRenderBudget(source: string): string {
  const lines = source.split('\n');
  let automaticCount = 0;
  let automaticSourceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/.exec(lines[index] ?? '');
    if (!opening) continue;
    const [, indent = '', fence = '', info = ''] = opening;
    const language = /^([ \t]*)mermaid(?=[ \t]|$)/i.exec(info);
    if (!language) continue;

    const fenceCharacter = fence[0];
    if (!fenceCharacter) continue;
    const closing = new RegExp(`^ {0,3}${fenceCharacter}{${fence.length},}[ \\t]*$`);
    let closingIndex = index + 1;
    while (closingIndex < lines.length && !closing.test(lines[closingIndex] ?? '')) {
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) continue;

    const codeLength = lines.slice(index + 1, closingIndex).join('\n').length;
    const withinBudget =
      codeLength <= MAX_AUTOMATIC_MERMAID_SOURCE_LENGTH &&
      automaticCount < MAX_AUTOMATIC_MERMAID_DIAGRAMS &&
      automaticSourceLength + codeLength <= MAX_AUTOMATIC_MERMAID_TOTAL_SOURCE_LENGTH;

    if (withinBudget) {
      automaticCount += 1;
      automaticSourceLength += codeLength;
    } else {
      const leadingWhitespace = language[1] ?? '';
      lines[index] =
        `${indent}${fence}${leadingWhitespace}${DEFERRED_MERMAID_LANGUAGE}${info.slice(language[0].length)}`;
    }
    index = closingIndex;
  }

  return lines.join('\n');
}
