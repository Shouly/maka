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

// Settings › Account: the company account's details page.
//
// The account belongs to the app, not to a Runtime Host — the main process
// runs the browser sign-in and keeps the refresh token — so the page takes no
// `host`. It reads `orgAccountStore`, the one the login gate started, so a
// sign-in begun here and the gate's screen are the same sign-in.
//
// Where the deployment names the server (`enforced`) the address is shown,
// never edited; elsewhere (development) it stays a field. Signing in is the
// same per-provider choice the login screen offers (`signInOptions`).
//
// `AccountSettingsView` is the page without the store, so each state can be
// rendered from a plain value.

import { useState } from 'react';
import { useStore } from 'zustand';
import { formatAbsoluteTimestamp } from '@maka/core/relative-time';
import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Skeleton } from '../../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import type {
  OrgAccountSetServerResult,
  OrgAccountState,
  OrgIdentityProvider,
} from '../../../bridge/org-account.js';
import {
  signingInProvider,
  signInOptions,
  signInOutcomeTone,
} from '../../../lib/org-account-view.js';
import type { OrgAccountAction } from '../../../store/org-account-store.js';
import { orgAccountStore } from '../../../store/index.js';
import { getOrgAccountCopy, orgAccountErrorMessage } from '../../../locales/org-account-copy.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';

export function AccountSettings() {
  const copy = getOrgAccountCopy(useUiLocale());
  const report = useSettingsErrorReporter();
  const account = useStore(orgAccountStore, (state) => state.account);
  const knownProviders = useStore(orgAccountStore, (state) => state.knownProviders);
  const pending = useStore(orgAccountStore, (state) => state.pending);

  const reportFailure = (title: string) => (error: unknown) => report(title, error);
  // Settings lives in the shell, which the gate mounts only once the account is known.
  if (account === undefined) return null;

  return (
    <AccountSettingsView
      account={account}
      knownProviders={knownProviders}
      pending={pending}
      onSaveServer={(url) =>
        orgAccountStore.setServerUrl(url).catch((error: unknown) => {
          report(copy.errors.saveFailed, error);
          return undefined;
        })
      }
      onSignIn={(provider) =>
        void orgAccountStore.signIn(provider).catch(reportFailure(copy.errors.signInFailed))
      }
      onCancelSignIn={() =>
        void orgAccountStore.cancelSignIn().catch(reportFailure(copy.errors.cancelFailed))
      }
      onRefresh={() =>
        void orgAccountStore.refresh().catch(reportFailure(copy.errors.refreshFailed))
      }
      onSignOut={() =>
        void orgAccountStore.signOut().catch(reportFailure(copy.errors.signOutFailed))
      }
    />
  );
}

export function AccountSettingsView(props: {
  account: OrgAccountState;
  knownProviders: readonly OrgIdentityProvider[];
  pending: OrgAccountAction | null;
  onSaveServer: (url: string) => Promise<OrgAccountSetServerResult | undefined>;
  onSignIn: (provider?: string) => void;
  onCancelSignIn: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const locale = useUiLocale();
  const copy = getOrgAccountCopy(locale);
  const text = copy.settings;
  const { account, pending } = props;

  const managedHelp = account.enforced ? text.serverManagedHelp : undefined;

  if (account.status === 'signed_in') {
    const { profile } = account;
    return (
      <SettingsSection title={text.title} description={text.description}>
        <SettingsRow
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{profile.name || profile.email}</span>
              {profile.orgRole === 'org_admin' && (
                <span className={`${statusChipClass} ${statusChipToneClass('neutral')}`}>
                  {copy.admin}
                </span>
              )}
            </span>
          }
          description={profile.email}
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={pending !== null}
              onClick={props.onSignOut}
            >
              {pending === 'signOut' ? copy.signingOut : copy.signOut}
            </Button>
          }
        />
        <SettingsRow
          title={text.signedInUntil(formatAbsoluteTimestamp(account.signInExpiresAt, locale))}
          description={account.remembered ? undefined : text.notRemembered}
        />
        <ServerAddressReadOnlyRow
          serverUrl={account.serverUrl}
          help={managedHelp ?? text.serverLockedHelp}
        />
      </SettingsSection>
    );
  }

  if (account.status === 'signing_in') {
    const provider = signingInProvider(account, props.knownProviders);
    return (
      <SettingsSection title={text.title} description={text.description}>
        <ServerAddressReadOnlyRow serverUrl={account.serverUrl} help={managedHelp} />
        <SettingsRow
          title={provider ? copy.finishInBrowserWith(provider.displayName) : copy.finishInBrowser}
          description={copy.finishInBrowserHelp}
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={pending === 'cancel'}
              onClick={props.onCancelSignIn}
            >
              {copy.cancel}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={text.title} description={text.description}>
      {account.enforced && account.serverUrl !== null ? (
        <ServerAddressReadOnlyRow serverUrl={account.serverUrl} help={managedHelp} />
      ) : (
        <ServerAddressRow serverUrl={account.serverUrl} onSave={props.onSaveServer} />
      )}
      <SignInRow
        account={account}
        pending={pending}
        onSignIn={props.onSignIn}
        onRefresh={props.onRefresh}
      />
    </SettingsSection>
  );
}

/** "Not signed in", and the way in: one button per provider, or why there is none yet. */
function SignInRow(props: {
  account: Extract<OrgAccountState, { status: 'signed_out' }>;
  pending: OrgAccountAction | null;
  onSignIn: (provider?: string) => void;
  onRefresh: () => void;
}) {
  const copy = getOrgAccountCopy(useUiLocale());
  const text = copy.settings;
  const options = signInOptions(props.account);
  const busy = props.pending !== null;

  if (options.kind === 'no_server') {
    return (
      <SettingsRow
        title={text.signedOut}
        description={text.needsServer}
        control={
          <Button size="sm" disabled>
            {copy.signIn}
          </Button>
        }
      />
    );
  }

  if (options.kind === 'loading') {
    return (
      <SettingsRow
        title={text.signedOut}
        description={copy.loadingOptions}
        control={<Skeleton className="h-8 w-40 rounded-lg" />}
      />
    );
  }

  if (options.kind === 'retry') {
    return (
      <SettingsRow
        title={text.signedOut}
        description={
          <span role="alert" className="text-danger">
            {orgAccountErrorMessage(options.error, copy)}
          </span>
        }
        control={
          <Button variant="secondary" size="sm" disabled={busy} onClick={props.onRefresh}>
            {copy.tryAgain}
          </Button>
        }
      />
    );
  }

  const description =
    options.error === undefined ? (
      text.signInHelp
    ) : signInOutcomeTone(options.error) === 'note' ? (
      <span role="status">{orgAccountErrorMessage(options.error, copy)}</span>
    ) : (
      <span role="alert" className="text-danger">
        {orgAccountErrorMessage(options.error, copy)}
      </span>
    );

  if (options.providers.length === 0) {
    return (
      <SettingsRow
        title={text.signedOut}
        description={description}
        control={
          <Button size="sm" disabled={busy} onClick={() => props.onSignIn()}>
            {copy.signIn}
          </Button>
        }
      />
    );
  }

  return (
    <SettingsRow title={text.signedOut} description={description} layout="stacked">
      <div className="flex flex-wrap items-center gap-2">
        {options.providers.map((provider) => (
          <Button
            key={provider.id}
            variant="secondary"
            size="sm"
            data-provider={provider.id}
            disabled={busy}
            onClick={() => props.onSignIn(provider.id)}
          >
            {copy.continueWith(provider.displayName)}
          </Button>
        ))}
      </div>
    </SettingsRow>
  );
}

/** The address, editable: only while signed out, and only where the build does not name it. */
function ServerAddressRow(props: {
  serverUrl: string | null;
  onSave: (url: string) => Promise<OrgAccountSetServerResult | undefined>;
}) {
  const locale = useUiLocale();
  const text = getOrgAccountCopy(locale).settings;
  const shared = getSettingsSharedCopy(locale);
  // `null` means "no local edits": the field follows the stored address, so
  // a save lands as the address the main process normalized it to.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<'invalid_url' | 'signed_in' | 'managed' | null>(null);
  const next = draft?.trim() ?? '';
  const dirty = next.length > 0 && next !== props.serverUrl;

  const save = () => {
    if (!dirty || saving) return;
    setSaving(true);
    void props
      .onSave(next)
      .then((result) => {
        if (result === undefined) return;
        if (result.ok) {
          setDraft(null);
          setRejection(null);
        } else {
          setRejection(result.reason);
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <SettingsRow
      title={text.server}
      description={text.serverHelp}
      htmlFor="org-account-server-url"
      layout="stacked"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="org-account-server-url"
          className="w-72 font-mono"
          placeholder={text.serverPlaceholder}
          value={draft ?? props.serverUrl ?? ''}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={rejection !== null ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setRejection(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
            event.preventDefault();
            save();
          }}
        />
        <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? text.saving : shared.save}
        </Button>
      </div>
      {rejection && (
        <p role="alert" className="text-[0.8125rem] leading-[1.125rem] text-danger">
          {text.serverRejections[rejection]}
        </p>
      )}
    </SettingsRow>
  );
}

/** The address while it cannot change: signed in, signing in, or named by the build. */
function ServerAddressReadOnlyRow(props: { serverUrl: string; help: string | undefined }) {
  const text = getOrgAccountCopy(useUiLocale()).settings;
  return (
    <SettingsRow
      title={text.server}
      description={
        <span className="flex flex-col gap-0.5">
          <span className="break-all font-mono">{props.serverUrl}</span>
          {props.help && <span>{props.help}</span>}
        </span>
      }
    />
  );
}
