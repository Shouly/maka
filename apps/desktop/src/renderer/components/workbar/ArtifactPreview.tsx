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

// One artifact, drawn by kind.
//
// Shaped after the reference design system's `PreviewRenderer` /
// `FilePreviewSurface` pair — a pure switch over the kind, and a container that
// owns the read — with Maka's five kinds and Maka's boundaries:
//
//   PATHS. Nothing here ever assembles a filesystem path. Every read goes
//   through `bridge/artifacts`, and main does the realpath check before it
//   hands anything back; the renderer never learns where the file is.
//
//   HTML. `sandbox=""` with `srcdoc` — no `allow-scripts`, no
//   `allow-same-origin`, no forms, no popups. The pre-rewrite preview allowed
//   scripts; this one does not, because the pane now renders arbitrary model
//   output beside a live session and there is nothing an artifact's script
//   needs to do to be read. `<a href>` clicks are inert under that sandbox, so
//   the count of them is stated up front rather than left to be discovered.
//
//   IMAGES. `readBinary` gives base64 and a sniffed MIME; both go through the
//   shared registry decision (`decideImageReadOutcome`) BEFORE any of it
//   reaches React state, so an oversize payload never enters a snapshot. What
//   survives becomes a blob URL, revoked on unmount — a multi-megabyte `data:`
//   URL in an attribute is a string the DOM keeps for as long as the node lives.
//
//   PDF. This build ships no PDF renderer, and the fixed CSP (`default-src
//   'self'`) blocks `data:` in an `<embed>`, so an inline viewer would be a
//   blank rectangle. The face says so and offers the system viewer instead.

import { useEffect, useState } from 'react';
import type {
  ArtifactBinaryReadResult,
  ArtifactDescriptor,
  ArtifactTextReadResult,
} from '@maka/core/artifacts';
import {
  decideImageReadOutcome,
  formatPreviewSize,
  resolvePreviewKind,
  type PreviewResolution,
} from '@maka/ui/artifact-preview-registry';
import { formatBytes, syntaxLanguageForPath, useUiLocale } from '@maka/ui';
import CodeRenderer from '../ui/CodeRenderer.js';
import DiffRenderer from '../ui/DiffRenderer.js';
import Markdown from '../ui/Markdown.js';
import { LoadingSpinner } from '../ui/LoadingSpinner.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import { PreviewNotice } from './PreviewNotice.js';
import { readArtifactBinary, readArtifactText } from '../../bridge/artifacts.js';
import {
  ARTIFACT_DIFF_LINE_LIMIT,
  ARTIFACT_TEXT_DISPLAY_LIMIT_BYTES,
  ARTIFACT_TEXT_HIGHLIGHT_LIMIT_BYTES,
  ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT,
  boundPreviewText,
  capPreviewLines,
  countExternalLinks,
  isMarkdownArtifactName,
  type BoundedPreviewText,
} from '../../lib/ported/artifact-preview-text.js';
import { getArtifactCopy, type ArtifactCopy } from '../../locales/artifact-copy.js';
import { getWorkbarCopy } from '../../locales/workbar-copy.js';

export function ArtifactPreview(props: {
  record: ArtifactDescriptor;
  onOpenExternally?: () => void;
}) {
  const locale = useUiLocale();
  const copy = getArtifactCopy(locale);
  switch (props.record.kind) {
    case 'file':
      return <TextArtifact record={props.record} copy={copy} mode="file" />;
    case 'diff':
      return <TextArtifact record={props.record} copy={copy} mode="diff" />;
    case 'html':
      return <TextArtifact record={props.record} copy={copy} mode="html" />;
    case 'image':
      return (
        <ImageArtifact
          record={props.record}
          copy={copy}
          {...(props.onOpenExternally ? { onOpenExternally: props.onOpenExternally } : {})}
        />
      );
    case 'pdf':
      return (
        <PdfArtifact
          {...(props.onOpenExternally ? { onOpenExternally: props.onOpenExternally } : {})}
        />
      );
  }
}

// ── text-backed kinds ───────────────────────────────────────────────────────

function TextArtifact(props: {
  record: ArtifactDescriptor;
  copy: ArtifactCopy;
  mode: 'file' | 'diff' | 'html';
}) {
  const { copy, mode, record } = props;
  const result = useTextRead(record.sessionId, record.id);
  if (result.state === 'loading') {
    return (
      <PreviewLoading
        label={
          mode === 'diff'
            ? copy.preview.loadingDiff
            : mode === 'html'
              ? copy.preview.loadingHtml
              : copy.preview.loadingFile
        }
      />
    );
  }
  if (!result.value.ok) {
    const failure = textFailureCopy(record, result.value.reason, copy);
    return <PreviewNotice tone={failure.tone} title={failure.title} detail={failure.description} />;
  }
  if (mode === 'diff') return <DiffBody name={record.name} text={result.value.text} copy={copy} />;
  if (mode === 'html') return <HtmlBody name={record.name} text={result.value.text} copy={copy} />;
  return <FileBody name={record.name} text={result.value.text} copy={copy} />;
}

function FileBody(props: { name: string; text: string; copy: ArtifactCopy }) {
  const markdown = isMarkdownArtifactName(props.name);
  const [mode, setMode] = useState<'rendered' | 'source'>(markdown ? 'rendered' : 'source');
  const bounded = boundPreviewText(props.text);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-maka-artifact-preview="file">
      {markdown && (
        <SegmentedControl
          size="sm"
          className="self-start"
          ariaLabel={props.copy.pane.previewNamed(props.name)}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'rendered', label: props.copy.preview.rendered },
            { value: 'source', label: props.copy.preview.source },
          ]}
        />
      )}
      {mode === 'rendered' ? (
        <Markdown noPadding disableRawHtml>
          {bounded.highlightedText}
        </Markdown>
      ) : (
        <BoundedCode name={props.name} bounded={bounded} />
      )}
      <PreviewLimits bounded={bounded} copy={props.copy} />
    </div>
  );
}

function DiffBody(props: { name: string; text: string; copy: ArtifactCopy }) {
  const bounded = boundPreviewText(props.text);
  const capped = capPreviewLines(bounded.displayText, ARTIFACT_DIFF_LINE_LIMIT);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-maka-artifact-preview="diff">
      <DiffRenderer content={capped.text} />
      {capped.hiddenLines > 0 && (
        <PreviewLimitNote>
          {props.copy.preview.diffLinesLimited(capped.hiddenLines)}
        </PreviewLimitNote>
      )}
      {bounded.isDisplayTruncated && (
        <PreviewLimitNote>
          {props.copy.preview.previewLimited(formatBytes(ARTIFACT_TEXT_DISPLAY_LIMIT_BYTES))}
        </PreviewLimitNote>
      )}
    </div>
  );
}

function HtmlBody(props: { name: string; text: string; copy: ArtifactCopy }) {
  const bounded = boundPreviewText(props.text);
  if (bounded.isDisplayTruncated) {
    // Too large to frame: an iframe with a cut document renders half a page and
    // says nothing about why, so the source is shown instead.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2" data-maka-artifact-preview="html-source">
        <BoundedCode name={props.name} bounded={bounded} />
        <PreviewLimits bounded={bounded} copy={props.copy} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-maka-artifact-preview="html">
      <p
        className="text-xs leading-4 text-text-muted"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {props.copy.preview.externalLinks(countExternalLinks(bounded.displayText))}
      </p>
      <iframe
        className="min-h-[320px] w-full flex-1 rounded-lg border-[0.5px] border-hairline bg-surface-2"
        title={props.copy.preview.frameTitle(props.name)}
        sandbox=""
        srcDoc={bounded.displayText}
      />
    </div>
  );
}

function BoundedCode(props: { name: string; bounded: BoundedPreviewText }) {
  const language = syntaxLanguageForPath(props.name);
  return (
    <>
      <CodeRenderer
        content={props.bounded.highlightedText}
        {...(language ? { language } : {})}
        showLineNumbers
        fontSize="12px"
      />
      {props.bounded.plainRemainder && (
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">
          {props.bounded.plainRemainder}
        </pre>
      )}
    </>
  );
}

function PreviewLimits(props: { bounded: BoundedPreviewText; copy: ArtifactCopy }) {
  return (
    <>
      {props.bounded.hasPlainRemainder && (
        <PreviewLimitNote>
          {props.copy.preview.highlightLimited(
            formatBytes(ARTIFACT_TEXT_HIGHLIGHT_LIMIT_BYTES),
            ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT,
          )}
        </PreviewLimitNote>
      )}
      {props.bounded.isDisplayTruncated && (
        <PreviewLimitNote>
          {props.copy.preview.previewLimited(formatBytes(ARTIFACT_TEXT_DISPLAY_LIMIT_BYTES))}
        </PreviewLimitNote>
      )}
    </>
  );
}

function PreviewLimitNote(props: { children: string }) {
  return (
    <p className="text-xs leading-4 text-text-muted" role="note">
      {props.children}
    </p>
  );
}

// ── binary-backed kinds ─────────────────────────────────────────────────────

function ImageArtifact(props: {
  record: ArtifactDescriptor;
  copy: ArtifactCopy;
  onOpenExternally?: () => void;
}) {
  const locale = useUiLocale();
  const resolution = resolvePreviewKind({
    name: props.record.name,
    kind: props.record.kind,
    ...(props.record.mimeType ? { mimeType: props.record.mimeType } : {}),
    sizeBytes: props.record.sizeBytes,
  });
  const load = useImageBlob(props.record.sessionId, props.record.id, resolution.kind === 'image');
  if (resolution.kind !== 'image') {
    return (
      <UnsupportedImage
        record={props.record}
        copy={props.copy}
        reason={resolution.reason}
        locale={locale}
        {...(props.onOpenExternally ? { onOpenExternally: props.onOpenExternally } : {})}
      />
    );
  }
  if (load.state === 'loading') return <PreviewLoading label={props.copy.registry.loadingImage} />;
  if (load.state === 'unsupported') {
    return (
      <UnsupportedImage
        record={props.record}
        copy={props.copy}
        reason={load.reason}
        locale={locale}
        {...(props.onOpenExternally ? { onOpenExternally: props.onOpenExternally } : {})}
      />
    );
  }
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center"
      data-maka-artifact-preview="image"
    >
      <img
        src={load.url}
        alt={props.record.name}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

function UnsupportedImage(props: {
  record: ArtifactDescriptor;
  copy: ArtifactCopy;
  reason: Extract<PreviewResolution, { kind: 'unsupported' }>['reason'];
  locale: ReturnType<typeof useUiLocale>;
  onOpenExternally?: () => void;
}) {
  const text = unsupportedCopy(props.reason, props.copy);
  return (
    <PreviewNotice
      icon="image"
      title={text.title}
      detail={text.description}
      hint={`${props.record.name} · ${formatPreviewSize(props.record.sizeBytes, props.locale)}`}
      {...(props.onOpenExternally
        ? {
            action: {
              label: props.copy.registry.openInFinder,
              icon: 'folderOpen' as const,
              onClick: props.onOpenExternally,
            },
          }
        : {})}
    />
  );
}

function PdfArtifact(props: { onOpenExternally?: () => void }) {
  const copy = getWorkbarCopy(useUiLocale());
  return (
    <PreviewNotice
      icon="file"
      title={copy.preview.pdfUnavailable}
      detail={copy.preview.pdfUnavailableHint}
      {...(props.onOpenExternally
        ? {
            action: {
              label: copy.preview.openExternally,
              icon: 'folderOpen' as const,
              onClick: props.onOpenExternally,
            },
          }
        : {})}
    />
  );
}

function PreviewLoading(props: { label: string }) {
  return (
    <div
      className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2"
      role="status"
      aria-live="polite"
    >
      <LoadingSpinner size={24} />
      <span className="text-xs leading-4 text-text-muted">{props.label}</span>
    </div>
  );
}

// ── reads ───────────────────────────────────────────────────────────────────

type AsyncRead<T> = { state: 'loading' } | { state: 'ready'; value: T };

function useTextRead(sessionId: string, artifactId: string): AsyncRead<ArtifactTextReadResult> {
  const [state, setState] = useState<AsyncRead<ArtifactTextReadResult>>({ state: 'loading' });
  useEffect(() => {
    let disposed = false;
    setState({ state: 'loading' });
    readArtifactText(sessionId, artifactId)
      .then((value) => {
        if (!disposed) setState({ state: 'ready', value });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        // A transport failure is mapped onto the contract's own vocabulary so
        // the notice reads like every other failed read instead of leaking an
        // Electron channel error at the reader.
        setState({ state: 'ready', value: { ok: false, reason: transportFailure(error) } });
      });
    return () => {
      disposed = true;
    };
  }, [artifactId, sessionId]);
  return state;
}

type ImageBlobState =
  | { state: 'loading' }
  | { state: 'image'; url: string }
  | {
      state: 'unsupported';
      reason: Extract<PreviewResolution, { kind: 'unsupported' }>['reason'];
    };

/**
 * The decision runs INSIDE the async, before `setState`: the state union's
 * `unsupported` branch deliberately carries no payload, so a rejected image's
 * bytes never enter a React snapshot. What passes becomes a blob URL, revoked
 * when the effect tears down.
 */
function useImageBlob(sessionId: string, artifactId: string, enabled: boolean): ImageBlobState {
  const [state, setState] = useState<ImageBlobState>({ state: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let url: string | undefined;
    setState({ state: 'loading' });
    void (async () => {
      let raw: ArtifactBinaryReadResult;
      try {
        raw = await readArtifactBinary(sessionId, artifactId);
      } catch {
        if (!cancelled) setState({ state: 'unsupported', reason: 'read_failed' });
        return;
      }
      if (cancelled) return;
      const outcome = decideImageReadOutcome(raw);
      if (outcome.kind !== 'image') {
        setState({ state: 'unsupported', reason: outcome.reason });
        return;
      }
      try {
        url = URL.createObjectURL(base64ToBlob(outcome.base64, outcome.safeMime));
      } catch {
        setState({ state: 'unsupported', reason: 'read_failed' });
        return;
      }
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setState({ state: 'image', url });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artifactId, enabled, sessionId]);
  return enabled ? state : { state: 'unsupported', reason: 'kind_disallowed' };
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function transportFailure(error: unknown): 'not_allowed' | 'read_failed' {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('not_allowed') ? 'not_allowed' : 'read_failed';
}

// ── failure vocabulary ──────────────────────────────────────────────────────

function textFailureCopy(
  record: ArtifactDescriptor,
  reason: Extract<ArtifactTextReadResult, { ok: false }>['reason'],
  copy: ArtifactCopy,
): { tone: 'muted' | 'danger'; title: string; description: string } {
  switch (reason) {
    case 'not_found':
    case 'read_failed':
      return { tone: 'danger', ...copy.preview.readFailed };
    case 'not_allowed':
      return { tone: 'danger', ...copy.preview.notAllowed };
    case 'too_large':
      return { tone: 'muted', ...copy.preview.tooLarge(record.sizeBytes) };
  }
}

function unsupportedCopy(
  reason: Extract<PreviewResolution, { kind: 'unsupported' }>['reason'],
  copy: ArtifactCopy,
): { title: string; description: string } {
  switch (reason) {
    case 'kind_disallowed':
      return copy.registry.kindDisallowed;
    case 'mime_disallowed':
      return copy.registry.mimeDisallowed;
    case 'no_mime_no_ext':
      return copy.registry.unknownType;
    case 'oversize':
      return copy.registry.oversize;
    case 'read_failed':
      return copy.registry.readFailed;
  }
}
