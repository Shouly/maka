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

// MEMORY.md: a file the user can read, edit and switch off.
//
// The page is deliberately a document editor rather than an entry manager. The
// entries below the textarea are a projection OF that document — parsed from
// the draft while it is dirty, so what the list says and what the file says can
// never disagree — and the model-context preview is built through the same
// `buildLocalMemoryPromptBody` the runtime uses, so "what will be sent" is
// answered by the sender rather than re-derived here.
//
// Two switches, two different meanings: `enabled` is whether the file is used
// at all, `agentReadEnabled` is whether its contents reach the model. Both are
// Host state, not settings, so they are written through `bridge/memory.ts` and
// the returned snapshot replaces the page's — never a second read.

import { useMemo, useState } from 'react';
import { parseLocalMemoryMarkdown, type LocalMemoryState } from '@maka/core/local-memory';
import { useUiLocale, redactSecrets } from '@maka/ui';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { Textarea } from '../ui/textarea.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { MemoryEntryList } from './memory/MemoryEntryList.js';
import { SettingsRow, SettingsSection, settingsPanelClass } from './settings-row.js';
import { useMemoryState } from '../../hooks/use-memory-state.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import {
  displayMemoryPath,
  filterLocalMemoryEntries,
  localMemoryPromptBlockedReason,
  memoryPromptPreview,
  memoryStatusTone,
} from '../../lib/ported/memory-settings-presentation.js';
import {
  openMemoryFile,
  resetMemory,
  restoreLatestMemoryBackup,
  saveMemory,
  setMemoryAgentReadEnabled,
  setMemoryEnabled,
} from '../../bridge/memory.js';
import { toast } from '../../store/toast-store.js';
import { getMemorySettingsCopy } from '../../locales/settings-memory-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

type Busy = 'enable' | 'agent-read' | 'save' | 'reset' | 'restore' | 'open' | null;

export function MemorySettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getMemorySettingsCopy(locale);
  const text = copy.text;
  const groups = getSettingsSharedCopy(locale).groups;
  const report = useSettingsErrorReporter();
  const memory = useMemoryState(props.host);
  const [draft, setDraft] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const state = memory.state;
  const content = state?.content ?? '';
  // `null` means "no local edits": the textarea follows the file until the user
  // types, which is what makes an external change show up without a prompt.
  const value = draft ?? content;
  const dirty = draft !== null && draft !== content;

  const parsed = useMemo(
    () => (dirty ? parseLocalMemoryMarkdown(value) : undefined),
    [dirty, value],
  );
  const visible = parsed ?? state;
  const active = useMemo(
    () =>
      filterLocalMemoryEntries(visible?.activeEntries ?? [], query, {
        intlLocale: copy.intlLocale,
        originLabel: (origin) => copy.origins[origin],
      }),
    [visible, query, copy],
  );
  const archived = useMemo(
    () =>
      filterLocalMemoryEntries(visible?.archivedEntries ?? [], query, {
        intlLocale: copy.intlLocale,
        originLabel: (origin) => copy.origins[origin],
      }),
    [visible, query, copy],
  );
  const preview = useMemo(() => memoryPromptPreview(value), [value]);
  const blocked = state ? localMemoryPromptBlockedReason(state) : 'disabled';
  const sensitive = redactSecrets(value) !== value;

  /** Every mutation answers with the new state; failures keep the old one. */
  const run = async (
    kind: Exclude<Busy, null>,
    operation: () => Promise<LocalMemoryState>,
    failure: string,
  ) => {
    setBusy(kind);
    try {
      memory.apply(await operation());
    } catch (error) {
      report(failure, error);
    } finally {
      setBusy(null);
    }
  };

  if (memory.loading && !state) {
    return (
      <SettingsSection title={groups.memorySources} description={groups.memorySourcesHelp}>
        <SettingsRow
          title={text.localFile}
          control={<Skeleton className="h-5 w-9 rounded-full" />}
        />
        <SettingsRow
          title={text.agentReadable}
          control={<Skeleton className="h-5 w-9 rounded-full" />}
        />
      </SettingsSection>
    );
  }

  if (!state) {
    return (
      <SettingsSection title={groups.memorySources} description={groups.memorySourcesHelp}>
        <SettingsRow
          title={text.loadFailed}
          control={
            <Button variant="secondary" size="sm" onClick={memory.reload}>
              {text.reload}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title={groups.memorySources} description={groups.memorySourcesHelp}>
        <SettingsRow
          title={text.localFile}
          description={
            state.path
              ? `${text.localFileHelp} · ${displayMemoryPath(state.path)}`
              : text.waitingFile
          }
          control={
            <span className="flex items-center gap-3">
              <span
                className={`${statusChipClass} ${statusChipToneClass(memoryStatusTone(state.status))}`}
              >
                {copy.memoryStatuses[state.status]}
              </span>
              <Switch
                aria-label={text.enableLocalFile}
                checked={state.enabled}
                disabled={busy !== null}
                onCheckedChange={(enabled) => {
                  void run(
                    'enable',
                    () => setMemoryEnabled(enabled, props.host),
                    text.toggleFailed,
                  );
                }}
              />
            </span>
          }
        />
        <SettingsRow
          title={text.agentReadable}
          description={text.agentReadableHelp}
          control={
            <Switch
              aria-label={text.enableAgentRead}
              checked={state.agentReadEnabled}
              disabled={busy !== null}
              onCheckedChange={(enabled) => {
                void run(
                  'agent-read',
                  () => setMemoryAgentReadEnabled(enabled, props.host),
                  text.agentReadFailed,
                );
              }}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={groups.memoryDocument} description={groups.memoryDocumentHelp}>
        <SettingsRow
          title={text.fileContent}
          description={
            dirty ? text.dirty : copy.saveSummary(state.activeEntryCount, state.archivedEntryCount)
          }
          layout="stacked"
        >
          <Textarea
            aria-label={text.fileContent}
            className="min-h-[220px] font-mono text-[13px] leading-[20px]"
            value={value}
            spellCheck={false}
            disabled={busy === 'save'}
            onChange={(event) => setDraft(event.target.value)}
          />
          {sensitive && (
            <p className="text-[13px] leading-[18px] text-warning">
              {`${text.sensitiveDraft} · ${text.sensitiveDraftHelp}`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy !== null || !dirty}
              onClick={() => {
                void run(
                  'save',
                  async () => {
                    // Redaction happens on the way in, not on the way out: the
                    // file is what gets shared, so a token typed here must not
                    // reach disk in the clear.
                    const next = await saveMemory(redactSecrets(value), props.host);
                    setDraft(null);
                    toast({
                      title: sensitive ? text.savedRedacted : text.savedFile,
                      description: copy.saveSummary(next.activeEntryCount, next.archivedEntryCount),
                      variant: 'success',
                    });
                    return next;
                  },
                  text.saveFailed,
                );
              }}
            >
              {busy === 'save' ? text.saving : text.save}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setDraft(null);
                memory.reload();
                if (dirty) {
                  toast({ title: text.reloaded, description: text.reloadDiscarded });
                }
              }}
            >
              {memory.loading ? text.loading : text.reload}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setBusy('open');
                void openMemoryFile(props.host)
                  .then((result) => {
                    if (!result.ok) {
                      toast({
                        title: text.openFailed,
                        description: result.message,
                        variant: 'destructive',
                      });
                    }
                  })
                  .catch((error: unknown) => report(text.openFailed, error))
                  .finally(() => setBusy(null));
              }}
            >
              {text.openFile}
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          title={text.restorePrevious}
          description={
            state.latestBackup
              ? `${copy.backupKinds[state.latestBackup.kind]} · ${
                  state.latestBackup.safeMode
                    ? copy.backupOversize
                    : copy.backupSummary(
                        state.latestBackup.activeEntryCount,
                        state.latestBackup.archivedEntryCount,
                      )
                }`
              : text.waitingBackup
          }
          control={
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null || !state.latestBackup}
                onClick={() => setRestoreOpen(true)}
              >
                {busy === 'restore' ? text.restoring : text.restore}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => setResetOpen(true)}
              >
                {busy === 'reset' ? text.resetting : text.resetBackup}
              </Button>
            </span>
          }
        />
      </SettingsSection>

      <SettingsSection title={groups.memoryEntries} description={groups.memoryEntriesHelp}>
        <SettingsRow
          title={text.filterAria}
          description={
            query.trim()
              ? copy.countMatches(
                  active.length + archived.length,
                  (visible?.activeEntries.length ?? 0) + (visible?.archivedEntries.length ?? 0),
                )
              : undefined
          }
          control={
            <span className="flex items-center gap-2">
              <Input
                aria-label={text.filterAria}
                placeholder={text.filterPlaceholder}
                className="w-56"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  {text.clear}
                </Button>
              )}
            </span>
          }
        />
        <SettingsRow title={text.activeMemories} layout="stacked">
          <MemoryEntryList
            title={text.activeMemories}
            entries={active}
            emptyLabel={query.trim() ? text.noMatchEntry : text.waitingEntryHelp}
          />
        </SettingsRow>
        {archived.length > 0 && (
          <SettingsRow title={text.archivedMemories} layout="stacked">
            <MemoryEntryList
              title={text.archivedMemories}
              entries={archived}
              emptyLabel={text.noEntry}
            />
          </SettingsRow>
        )}
        <SettingsRow
          title={text.promptPreview}
          description={text.promptPreviewHelp}
          layout="stacked"
        >
          <div className={`${settingsPanelClass} p-3`}>
            <p className="mb-2 text-[13px] leading-[18px] text-text-secondary">
              {blocked
                ? `${text.willNotInject} · ${copy.promptBlocked[blocked]}`
                : `${text.willInject} · ${
                    preview.truncated
                      ? copy.previewTruncated(preview.limit.toLocaleString(copy.intlLocale))
                      : copy.previewUsage(
                          preview.text.length.toLocaleString(copy.intlLocale),
                          preview.limit.toLocaleString(copy.intlLocale),
                        )
                  }`}
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-[18px] text-text-primary">
              {state.status === 'safe_mode'
                ? text.safeModePreview
                : preview.text || text.emptyPromptPreview}
            </pre>
          </div>
        </SettingsRow>
      </SettingsSection>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={text.resetConfirmTitle}
        description={text.resetConfirmDescription}
        confirmText={text.confirmReset}
        cancelText={text.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          await run(
            'reset',
            async () => {
              const next = await resetMemory(props.host);
              setDraft(null);
              toast({
                title: text.resetDone,
                description: text.resetDoneDetail,
                variant: 'success',
              });
              return next;
            },
            text.resetFailed,
          );
        }}
      />

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={text.restoreLatestTitle}
        description={
          state.latestBackup
            ? copy.restoreLatestDescription(copy.backupKinds[state.latestBackup.kind])
            : text.noBackupDetail
        }
        confirmText={text.confirmRestore}
        cancelText={text.cancel}
        waitForConfirm
        onConfirm={async () => {
          setBusy('restore');
          try {
            // A refused restore is a VALUE, not a rejection: it still carries
            // the current state, so the page takes it either way and only the
            // message differs.
            const result = await restoreLatestMemoryBackup(props.host);
            memory.apply(result.state);
            setDraft(null);
            if (result.ok) {
              toast({
                title: text.restoredLatest,
                description: text.restoredDetail,
                variant: 'success',
              });
            } else {
              toast({
                title: text.restoreLatestFailed,
                description: result.message,
                variant: 'destructive',
              });
            }
          } catch (error) {
            report(text.restoreLatestFailed, error);
          } finally {
            setBusy(null);
          }
        }}
      />
    </>
  );
}
