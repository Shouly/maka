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
// Two levels in one column — list, then one file — the way the subagents page
// does it. The page is a plain file editor on purpose: what the model reads is
// the file, so what the user edits is the file, not a projection of it.
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
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from './settings-row.js';
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
import { getShellCopy } from '../../locales/shell-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

type Route = { kind: 'list' } | { kind: 'create' } | { kind: 'file'; path: string };

export function MemorySettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getMemorySettingsCopy(locale);
  const groups = getSettingsSharedCopy(locale).groups;
  const paths = getShellCopy(locale).projectActions;
  const report = useSettingsErrorReporter();
  const memory = useMemoryList(props.host);
  const [route, setRoute] = useState<Route>({ kind: 'list' });
  const [busy, setBusy] = useState<'toggle' | 'open' | null>(null);

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

  if (route.kind !== 'list') {
    return (
      <MemoryFileEditor
        host={props.host}
        path={route.kind === 'file' ? route.path : null}
        onBack={() => {
          setRoute({ kind: 'list' });
          memory.reload();
        }}
      />
    );
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
        {state?.incognitoActive && (
          <SettingsRow
            title={copy.incognito}
            description={copy.incognitoHelp}
            control={
              <span className={`${statusChipClass} ${statusChipToneClass('attention')}`}>
                {copy.incognito}
              </span>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection
        title={copy.files}
        description={
          state?.directoryPath ? (
            <span className="flex flex-col gap-0.5">
              <span>{copy.filesHelp}</span>
              <span className="font-mono text-text-muted">{state.directoryPath}</span>
            </span>
          ) : (
            copy.filesHelp
          )
        }
        action={
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={copy.reload}
              disabled={memory.loading}
              onClick={memory.reload}
            >
              <Anthropicon name="arrowClockwise" size={16} />
            </Button>
            {state?.directoryPath && (
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={openFolder}>
                {busy === 'open' ? copy.opening : copy.openFolder}
              </Button>
            )}
            <Button size="sm" disabled={!state} onClick={() => setRoute({ kind: 'create' })}>
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
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm leading-5 text-text-primary">{copy.emptyTitle}</p>
            <p className="max-w-md text-[0.8125rem] leading-[1.125rem] text-text-secondary">
              {copy.emptyHelp}
            </p>
          </div>
        ) : (
          state.files.map((file) => (
            <SettingsRow
              key={file.path}
              title={<span className="font-mono">{file.path}</span>}
              description={
                <span className="flex flex-col gap-0.5">
                  <span>{file.description ?? copy.noDescription}</span>
                  <span className="text-text-muted">
                    {copy.bytes(file.byteLength.toLocaleString(copy.intlLocale))} ·{' '}
                    <RelativeTime ts={file.updatedAt} />
                  </span>
                </span>
              }
              control={
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={copy.openFileAria(file.path)}
                  onClick={() => setRoute({ kind: 'file', path: file.path })}
                >
                  <Anthropicon name="caretRight" size={16} />
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>
    </>
  );
}

/** One file. `path` is null for a new one. */
function MemoryFileEditor(props: {
  host: DesktopRuntimeHostRef | undefined;
  path: string | null;
  onBack: () => void;
}) {
  const locale = useUiLocale();
  const copy = getMemorySettingsCopy(locale);
  const text = copy.editor;
  const report = useSettingsErrorReporter();
  const [document, setDocument] = useState<MemoryDocumentProjection | null | undefined>(
    props.path === null ? null : undefined,
  );
  const [path, setPath] = useState(props.path ?? '');
  // `null` means "no local edits": the textarea follows the file until the
  // user types, which is what makes a reload land without a prompt.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (props.path === null) return;
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
  const creating = props.path === null;
  const dirty = creating
    ? value.trim().length > 0 && path.trim().length > 0
    : draft !== null && draft !== content;

  const save = async () => {
    setBusy('save');
    try {
      const result = await writeMemoryFile(
        {
          path: creating ? path.trim() : props.path!,
          content: value,
          ifVersion: creating ? 'new' : (document?.version ?? 'new'),
        },
        props.host,
      );
      if (result.kind === 'written') {
        toast({ title: creating ? text.created : text.saved, variant: 'success' });
        props.onBack();
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
      toast({
        title: copy.errors.saveFailed,
        description: memoryRejectionMessage(
          result.kind === 'rejected' ? result.reason : undefined,
          copy,
          copy.errors.saveFailed,
        ),
        variant: 'destructive',
      });
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
        props.onBack();
        return;
      }
      toast({
        title: copy.errors.deleteFailed,
        description: memoryRejectionMessage(
          result.kind === 'rejected' ? result.reason : undefined,
          copy,
          copy.errors.deleteFailed,
        ),
        variant: 'destructive',
      });
    } catch (error) {
      report(copy.errors.deleteFailed, error);
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <SettingsSection
        title={creating ? text.createTitle : props.path!}
        description={
          !creating && document ? (
            <span>
              {copy.bytes(document.byteLength.toLocaleString(copy.intlLocale))} ·{' '}
              <RelativeTime ts={document.updatedAt} />
            </span>
          ) : undefined
        }
        action={
          <Button variant="ghost" size="sm" onClick={props.onBack} aria-label={text.back}>
            <Anthropicon name="arrowLeft" size={16} />
            {text.back}
          </Button>
        }
      >
        {creating && (
          <SettingsRow
            title={text.path}
            description={text.pathHelp}
            htmlFor="memory-file-path"
            control={
              <Input
                id="memory-file-path"
                className={`${settingsFieldWidthClass} font-mono`}
                placeholder={text.pathPlaceholder}
                value={path}
                onChange={(event) => setPath(event.target.value)}
              />
            }
          />
        )}
        <SettingsRow title={text.content} layout="stacked" htmlFor="memory-file-content">
          {!creating && document === undefined ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : (
            <Textarea
              id="memory-file-content"
              className="min-h-64 font-mono text-[0.8125rem] leading-5"
              placeholder={text.contentPlaceholder}
              value={value}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </SettingsRow>
        <SettingsRow
          title=""
          control={
            <span className="flex items-center gap-2">
              {!creating && document && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(true)}
                >
                  {busy === 'delete' ? text.deleting : text.delete}
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy !== null || !dirty || (!creating && !document)}
                onClick={() => void save()}
              >
                {busy === 'save' ? text.saving : text.save}
              </Button>
            </span>
          }
        />
      </SettingsSection>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={copy.remove.title(props.path ?? '')}
        description={copy.remove.description}
        confirmText={copy.remove.confirm}
        cancelText={copy.remove.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={remove}
      />
    </>
  );
}
