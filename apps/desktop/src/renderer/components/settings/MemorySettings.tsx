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

// The memory filesystem: one switch, a folder of Markdown files, an editor.
//
// The list, and one file as a sub-view of it, with the dialog's top bar as
// the way back. A new file
// is a form, so it opens as a dialog over the list. The page is a plain file
// editor on purpose: what the model reads is the file, so what the user edits
// is the file, not a projection of it.
//
// Every save carries the version the page read. The model and the background
// pass write the same files between reads, so a stale save comes back as a
// conflict with the current content; the editor then shows that content and
// asks for the change again rather than overwriting what arrived meanwhile.

import { useEffect, useState } from 'react';
import { RelativeTime, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { Textarea } from '../ui/textarea.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
  useSettingsBack,
} from './settings-kit.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { useMemoryList } from '../../hooks/use-memory-state.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { openPath } from '../../bridge/app.js';
import {
  deleteMemoryFile,
  readMemoryFile,
  setMemoryEnabled,
  writeMemoryFile,
  type MemoryDocumentProjection,
} from '../../bridge/memory.js';
import { toast } from '../../store/toast-store.js';
import {
  getMemorySettingsCopy,
  memoryRejectionMessage,
} from '../../locales/settings-memory-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getSettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

type Route = { kind: 'list' } | { kind: 'file'; path: string };

export function MemorySettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getMemorySettingsCopy(locale);
  const groups = getSettingsSharedCopy(locale).groups;
  const paths = getShellCopy(locale).projectActions;
  const report = useSettingsErrorReporter();
  const memory = useMemoryList(props.host);
  const [route, setRoute] = useState<Route>({ kind: 'list' });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<'toggle' | 'open' | null>(null);
  const backToList = () => {
    setRoute({ kind: 'list' });
    memory.reload();
  };
  useSettingsBack(
    route.kind === 'file'
      ? { label: getSettingsNavigationCopy(locale).sections.memory.label, onBack: backToList }
      : null,
  );

  const state = memory.state;

  const toggle = async (enabled: boolean) => {
    setBusy('toggle');
    try {
      memory.apply(await setMemoryEnabled(enabled, props.host));
    } catch (error) {
      report(copy.errors.toggleFailed, error);
    } finally {
      setBusy(null);
    }
  };

  const openFolder = () => {
    setBusy('open');
    void openPath('memory', undefined, props.host)
      .then((result) => {
        if (!result.ok) {
          toast({
            title: copy.errors.openFailed,
            description: paths.openPathFailures[result.reason],
            variant: 'destructive',
          });
        }
      })
      .catch((error: unknown) => report(copy.errors.openFailed, error))
      .finally(() => setBusy(null));
  };

  if (route.kind === 'file') {
    return <MemoryFileView host={props.host} path={route.path} onDone={backToList} />;
  }

  return (
    <>
      <SettingsSection title={groups.memorySources} description={groups.memorySourcesHelp}>
        <SettingsRow
          title={copy.generate}
          description={copy.generateHelp}
          control={
            state ? (
              <Switch
                checked={state.enabled}
                disabled={busy !== null}
                aria-label={copy.generate}
                onCheckedChange={(checked) => void toggle(checked)}
              />
            ) : (
              <Skeleton className="h-5 w-9 rounded-full" />
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        title={copy.files}
        description={
          state?.directoryPath ? (
            <span className="flex flex-col gap-0.5">
              <span>{copy.filesHelp}</span>
              <span className="break-all font-mono text-[0.8125rem] text-text-muted">
                {state.directoryPath}
              </span>
            </span>
          ) : (
            copy.filesHelp
          )
        }
        action={
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={copy.reload}
              disabled={memory.loading}
              onClick={memory.reload}
            >
              <Anthropicon name="arrowClockwise" size={16} />
            </Button>
            {state?.directoryPath && (
              <Button variant="secondary" disabled={busy !== null} onClick={openFolder}>
                {busy === 'open' ? copy.opening : copy.openFolder}
              </Button>
            )}
            <Button disabled={!state} onClick={() => setCreating(true)}>
              {copy.newFile}
            </Button>
          </span>
        }
      >
        {!state ? (
          <SettingsRow
            title={<Skeleton className="h-5 w-40 rounded" />}
            control={<Skeleton className="h-8 w-8 rounded-lg" />}
          />
        ) : state.files.length === 0 ? (
          <SettingsEmpty title={copy.emptyTitle} body={copy.emptyHelp} />
        ) : (
          <SettingsTable
            label={copy.files}
            head={
              <>
                <SettingsTableHeadCell>{copy.columns.file}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-28">{copy.columns.size}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-36">
                  {copy.columns.updated}
                </SettingsTableHeadCell>
              </>
            }
          >
            {state.files.map((file) => (
              <SettingsTableRow
                key={file.path}
                onOpen={() => setRoute({ kind: 'file', path: file.path })}
                openLabel={copy.openFileAria(file.path)}
              >
                <SettingsTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-mono text-[0.8125rem]">{file.path}</span>
                    <span className="truncate text-[0.8125rem] leading-[1.0625rem] text-text-muted">
                      {file.description ?? copy.noDescription}
                    </span>
                  </span>
                </SettingsTableCell>
                <SettingsTableCell className="text-text-secondary">
                  {copy.bytes(file.byteLength.toLocaleString(copy.intlLocale))}
                </SettingsTableCell>
                <SettingsTableCell className="text-text-secondary">
                  <RelativeTime ts={file.updatedAt} />
                </SettingsTableCell>
              </SettingsTableRow>
            ))}
          </SettingsTable>
        )}
      </SettingsSection>

      {creating && (
        <MemoryCreateDialog
          host={props.host}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            memory.reload();
          }}
        />
      )}
    </>
  );
}

/** Tell the user why a write or delete did not land, in the Host's words. */
function useMemoryFailure() {
  const copy = getMemorySettingsCopy(useUiLocale());
  return (title: string, reason: string | undefined) =>
    toast({
      title,
      description: memoryRejectionMessage(reason, copy, title),
      variant: 'destructive',
    });
}

/** A new file: a path and its content, as a dialog over the list. */
function MemoryCreateDialog(props: {
  host: DesktopRuntimeHostRef | undefined;
  onClose: () => void;
  onCreated: () => void;
}) {
  const copy = getMemorySettingsCopy(useUiLocale());
  const text = copy.editor;
  const report = useSettingsErrorReporter();
  const fail = useMemoryFailure();
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = path.trim().length > 0 && content.trim().length > 0;

  const create = async () => {
    setBusy(true);
    try {
      const result = await writeMemoryFile(
        { path: path.trim(), content, ifVersion: 'new' },
        props.host,
      );
      if (result.kind === 'written') {
        toast({ title: text.created, variant: 'success' });
        props.onCreated();
        return;
      }
      fail(copy.errors.saveFailed, result.kind === 'rejected' ? result.reason : undefined);
    } catch (error) {
      report(copy.errors.saveFailed, error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsModal
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
      size="lg"
      title={text.createTitle}
      data-maka-contract="memory-file-create"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={props.onClose}>
            {copy.remove.cancel}
          </Button>
          <Button disabled={busy || !ready} onClick={() => void create()}>
            {busy ? text.saving : text.create}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SettingsModalField label={text.path} htmlFor="memory-file-path" hint={text.pathHelp}>
          <Input
            id="memory-file-path"
            className="font-mono"
            placeholder={text.pathPlaceholder}
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </SettingsModalField>
        <SettingsModalField label={text.content} htmlFor="memory-file-content">
          <Textarea
            id="memory-file-content"
            className="min-h-56 font-mono text-[0.8125rem] leading-5"
            placeholder={text.contentPlaceholder}
            value={content}
            spellCheck={false}
            onChange={(event) => setContent(event.target.value)}
          />
        </SettingsModalField>
      </div>
    </SettingsModal>
  );
}

/** One file, as a sub-view of the list: its content, editable in place. */
function MemoryFileView(props: {
  host: DesktopRuntimeHostRef | undefined;
  path: string;
  onDone: () => void;
}) {
  const locale = useUiLocale();
  const copy = getMemorySettingsCopy(locale);
  const text = copy.editor;
  const report = useSettingsErrorReporter();
  const fail = useMemoryFailure();
  const [document, setDocument] = useState<MemoryDocumentProjection | null | undefined>(undefined);
  // `null` means "no local edits": the textarea follows the file until the
  // user types, which is what makes a reload land without a prompt.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readMemoryFile(props.path, props.host).then(
      (loaded) => {
        if (cancelled) return;
        setDocument(loaded);
        if (loaded === null) toast({ title: text.missing, variant: 'destructive' });
      },
      (error: unknown) => {
        if (!cancelled) report(copy.errors.readFailed, error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.path, props.host?.profileId, props.host?.hostId]);

  const content = document?.content ?? '';
  const value = draft ?? content;
  const dirty = draft !== null && draft !== content;

  const save = async () => {
    if (!document) return;
    setBusy('save');
    try {
      const result = await writeMemoryFile(
        { path: props.path, content: value, ifVersion: document.version },
        props.host,
      );
      if (result.kind === 'written') {
        toast({ title: text.saved, variant: 'success' });
        props.onDone();
        return;
      }
      if (result.kind === 'rejected' && result.reason === 'version_conflict' && result.current) {
        // The file moved under the editor: show what is there now, keep the
        // user's draft out of the way, and let them apply the change again.
        setDocument(result.current);
        setDraft(null);
        toast({ title: text.conflict, description: text.conflictHelp, variant: 'destructive' });
        return;
      }
      fail(copy.errors.saveFailed, result.kind === 'rejected' ? result.reason : undefined);
    } catch (error) {
      report(copy.errors.saveFailed, error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!document) return;
    setBusy('delete');
    try {
      const result = await deleteMemoryFile(
        { path: document.path, ifVersion: document.version },
        props.host,
      );
      if (result.kind === 'deleted') {
        toast({ title: text.deleted, variant: 'success' });
        props.onDone();
        return;
      }
      fail(copy.errors.deleteFailed, result.kind === 'rejected' ? result.reason : undefined);
    } catch (error) {
      report(copy.errors.deleteFailed, error);
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  return (
    <div data-maka-contract="memory-file">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate font-mono text-[0.9375rem] font-semibold leading-5 text-text-primary">
            {props.path}
          </h2>
          {document && (
            <p className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">
              {copy.bytes(document.byteLength.toLocaleString(copy.intlLocale))} ·{' '}
              <RelativeTime ts={document.updatedAt} />
            </p>
          )}
        </div>
        <RowActionsMenu
          label={copy.fileActions(props.path)}
          actions={[
            {
              label: busy === 'delete' ? text.deleting : text.delete,
              icon: 'trash',
              danger: true,
              disabled: busy !== null || !document,
              onSelect: () => setConfirmDelete(true),
            },
          ]}
        />
      </div>

      {document === undefined ? (
        <Skeleton className="h-80 w-full rounded-lg" />
      ) : (
        <Textarea
          aria-label={text.content}
          className="min-h-80 font-mono text-[0.8125rem] leading-5"
          value={value}
          spellCheck={false}
          disabled={document === null}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="secondary" disabled={busy !== null} onClick={() => setDraft(null)}>
            {text.revert}
          </Button>
        )}
        <Button disabled={busy !== null || !dirty || !document} onClick={() => void save()}>
          {busy === 'save' ? text.saving : text.save}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={copy.remove.title(props.path)}
        description={copy.remove.description}
        confirmText={copy.remove.confirm}
        cancelText={copy.remove.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={remove}
      />
    </div>
  );
}
