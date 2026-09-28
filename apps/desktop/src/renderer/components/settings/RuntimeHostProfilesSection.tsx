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

// The machines this Desktop can run tasks on.
//
// One of them is always this computer and cannot be removed or disabled; the
// rest are remote Runtime Hosts the user registered. Which one is default is a
// single choice for the whole app — every un-scoped read in the renderer
// resolves against it — so it is a selector at the top of the section rather
// than a per-row action that could leave two rows both claiming it.
//
// Removing requires disabling first, and the default cannot be disabled. That
// is not ceremony: a profile that is still enabled may be holding an open
// connection and an in-flight task, and the default has no successor until
// someone names one.
//
// Registering a remote Host is a form, so it opens as a dialog over Settings
// rather than unfolding under the list; removing one is in its row's ⋯ menu.
//
// SCOPE: this form registers a remote Host that is ALREADY RUNNING. The guided
// SSH and WSL setups (`runtimeHostOnboarding`), the service management dialog
// (install / update / credentials / directory roots) and the peer mesh are
// deferred (plan §3), and the UI says so rather than offering a button that
// opens nothing.

import { useCallback, useEffect, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Skeleton } from '../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { Switch } from '../ui/switch.js';
import { cn } from '../../lib/cn.js';
import { RowActionsMenu, SettingsModal, SettingsModalField } from './settings-kit.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import {
  addRuntimeHostProfile,
  getRuntimeHostProfiles,
  removeRuntimeHostProfile,
  setDefaultRuntimeHostProfile,
  setRuntimeHostProfileEnabled,
  subscribeRuntimeHostProfileChanges,
  type DesktopRuntimeHostProfileSnapshot,
} from '../../bridge/runtime-host-profiles.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsProjectsCopy } from '../../locales/settings-projects-copy.js';

type TransportKind = 'tls' | 'plaintext';

interface RemoteDraft {
  id: string;
  name: string;
  transportKind: TransportKind;
  url: string;
  acknowledged: boolean;
  rootId: string;
  credential: string;
}

function createDraft(): RemoteDraft {
  return {
    // The Desktop mints the id; the Host is still the identity allocator for
    // everything that matters (`rootId`), this only names the local profile.
    id: `remote-${crypto.randomUUID()}`,
    name: '',
    transportKind: 'tls',
    url: '',
    acknowledged: false,
    rootId: '',
    credential: '',
  };
}

function draftComplete(draft: RemoteDraft): boolean {
  if (!draft.name.trim() || !draft.rootId.trim() || !draft.credential.trim()) return false;
  if (!draft.url.trim()) return false;
  return draft.transportKind !== 'plaintext' || draft.acknowledged;
}

const READINESS_TONE = {
  disabled: 'neutral',
  connecting: 'active',
  ready: 'success',
  reconnecting: 'attention',
  unavailable: 'error',
} as const;

export function RuntimeHostProfilesSection() {
  const locale = useUiLocale();
  const copy = getSettingsProjectsCopy(locale).runtimeHost;
  const own = getSettingsCopy(locale).workspace;
  const report = useSettingsErrorReporter();
  const [snapshot, setSnapshot] = useState<DesktopRuntimeHostProfileSnapshot | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RemoteDraft>(createDraft);

  const reload = useCallback(() => {
    void getRuntimeHostProfiles()
      .then(setSnapshot)
      .catch((error: unknown) => report(copy.loadFailed, error));
  }, [copy.loadFailed, report]);

  useEffect(() => {
    reload();
    return subscribeRuntimeHostProfileChanges(() => reload());
  }, [reload]);

  const run = (operation: Promise<DesktopRuntimeHostProfileSnapshot>, failure: string) => {
    setBusy(true);
    void operation
      .then(setSnapshot)
      .catch((error: unknown) => report(failure, error))
      .finally(() => setBusy(false));
  };

  const entries = snapshot?.entries ?? [];
  const enabled = entries.filter((entry) => entry.enabled);

  return (
    <SettingsSection
      title={copy.title}
      description={copy.description}
      action={
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setDraft(createDraft());
            setAdding(true);
          }}
        >
          {own.addRemote}
        </Button>
      }
    >
      <SettingsRow
        title={copy.selected}
        description={copy.selectedHelp}
        control={
          snapshot ? (
            <Select
              value={snapshot.defaultProfileId}
              disabled={busy}
              onValueChange={(profileId) =>
                run(setDefaultRuntimeHostProfile(profileId), copy.selectFailed)
              }
            >
              <SelectTrigger aria-label={copy.selected} variant="ghost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {enabled.map((entry) => (
                  <SelectItem key={entry.profile.id} value={entry.profile.id}>
                    {entry.profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Skeleton className="h-8 w-56 rounded-lg" />
          )
        }
      />

      {entries.length === 0 && snapshot !== undefined && (
        <SettingsRow title={copy.empty} control={null} />
      )}

      {entries.map((entry) => {
        const readiness = own.readiness[entry.readiness];
        const local = entry.profile.kind === 'local';
        return (
          <SettingsRow
            key={entry.profile.id}
            title={
              <span className="flex items-center gap-2">
                <span className="truncate">{entry.profile.name}</span>
                {entry.isDefault && (
                  <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                    {copy.defaultBadge}
                  </span>
                )}
                <span
                  className={cn(
                    statusChipClass,
                    statusChipToneClass(READINESS_TONE[entry.readiness]),
                  )}
                >
                  {readiness}
                </span>
              </span>
            }
            description={
              <span className="flex flex-col gap-0.5">
                <span>{own.kinds[entry.profile.kind]}</span>
                {entry.message && <span className="text-text-muted">{entry.message}</span>}
              </span>
            }
            control={
              <span className="flex items-center gap-3">
                <Switch
                  aria-label={own.enableProfile(entry.profile.name)}
                  checked={entry.enabled}
                  // The default has no successor while it is the default, and
                  // this computer is not a profile that can be switched off.
                  disabled={busy || entry.isDefault || local}
                  onCheckedChange={(next) =>
                    run(setRuntimeHostProfileEnabled(entry.profile.id, next), copy.saveFailed)
                  }
                />
                {!local && (
                  <RowActionsMenu
                    label={own.profileActions(entry.profile.name)}
                    actions={[
                      {
                        // Removal needs the Host switched off first: an enabled
                        // one may hold an open connection and a running task.
                        label: own.removeProfile,
                        danger: true,
                        disabled: busy || entry.enabled || entry.isDefault,
                        onSelect: () =>
                          run(removeRuntimeHostProfile(entry.profile.id), copy.removeFailed),
                      },
                    ]}
                  />
                )}
              </span>
            }
          />
        );
      })}

      <SettingsModal
        open={adding}
        onOpenChange={(open) => {
          if (!busy) setAdding(open);
        }}
        title={own.addRemote}
        description={own.addRemoteHelp}
        data-maka-contract="runtime-host-add"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setAdding(false)}>
              {copy.cancel}
            </Button>
            <Button
              disabled={busy || !draftComplete(draft)}
              onClick={() => {
                setBusy(true);
                void addRuntimeHostProfile({
                  profile: {
                    id: draft.id,
                    name: draft.name.trim(),
                    kind: 'remote',
                    rootId: draft.rootId.trim(),
                    transport:
                      draft.transportKind === 'tls'
                        ? { kind: 'tls', url: draft.url.trim() }
                        : {
                            kind: 'plaintext',
                            url: draft.url.trim(),
                            acknowledgement: 'plaintext-bearer-v1',
                          },
                  },
                  credential: draft.credential,
                })
                  .then((result) => {
                    setSnapshot(result.snapshot);
                    // An unreachable Host is still registered; the dialog stays
                    // open so the address can be corrected in place.
                    if (result.kind === 'unavailable')
                      report(copy.selectFailed, new Error(result.message));
                    else {
                      setAdding(false);
                      setDraft(createDraft());
                    }
                  })
                  .catch((error: unknown) => report(copy.saveFailed, error))
                  .finally(() => setBusy(false));
              }}
            >
              {copy.saveAndEnable}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <SettingsModalField label={copy.name} htmlFor="runtime-host-name" hint={copy.nameHelp}>
            <Input
              id="runtime-host-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </SettingsModalField>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium leading-[0.875rem] text-text-primary">
              {copy.transport}
            </span>
            <SegmentedControl
              ariaLabel={copy.transport}
              value={draft.transportKind}
              onChange={(transportKind: TransportKind) => setDraft({ ...draft, transportKind })}
              options={[
                { value: 'tls', label: copy.tls },
                { value: 'plaintext', label: copy.plaintext },
              ]}
            />
            <p className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">
              {copy.transportHelp}
            </p>
          </div>
          <SettingsModalField
            label={draft.transportKind === 'tls' ? copy.url : copy.plaintextUrl}
            htmlFor="runtime-host-url"
            hint={draft.transportKind === 'tls' ? copy.urlHelp : copy.plaintextUrlHelp}
          >
            <Input
              id="runtime-host-url"
              placeholder={
                draft.transportKind === 'tls' ? 'wss://host.example' : 'ws://host.example'
              }
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
          </SettingsModalField>
          {draft.transportKind === 'plaintext' && (
            <div className="flex flex-col gap-3 rounded-xl bg-alpha-1 px-4 py-3 shadow-[inset_0_0_0_1px_var(--alpha-2)]">
              <p className="text-sm leading-5 text-warning" role="status">
                {copy.plaintextWarning}
              </p>
              <label className="flex cursor-pointer items-start justify-between gap-4">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm leading-5 text-text-primary">
                    {copy.plaintextAcknowledgement}
                  </span>
                  <span className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">
                    {copy.plaintextAcknowledgementHelp}
                  </span>
                </span>
                <Switch
                  aria-label={copy.plaintextAcknowledgement}
                  checked={draft.acknowledged}
                  onCheckedChange={(acknowledged) => setDraft({ ...draft, acknowledged })}
                />
              </label>
            </div>
          )}
          <SettingsModalField
            label={copy.rootId}
            htmlFor="runtime-host-root"
            hint={copy.rootIdHelp}
          >
            <Input
              id="runtime-host-root"
              value={draft.rootId}
              onChange={(event) => setDraft({ ...draft, rootId: event.target.value })}
            />
          </SettingsModalField>
          <SettingsModalField
            label={copy.credential}
            htmlFor="runtime-host-credential"
            hint={copy.credentialHelp}
          >
            <Input
              id="runtime-host-credential"
              type="password"
              value={draft.credential}
              onChange={(event) => setDraft({ ...draft, credential: event.target.value })}
            />
          </SettingsModalField>
          <p className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">
            {own.wizardsDeferred}
          </p>
        </div>
      </SettingsModal>
    </SettingsSection>
  );
}
