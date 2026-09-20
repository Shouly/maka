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

// ONE file, open. Not a catalog you walk into and a file you walk to.
//
// It used to be two screens in one face: a list, and a preview you reached by
// clicking a row, with a back arrow to return. That is not what the reference
// does and it never read right — the pane is where you READ a file, and a
// listing standing between the reader and the file is a step that exists only
// because the list had nowhere else to live. It has one now: the session
// panel's Outputs section, which is the reference's own arrangement (its
// sidebar lists, its pane shows).
//
// So this face is the file, and the pane's header is the FILE's header —
// `FilePreviewHeader` renders into it: what to look at, what it is called, and
// what can be done with it. The two halves share one `workbarStore` selection
// and one `useSessionArtifacts` read, which is why neither owns the other.

import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { canUserDeleteArtifact, type ArtifactDescriptor } from '@maka/core/artifacts';
import { generalizedErrorMessageForLocale, redactSecrets } from '@maka/core/redaction';
import { formatBytes, useUiLocale, type UiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { RightPaneTip } from '../ui/right-pane-shell.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import SplitButton from '../ui/split-button.js';
import { ArtifactPreview, artifactHasRenderedView } from './ArtifactPreview.js';
import { LoadingSpinner } from '../ui/LoadingSpinner.js';
import { PreviewNotice } from './PreviewNotice.js';
import { cn } from '../../lib/cn.js';
import { deleteArtifact, readArtifactText } from '../../bridge/artifacts.js';
import { openArtifactPath, saveArtifactAs, showArtifactInFolder } from '../../bridge/app.js';
import { useSessionArtifacts } from '../../hooks/use-session-artifacts.js';
import { closeWorkbarArtifact } from '../../hooks/use-workbar.js';
import { sessionArtifactsStore } from '../../store/session-artifacts-store.js';
import { matchArtifactForPath, workbarStore } from '../../store/workbar-store.js';
import { toast } from '../../store/toast-store.js';
import { deliveryFileExtension, deliveryFileTitle } from '../../lib/ported/delivery-file-label.js';
import { isMermaidArtifactName } from '../../lib/ported/artifact-preview-text.js';
import { getArtifactCopy, type ArtifactCopy } from '../../locales/artifact-copy.js';

/**
 * Does the drawn form fill its own box?
 *
 * The reference's rule, kind for kind: a page, a diagram, an image and a PDF
 * bring their own margins and must reach the pane's edges — padding around an
 * iframe or a PDF viewer is a grey frame. Text needs the gutter.
 */
function previewNeedsPadding(record: ArtifactDescriptor): boolean {
  if (record.kind === 'html' || record.kind === 'image' || record.kind === 'pdf') return false;
  return !(record.kind === 'file' && isMermaidArtifactName(record.name));
}

/** The selection, resolved against the catalog both halves of the face read. */
function useOpenArtifact(sessionId: string, active: boolean) {
  const artifacts = useSessionArtifacts(sessionId, active);
  const selectedId = useStore(workbarStore, (state) => state.artifactBySession[sessionId]);
  const pendingPath = useStore(workbarStore, (state) => state.pendingPathBySession[sessionId]);
  const record = selectedId
    ? ([...artifacts.records, ...artifacts.uploads, ...artifacts.toolResults].find(
        (entry) => entry.id === selectedId,
      ) ?? null)
    : null;
  return { artifacts, selectedId, pendingPath, record };
}

export function FilePreviewViewer(props: { sessionId: string; active: boolean }) {
  const { active, sessionId } = props;
  const copy = getArtifactCopy(useUiLocale());
  const { artifacts, pendingPath, record } = useOpenArtifact(sessionId, active);

  useEffect(() => {
    if (!active || !artifacts.loaded) return;
    // A `file_write` row asked for a path before the catalog could name an id.
    if (pendingPath) {
      const catalog = [...artifacts.records, ...artifacts.uploads, ...artifacts.toolResults];
      // Transcript uploads carry an artifact ID, while tool rows carry a path.
      const match =
        catalog.find((entry) => entry.id === pendingPath) ??
        matchArtifactForPath(catalog, pendingPath);
      if (match) workbarStore.resolvePendingPath(sessionId, match.id);
      else if (catalog.length > 0) workbarStore.clearPendingPath(sessionId);
      return;
    }
    // Nothing to show: a selection whose artifact left the catalog, or a
    // viewer that outlived its file. It closes rather than standing on the
    // column with a notice — the Outputs list behind it is where the next file
    // comes from.
    if (!record) closeWorkbarArtifact(sessionId);
  }, [
    active,
    artifacts.loaded,
    artifacts.records,
    artifacts.uploads,
    artifacts.toolResults,
    pendingPath,
    record,
    sessionId,
  ]);

  if (!record) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-maka-contract="session-artifacts"
        data-view={artifacts.loaded ? 'empty' : 'loading'}
      >
        {/* Before the catalog has answered there is no such thing as "no file
            open" — the pane was opened ON a file and is waiting to be told
            which. Saying it anyway made every open flash the empty state for a
            round trip. */}
        {artifacts.loaded ? (
          <PreviewNotice
            icon="files"
            title={artifacts.error ? copy.pane.listLoadFailed : copy.pane.noFileOpen}
            detail={copy.pane.noFileOpenHint}
          />
        ) : (
          <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
            <LoadingSpinner size={24} />
          </div>
        )}
      </div>
    );
  }

  // Two layers, as in the reference. The OUTER one is the pane's floor and
  // never scrolls; the INNER one has a definite height (`h-full`) and is the
  // scroll container. That definite height is what lets a page, a PDF or an
  // image fill the pane — under a single `flex-1` layer they have no height to
  // resolve against and collapse onto whatever minimum they carry.
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      data-maka-contract="session-artifacts"
      data-view="preview"
      role="region"
      aria-label={copy.pane.previewNamed(record.name)}
    >
      <div className={cn('h-full overflow-auto', previewNeedsPadding(record) && 'px-3 pb-3 pt-2')}>
        <ArtifactBody sessionId={sessionId} record={record} copy={copy} />
      </div>
    </div>
  );
}

function ArtifactBody(props: {
  sessionId: string;
  record: ArtifactDescriptor;
  copy: ArtifactCopy;
}) {
  const view = useStore(
    workbarStore,
    (state) => state.artifactViewModeBySession[props.sessionId] ?? 'preview',
  );
  const actions = useArtifactActions(props.sessionId, props.copy);
  return (
    <ArtifactPreview
      key={props.record.id}
      record={props.record}
      view={view}
      onOpenExternally={() =>
        void (props.record.kind === 'html'
          ? actions.openExternally(props.record)
          : actions.reveal(props.record))
      }
    />
  );
}

/**
 * The pane's header while a file is open — the reference's, control for
 * control: what to look at on the left, what it is called in the middle, what
 * to do with it on the right.
 *
 * It renders in place of the tab strip rather than under it. Two 48px bands
 * with two bottom rules is what a second header looks like, and the file's own
 * name belongs on the pane's top line, not on a line the pane granted it.
 */
export function FilePreviewHeader(props: { sessionId: string }) {
  const locale = useUiLocale();
  const copy = getArtifactCopy(locale);
  const { record } = useOpenArtifact(props.sessionId, true);
  const view = useStore(
    workbarStore,
    (state) => state.artifactViewModeBySession[props.sessionId] ?? 'preview',
  );
  const [pendingDelete, setPendingDelete] = useState<ArtifactDescriptor | null>(null);
  const [copied, setCopied] = useState(false);
  const actions = useArtifactActions(props.sessionId, copy);
  // The selection is set before the catalog has named it — the pane opens on a
  // delivery the moment it lands. A spacer rather than nothing, so the expand
  // and close buttons do not slide left and back in the same second.
  if (!record) return <div className="min-w-0 flex-1" />;

  // `Report · MD`, never `report.md · MD`. The title drops the extension,
  // turns separators into spaces and capitalises — the extension is said once,
  // by the half that exists to say it.
  const extension = deliveryFileExtension(record.name);
  const textual = record.kind === 'file' || record.kind === 'diff' || record.kind === 'html';
  const menu = [
    ...(record.kind === 'html'
      ? [
          {
            label: copy.pane.openInDefaultApp,
            icon: 'arrowOutSquare' as const,
            onClick: () => void actions.openExternally(record),
          },
        ]
      : []),
    {
      label: copy.pane.saveAs,
      icon: 'download' as const,
      onClick: () => void actions.save(record),
    },
    ...(canUserDeleteArtifact(record)
      ? [
          {
            label: copy.pane.delete,
            icon: 'trash' as const,
            danger: true,
            onClick: () => setPendingDelete(record),
          },
        ]
      : []),
  ];

  return (
    <>
      {artifactHasRenderedView(record) && (
        <SegmentedControl
          size="sm"
          ariaLabel={copy.pane.previewNamed(record.name)}
          value={view}
          onChange={(next) => workbarStore.setArtifactViewMode(props.sessionId, next)}
          // Icons alone, as in the reference. The words are the control's
          // `aria-label` on each option, not a second thing to read: two
          // labelled segments plus a filename is more type than a 340px pane
          // has room for, and the eye/code pair needs no gloss.
          options={[
            { value: 'preview', label: copy.preview.rendered, icon: 'eye' },
            { value: 'code', label: copy.preview.source, icon: 'code' },
          ]}
        />
      )}

      {/* The name reads as ONE line: the file, then a dot dimmer than either
          side, then its type. A dot at the name's weight breaks it into three. */}
      <h2
        // `maka-pane-title`: in full screen this header is the window's only
        // drag surface, and every direct child of it opts out of dragging
        // because every other one is a control. A name is not.
        className={cn(
          'maka-pane-title min-w-0 flex-1 truncate text-sm font-normal text-text-secondary',
          !artifactHasRenderedView(record) && 'pl-2',
        )}
        title={record.name}
      >
        {deliveryFileTitle(record.name)}
        {extension && (
          <>
            <span className="text-text-muted opacity-50"> · </span>
            <span className="text-text-muted">{extension}</span>
          </>
        )}
      </h2>

      <div className="flex shrink-0 items-center gap-1">
        {textual && (
          <RightPaneTip label={copied ? copy.pane.copied : copy.pane.copy}>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={copied ? copy.pane.copied : copy.pane.copy}
              onClick={() =>
                void actions.copyText(record).then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <Anthropicon name={copied ? 'check' : 'copy'} size={20} />
            </Button>
          </RightPaneTip>
        )}
        {/* Reveal is the primary, not Save as. The file is already on this
            machine; "save a copy" is the rarer of the two and lives a click
            deeper, where the reference puts its own secondary routes. */}
        <SplitButton
          primaryLabel={copy.pane.openInFinder}
          primaryIcon={<Anthropicon name="folderOpen" size={16} className="shrink-0" />}
          primaryAction={() => void actions.reveal(record)}
          actions={menu}
        />
      </div>

      <DeleteConfirm
        record={pendingDelete}
        copy={copy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async (target) => {
          await actions.remove(target);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

/** Every route out of the pane, in one place because both halves reach for them. */
function useArtifactActions(sessionId: string, copy: ArtifactCopy) {
  const locale = useUiLocale();

  const openWith = useCallback(
    async (record: ArtifactDescriptor, open: typeof openArtifactPath) => {
      try {
        const result = await open(sessionId, record.id);
        if (!result.ok) toast({ title: copy.pane.openFailed, variant: 'destructive' });
      } catch (error) {
        toast({
          title: copy.pane.openFailed,
          description: actionErrorMessage(error, locale, copy),
          variant: 'destructive',
        });
      }
    },
    [copy, locale, sessionId],
  );

  return {
    reveal: (record: ArtifactDescriptor) => openWith(record, showArtifactInFolder),
    openExternally: (record: ArtifactDescriptor) => openWith(record, openArtifactPath),

    async save(record: ArtifactDescriptor) {
      try {
        const result = await saveArtifactAs(sessionId, record.id);
        if (result.ok) toast({ title: copy.pane.saved, description: record.name });
        else if (result.reason !== 'canceled') {
          toast({
            title: copy.pane.saveFailed,
            description: saveFailureCopy(result.reason, copy),
            variant: 'destructive',
          });
        }
      } catch (error) {
        toast({
          title: copy.pane.saveFailed,
          description: actionErrorMessage(error, locale, copy),
          variant: 'destructive',
        });
      }
    },

    async copyText(record: ArtifactDescriptor): Promise<boolean> {
      // Only text-backed kinds offer this; base64-stuffing a multi-megabyte
      // binary into the clipboard is a footgun, so the guard stays even though
      // the button never renders for those kinds.
      if (record.kind !== 'file' && record.kind !== 'diff' && record.kind !== 'html') return false;
      try {
        const result = await readArtifactText(sessionId, record.id);
        if (!result.ok) {
          toast({
            title: copy.pane.copyFailed,
            description: copy.pane.readTextFailed,
            variant: 'destructive',
          });
          return false;
        }
        await navigator.clipboard.writeText(result.text);
        toast({
          title: copy.pane.copied,
          description: `${record.name} · ${formatBytes(record.sizeBytes)}`,
          variant: 'success',
        });
        return true;
      } catch (error) {
        toast({
          title: copy.pane.copyFailed,
          description: actionErrorMessage(error, locale, copy),
          variant: 'destructive',
        });
        return false;
      }
    },

    async remove(record: ArtifactDescriptor) {
      try {
        await deleteArtifact(sessionId, record.id);
        workbarStore.selectArtifact(sessionId, undefined);
        await sessionArtifactsStore.refresh(sessionId);
        toast({ title: copy.pane.deleted(record.name), variant: 'success' });
      } catch (error) {
        toast({
          title: copy.pane.deleteFailed(record.name),
          description: actionErrorMessage(error, locale, copy),
          variant: 'destructive',
        });
      }
    },
  };
}

function DeleteConfirm(props: {
  record: ArtifactDescriptor | null;
  copy: ArtifactCopy;
  onCancel: () => void;
  onConfirm: (record: ArtifactDescriptor) => Promise<void>;
}) {
  const record = props.record;
  return (
    <ConfirmDialog
      open={record !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={record ? props.copy.pane.deleteTitle(record.name) : ''}
      description={props.copy.pane.deleteDescription}
      confirmText={props.copy.pane.delete}
      cancelText={props.copy.pane.cancel}
      variant="destructive"
      waitForConfirm
      onConfirm={async () => {
        if (record) await props.onConfirm(record);
      }}
    />
  );
}

function saveFailureCopy(reason: string, copy: ArtifactCopy): string {
  const failures = copy.pane.saveFailures;
  return reason in failures ? failures[reason as keyof typeof failures] : failures.default;
}

function actionErrorMessage(error: unknown, locale: UiLocale, copy: ArtifactCopy): string {
  const raw = redactSecrets(error instanceof Error ? error.message : String(error ?? '')).trim();
  if (!raw) return copy.pane.actionFailed;
  return generalizedErrorMessageForLocale(new Error(raw), '', locale) || copy.pane.actionFailed;
}
