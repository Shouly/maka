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

// Who is signed in, at the foot of the rail: the person's initials and name,
// a nav row in shape, that opens a small menu — name and email, the
// way to Settings › Account, and Sign out. It is there only while a company
// account is signed in; signed out, the rail says nothing about accounts (a
// deployment that requires one shows the login screen instead of the rail).

import { useUiLocale } from '@maka/ui';
import { useStore } from 'zustand';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { UserAvatar } from '../../ui/user-avatar.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { cn } from '../../../lib/cn.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import type { OrgAccountState } from '../../../bridge/org-account.js';
import type { OrgAccountAction } from '../../../store/org-account-store.js';
import { orgAccountStore } from '../../../store/index.js';
import { getOrgAccountCopy } from '../../../locales/org-account-copy.js';
import { sidebarNavButtonClass } from './SidebarNavButton.js';

export function SidebarAccountEntry(props: { onOpenAccount: () => void }) {
  const copy = getOrgAccountCopy(useUiLocale());
  const report = useSettingsErrorReporter();
  const account = useStore(orgAccountStore, (state) => state.account);
  const pending = useStore(orgAccountStore, (state) => state.pending);
  return (
    <SidebarAccountMenu
      account={account}
      pending={pending}
      onOpenAccount={props.onOpenAccount}
      onSignOut={() =>
        void orgAccountStore
          .signOut()
          .catch((error: unknown) => report(copy.errors.signOutFailed, error))
      }
    />
  );
}

/** The entry without the store: nothing unless `account` is signed in. */
export function SidebarAccountMenu(props: {
  account: OrgAccountState | undefined;
  pending: OrgAccountAction | null;
  onOpenAccount: () => void;
  onSignOut: () => void;
}) {
  const copy = getOrgAccountCopy(useUiLocale());
  const { account } = props;
  if (account?.status !== 'signed_in') return null;

  const { profile } = account;
  const name = profile.name || profile.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={copy.menu.label(name)}
          data-maka-contract="sidebar-account"
          className={cn(
            sidebarNavButtonClass,
            'data-[state=open]:bg-sidebar-hover data-[state=open]:text-sidebar-text-primary',
          )}
        >
          <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center">
            <UserAvatar user={{ full_name: profile.name, email: profile.email }} size={20} />
          </div>
          <span className="min-w-0 flex-1 truncate text-left text-[0.8125rem] leading-5">
            {name}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent variant="sidebar" side="top" align="start" className="w-64">
        <DropdownMenuLabel className="flex-col items-start gap-0.5">
          <span className="w-full truncate">{name}</span>
          <span className="w-full truncate text-[0.8125rem] leading-[1.125rem] text-menu-text-muted">
            {profile.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onOpenAccount}>
          <Anthropicon name="user" size={20} />
          <span className="flex-1">{copy.menu.accountSettings}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={props.pending !== null} onSelect={props.onSignOut}>
          <Anthropicon name="logout" size={20} />
          <span className="flex-1">{copy.signOut}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
