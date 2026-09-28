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

// Who is signed in, at the foot of the rail: the person's avatar and name
// with a caret after it, as wide as those need, that opens the account menu —
// the email, then Settings, Usage and Language, About, and Log out. Settings
// has no row of its own while someone is signed in; this menu is how it is
// reached. A deployment bound to a
// company server never shows the rail signed out (the login screen stands in
// for the whole app), so `fallback` — the plain Settings row — is only ever
// seen in builds that run without one (development, e2e).

import { useState, type ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import { useStore } from 'zustand';
import type { SettingsSection } from '@maka/core/settings';
import type { UiLocalePreference } from '@maka/core/ui-locale';
import { Anthropicon, type AnthropiconName } from '../../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { AccountAvatar } from '../../ui/account-avatar.js';
import { isApplePlatform } from '../../../hooks/use-hotkeys.js';
import { useClientSettings, useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { useScopedRuntimeHost } from '../../../hooks/use-workspace.js';
import type { OrgAccountState } from '../../../bridge/org-account.js';
import type { OrgAccountAction } from '../../../store/org-account-store.js';
import { orgAccountStore, settingsStore } from '../../../store/index.js';
import { getOrgAccountCopy } from '../../../locales/org-account-copy.js';
import { getSettingsPreferencesCopy } from '../../../locales/settings-preferences-copy.js';
import { LanguageDialog } from './LanguageDialog.js';

export function SidebarAccountEntry(props: {
  onOpenSettings: (section?: SettingsSection) => void;
  /** What the foot of the rail shows when nobody is signed in. */
  fallback: ReactNode;
}) {
  const locale = useUiLocale();
  const copy = getOrgAccountCopy(locale);
  const report = useSettingsErrorReporter();
  const host = useScopedRuntimeHost();
  const client = useClientSettings();
  const account = useStore(orgAccountStore, (state) => state.account);
  const pending = useStore(orgAccountStore, (state) => state.pending);
  if (account?.status !== 'signed_in') return <>{props.fallback}</>;
  return (
    <SidebarAccountMenu
      account={account}
      pending={pending}
      uiLocale={client.data?.personalization.uiLocale}
      onOpenSettings={props.onOpenSettings}
      onChooseLanguage={(uiLocale) =>
        void settingsStore
          .update({ personalization: { uiLocale } }, host)
          .catch((error: unknown) =>
            report(getSettingsPreferencesCopy(locale).personalization.saveFailed, error),
          )
      }
      onSignOut={() =>
        void orgAccountStore
          .signOut()
          .catch((error: unknown) => report(copy.errors.signOutFailed, error))
      }
    />
  );
}

/** The entry without the stores: nothing unless `account` is signed in. */
export function SidebarAccountMenu(props: {
  account: OrgAccountState | undefined;
  pending: OrgAccountAction | null;
  /** The saved language choice; undefined until the settings snapshot arrives. */
  uiLocale: UiLocalePreference | undefined;
  onOpenSettings: (section?: SettingsSection) => void;
  onChooseLanguage: (uiLocale: UiLocalePreference) => void;
  onSignOut: () => void;
}) {
  const copy = getOrgAccountCopy(useUiLocale());
  const [languageOpen, setLanguageOpen] = useState(false);
  const { account } = props;
  if (account?.status !== 'signed_in') return null;

  const { profile } = account;
  // What they asked to be called; else their full name.
  const name = profile.nickname || profile.name || profile.email;
  const item = (
    icon: AnthropiconName,
    label: string,
    onSelect: () => void,
    trailing?: ReactNode,
  ) => (
    <DropdownMenuItem onSelect={onSelect}>
      <DropdownMenuItemIcon>
        <Anthropicon name={icon} size={20} />
      </DropdownMenuItemIcon>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={copy.menu.label(name)}
            data-maka-contract="sidebar-account"
            // As wide as what it holds, never wider than the rail.
            className="flex h-8 max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg pr-2 pl-0.5 text-left outline-none transition-colors hover:bg-sidebar-hover focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          >
            <span className="flex w-7 shrink-0 items-center justify-center">
              <AccountAvatar profile={profile} size={24} />
            </span>
            <span className="min-w-0 truncate pr-3 text-sm leading-[21px] text-sidebar-text-secondary">
              {name}
            </span>
            <Anthropicon name="caretDown" size={12} className="shrink-0 text-sidebar-text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent variant="sidebar" side="top" align="start" className="w-68">
          <DropdownMenuLabel className="min-h-0 px-2.5 py-1 text-[0.8125rem] leading-[17px] font-medium text-menu-text-muted">
            <span className="min-w-0 truncate">{profile.email}</span>
          </DropdownMenuLabel>
          {item(
            'settings',
            copy.menu.settings,
            () => props.onOpenSettings(),
            <DropdownMenuShortcut className="inline-flex items-baseline gap-[0.3em]">
              {(isApplePlatform() ? ['⌘', ','] : ['Ctrl', ',']).map((key) => (
                <kbd key={key} className="font-[inherit]">
                  {key}
                </kbd>
              ))}
            </DropdownMenuShortcut>,
          )}
          {item('gauge', copy.menu.usage, () => props.onOpenSettings('usage'))}
          {item('globe', copy.menu.language, () => setLanguageOpen(true))}
          <DropdownMenuSeparator />
          {item('info', copy.menu.about, () => props.onOpenSettings('about'))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={props.pending !== null} onSelect={props.onSignOut}>
            <DropdownMenuItemIcon>
              <Anthropicon name="logout" size={20} />
            </DropdownMenuItemIcon>
            <span className="min-w-0 flex-1 truncate">{copy.menu.logOut}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LanguageDialog
        open={languageOpen}
        onOpenChange={setLanguageOpen}
        value={props.uiLocale}
        onChoose={(uiLocale) => {
          setLanguageOpen(false);
          props.onChooseLanguage(uiLocale);
        }}
      />
    </>
  );
}
