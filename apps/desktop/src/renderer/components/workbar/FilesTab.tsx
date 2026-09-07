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

// What this task produced: the artifact catalog, and one file open at a time.
//
// Two screens rather than a split, because the pane's floor is 340px and a
// master/detail at that width gives the file 180 of them. The list is ONE tab
// stop with roving selection (`artifact-list-keyboard.ts`) — thirty rows each
// taking a Tab would bury the composer behind the pane.
//
// Only user-visible artifacts are listed (`isArtifactUserVisible`): tool
// results and their projections are the transcript's evidence, not the task's
// output, and the timeline already shows them in place.
//
// The list re-reads on the events that can change it — a settled tool result
// or a finished turn — rather than on a timer. Writeback can commit a moment
// after the event, so the read is debounced past the burst rather than issued
// per event.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import {
  canUserDeleteArtifact,
  isArtifactUserVisible,
  type ArtifactDescriptor,
} from '@maka/core/artifacts';
import { formatRelativeTimestamp } from '@maka/core/relative-time';
import { generalizedErrorMessageForLocale, redactSecrets } from '@maka/core/redaction';
import { formatBytes, useUiLocale } from '@maka/ui';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { menuDangerItemClass } from '../ui/menu-variants.js';
import { ArtifactPreview } from './ArtifactPreview.js';
import { PreviewNotice } from './PreviewNotice.js';
import { cn } from '../../lib/cn.js';
import { deleteArtifact, listArtifacts, readArtifactText } from '../../bridge/artifacts.js';
import { openArtifactPath, saveArtifactAs } from '../../bridge/app.js';
import { activeSessionStore } from '../../store/index.js';
import { matchArtifactForPath, workbarStore } from '../../store/workbar-store.js';
import { toast } from '../../store/toast-store.js';
import { nextArtifactListAction } from '../../lib/ported/artifact-list-keyboard.js';
import { getArtifactCopy, type ArtifactCopy } from '../../locales/artifact-copy.js';

/** Long enough to absorb a turn's closing burst, short enough to feel live. */
const ARTIFACT_REFRESH_DEBOUNCE_MS = 400;

const KIND_GLYPH = {
  file: 'file',
  diff: 'pullRequest',
  html: 'code',
  image: 'image',
  pdf: 'note',
} as const satisfies Record<ArtifactDescriptor['kind'], AnthropiconName>;

export function FilesTab(props: { sessionId: string; active: boolean }) {
  const { active, sessionId } = props;
  const locale = useUiLocale();
  const copy = getArtifactCopy(locale);
  const [records, setRecords] = useState<readonly ArtifactDescriptor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ArtifactDescriptor | null>(null);
  const requestRef = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedId = useStore(workbarStore, (state) => state.artifactBySession[sessionId]);
  const pendingPath = useStore(workbarStore, (state) => state.pendingPathBySession[sessionId]);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const next = await listArtifacts(sessionId);
      if (request !== requestRef.current) return;
      setRecords(next.filter((record) => isArtifactUserVisible(record)));
      setLoaded(true);
      setError(null);
    } catch (unknownError) {
      if (request !== requestRef.current) return;
      setLoaded(true);
      setError(actionErrorMessage(unknownError, locale, copy));
    }
  }, [copy, locale, sessionId]);

  useEffect(() => {
    setRecords([]);
    setLoaded(false);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), ARTIFACT_REFRESH_DEBOUNCE_MS);
    };
    const off = activeSessionStore.subscribeSessionEvents((eventSessionId, event) => {
      if (eventSessionId !== sessionId) return;
      if (event.type !== 'tool_result' && event.type !== 'complete') return;
      schedule();
    });
    void refresh();
    return () => {
      requestRef.current += 1;
      clearTimeout(timer);
      off();
    };
  }, [active, refresh, sessionId]);

  // A `file_write` row asked for a path before the list could name an id.
  useEffect(() => {
    if (!pendingPath) return;
    const match = matchArtifactForPath(records, pendingPath);
    if (match) workbarStore.resolvePendingPath(sessionId, match.id);
    else if (loaded && records.length > 0) workbarStore.clearPendingPath(sessionId);
  }, [loaded, pendingPath, records, sessionId]);

  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  // A selection whose artifact left the catalog returns to the list rather
  // than leaving an empty preview behind.
  useEffect(() => {
    if (selectedId && loaded && !records.some((record) => record.id === selectedId)) {
      workbarStore.selectArtifact(sessionId, undefined);
    }
  }, [loaded, records, selectedId, sessionId]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);

  const reveal = useCallback(
    (record: ArtifactDescriptor) =>
      run(async () => {
        try {
          const result = await openArtifactPath(sessionId, record.id);
          if (!result.ok) toast({ title: copy.pane.openFailed, variant: 'destructive' });
        } catch (unknownError) {
          toast({
            title: copy.pane.openFailed,
            description: actionErrorMessage(unknownError, locale, copy),
            variant: 'destructive',
          });
        }
      }),
    [copy, locale, run, sessionId],
  );

  const save = useCallback(
    (record: ArtifactDescriptor) =>
      run(async () => {
        try {
          const result = await saveArtifactAs(sessionId, record.id);
          if (result.ok) toast({ title: copy.pane.saved, description: record.name });
          else if (result.reason !== 'canceled')
            toast({
              title: copy.pane.saveFailed,
              description: saveFailureCopy(result.reason, copy),
              variant: 'destructive',
            });
        } catch (unknownError) {
          toast({
            title: copy.pane.saveFailed,
            description: actionErrorMessage(unknownError, locale, copy),
            variant: 'destructive',
          });
        }
      }),
    [copy, locale, run, sessionId],
  );

  const copyText = useCallback(
    (record: ArtifactDescriptor) =>
      run(async () => {
        // Only text-backed kinds offer this; base64-stuffing a multi-megabyte
        // binary into the clipboard is a footgun, so the guard stays even
        // though the menu never renders the item for those kinds.
        if (record.kind !== 'file' && record.kind !== 'diff' && record.kind !== 'html') return;
        try {
          const result = await readArtifactText(sessionId, record.id);
          if (!result.ok) {
            toast({
              title: copy.pane.copyFailed,
              description: copy.pane.readTextFailed,
              variant: 'destructive',
            });
            return;
          }
          await navigator.clipboard.writeText(result.text);
          toast({
            title: copy.pane.copied,
            description: `${record.name} · ${formatBytes(record.sizeBytes)}`,
            variant: 'success',
          });
        } catch (unknownError) {
          toast({
            title: copy.pane.copyFailed,
            description: actionErrorMessage(unknownError, locale, copy),
            variant: 'destructive',
          });
        }
      }),
    [copy, locale, run, sessionId],
  );

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const action = nextArtifactListAction({
      ...(selectedId ? { currentSelectedId: selectedId } : { currentSelectedId: undefined }),
      visibleIds: records.map((record) => record.id),
      key: event.key,
    });
    if (action.kind === 'noop' || action.kind === 'dismiss') return;
    event.preventDefault();
    event.stopPropagation();
    workbarStore.selectArtifact(sessionId, action.targetId);
  };

  if (selected) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-maka-contract="session-artifacts"
        data-view="preview"
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={copy.pane.back}
            onClick={() => {
              workbarStore.selectArtifact(sessionId, undefined);
              requestAnimationFrame(() => listRef.current?.focus());
            }}
          >
            <Anthropicon name="arrowLeft" size={16} />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium leading-5 text-text-primary">
              {selected.name}
            </span>
            <span className="truncate text-xs leading-4 text-text-muted">
              {formatBytes(selected.sizeBytes)} ·{' '}
              {formatRelativeTimestamp(selected.createdAt, Date.now(), locale)}
            </span>
          </div>
          <ArtifactActions
            record={selected}
            copy={copy}
            disabled={busy}
            onReveal={() => void reveal(selected)}
            onSave={() => void save(selected)}
            onCopy={() => void copyText(selected)}
            onDelete={() => setPendingDelete(selected)}
          />
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto px-3 pb-3"
          role="region"
          aria-label={copy.pane.previewNamed(selected.name)}
        >
          <ArtifactPreview
            key={selected.id}
            record={selected}
            onOpenExternally={() => void reveal(selected)}
          />
        </div>
        <DeleteConfirm
          record={pendingDelete}
          copy={copy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async (record) => {
            try {
              await deleteArtifact(sessionId, record.id);
              workbarStore.selectArtifact(sessionId, undefined);
              await refresh();
              toast({ title: copy.pane.deleted(record.name), variant: 'success' });
            } catch (unknownError) {
              toast({
                title: copy.pane.deleteFailed(record.name),
                description: actionErrorMessage(unknownError, locale, copy),
                variant: 'destructive',
              });
            } finally {
              setPendingDelete(null);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="session-artifacts">
      {error && (
        <div className="shrink-0 px-3 pt-3">
          <p className="rounded-lg bg-danger-subtle px-3 py-2 text-xs leading-5 text-danger">
            {copy.pane.listLoadFailed} · {error}
          </p>
        </div>
      )}
      {records.length === 0 ? (
        <PreviewNotice icon="files" title={copy.pane.empty} detail={copy.pane.emptyHint} />
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={copy.pane.listAria}
          aria-activedescendant={selectedId ? `maka-artifact-row-${selectedId}` : undefined}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className="min-h-0 flex-1 overflow-y-auto p-2 outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
        >
          {records.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                id={`maka-artifact-row-${record.id}`}
                role="option"
                aria-selected={record.id === selectedId}
                tabIndex={-1}
                data-maka-artifact-row={record.name}
                onClick={() => workbarStore.selectArtifact(sessionId, record.id)}
                className={cn(
                  'ui-control-squish ui-control-squish-ghost flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none',
                  record.id === selectedId && 'bg-sidebar-selected',
                )}
              >
                <span className="shrink-0 text-text-muted" aria-hidden="true">
                  <Anthropicon name={KIND_GLYPH[record.kind]} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm leading-5 text-text-primary">
                  {record.name}
                </span>
                <span className="shrink-0 text-xs leading-4 text-text-muted">
                  {formatBytes(record.sizeBytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArtifactActions(props: {
  record: ArtifactDescriptor;
  copy: ArtifactCopy;
  disabled: boolean;
  onReveal: () => void;
  onSave: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { copy, record } = props;
  const textual = record.kind === 'file' || record.kind === 'diff' || record.kind === 'html';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="iconSm"
          disabled={props.disabled}
          aria-label={copy.pane.moreActions(record.name)}
        >
          <Anthropicon name="dotsVertical" size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={props.onReveal}>
          <DropdownMenuItemIcon>
            <Anthropicon name="folderOpen" size={20} />
          </DropdownMenuItemIcon>
          {copy.pane.openInFinder}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSave}>
          <DropdownMenuItemIcon>
            <Anthropicon name="download" size={20} />
          </DropdownMenuItemIcon>
          {copy.pane.saveAs}
        </DropdownMenuItem>
        {textual && (
          <DropdownMenuItem onSelect={props.onCopy}>
            <DropdownMenuItemIcon>
              <Anthropicon name="copy" size={20} />
            </DropdownMenuItemIcon>
            {copy.pane.copy}
          </DropdownMenuItem>
        )}
        {canUserDeleteArtifact(record) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onDelete}>
              <DropdownMenuItemIcon>
                <Anthropicon name="trash" size={20} />
              </DropdownMenuItemIcon>
              {copy.pane.delete}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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

function actionErrorMessage(
  error: unknown,
  locale: ReturnType<typeof useUiLocale>,
  copy: ArtifactCopy,
): string {
  const raw = redactSecrets(error instanceof Error ? error.message : String(error ?? '')).trim();
  if (!raw) return copy.pane.actionFailed;
  return generalizedErrorMessageForLocale(new Error(raw), '', locale) || copy.pane.actionFailed;
}
