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

// Account › Profile: the avatar, the full name, what the
// assistant calls you, and the personal preferences it weighs when it answers.
// All of it is the company account's, kept on its server, so it follows the
// person to every device; a change reaches new conversations only (a session
// keeps the snapshot it was created with).

import { useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { AccountAvatar } from '../../ui/account-avatar.js';
import { CommittedInput, DraftTextarea } from '../settings-fields.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { orgAccountStore } from '../../../store/index.js';
import { toast } from '../../../store/toast-store.js';
import { getSettingsPreferencesCopy } from '../../../locales/settings-preferences-copy.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import type { OrgAccountProfileUpdate } from '../../../bridge/org-account.js';

const PREFERENCES_ID = 'settings-profile-preferences';
const AVATAR_SIZE = 40;
// The company server's own limits (`PROFILE_NAME_MAX_LENGTH`,
// `NICKNAME_MAX_LENGTH`, `PREFERENCES_MAX_LENGTH` in the platform protocol).
const FULL_NAME_MAX_LENGTH = 80;
const NICKNAME_MAX_LENGTH = 60;
const PREFERENCES_MAX_LENGTH = 2000;

export function ProfileSection() {
  const locale = useUiLocale();
  const preferences = getSettingsPreferencesCopy(locale);
  const copy = preferences.personalization;
  const shared = getSettingsSharedCopy(locale);
  const report = useSettingsErrorReporter();
  // Without a signed-in account there is nothing to change any of it on.
  const account = useStore(orgAccountStore, (state) => state.account);
  const profile = account?.status === 'signed_in' ? account.profile : undefined;
  const save = (update: OrgAccountProfileUpdate, failure: string) =>
    orgAccountStore.updateProfile(update).catch((error: unknown) => report(failure, error));
  const [avatarBusy, setAvatarBusy] = useState(false);
  const setAvatarSeed = (avatarSeed: string | null) => {
    setAvatarBusy(true);
    void save({ avatarSeed }, copy.avatarFailed).finally(() => setAvatarBusy(false));
  };

  return (
    <SettingsSection title={preferences.sections.profile}>
      <SettingsRow
        title={copy.avatar}
        description={profile ? undefined : copy.signInToEdit}
        control={
          profile ? (
            // relx-copilot's avatar control: at rest only the avatar; on hover
            // it blurs under a refresh glyph, and a picked avatar grows an 18px
            // reset at its top-left corner.
            <div className="group/avatar relative w-fit">
              <button
                type="button"
                onClick={() => setAvatarSeed(crypto.randomUUID())}
                disabled={avatarBusy}
                aria-label={copy.avatarRandomize}
                title={copy.avatarRandomize}
                className="relative block cursor-pointer overflow-hidden rounded-full outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-not-allowed"
              >
                <span className="block transition duration-200 group-hover/avatar:scale-[1.15] group-hover/avatar:opacity-40 group-hover/avatar:blur-[3px]">
                  <AccountAvatar profile={profile} size={AVATAR_SIZE} />
                </span>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover/avatar:opacity-100">
                  <Anthropicon
                    name="arrowCounterClockwise"
                    size={16}
                    className="text-text-secondary"
                  />
                </span>
              </button>
              {profile.avatarSeed && (
                <div className="absolute -left-1.5 -top-1.5 opacity-0 transition-opacity duration-200 group-hover/avatar:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => setAvatarSeed(null)}
                    disabled={avatarBusy}
                    aria-label={copy.avatarReset}
                    title={copy.avatarReset}
                    className="flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-surface-3 shadow-[0_0_0_1px_var(--alpha-2)] outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-not-allowed"
                  >
                    <Anthropicon name="x" size={12} className="text-text-secondary" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <span aria-hidden="true" className="size-10 rounded-full bg-alpha-2" />
          )
        }
      />
      <SettingsRow
        title={copy.fullName}
        control={
          <CommittedInput
            label={copy.fullName}
            value={profile?.name ?? ''}
            disabled={!profile}
            maxLength={FULL_NAME_MAX_LENGTH}
            onCommit={(name) => void save({ name }, copy.fullNameFailed)}
          />
        }
      />
      <SettingsRow
        title={copy.nickname}
        control={
          <CommittedInput
            label={copy.nickname}
            placeholder={copy.nicknamePlaceholder}
            value={profile?.nickname ?? ''}
            disabled={!profile}
            maxLength={NICKNAME_MAX_LENGTH}
            onCommit={(nickname) => void save({ nickname }, copy.nicknameFailed)}
          />
        }
      />
      <SettingsRow
        layout="stacked"
        title={copy.preferences}
        description={copy.preferencesHelp}
        htmlFor={PREFERENCES_ID}
      >
        <DraftTextarea
          id={PREFERENCES_ID}
          label={copy.preferences}
          placeholder={copy.preferencesPlaceholder}
          value={profile?.preferences ?? ''}
          disabled={!profile}
          maxLength={PREFERENCES_MAX_LENGTH}
          saveLabel={shared.saveChanges}
          discardLabel={shared.discard}
          onSave={(value) =>
            orgAccountStore.updateProfile({ preferences: value }).then(
              () => {
                toast({ title: copy.preferencesSaved, variant: 'success' });
              },
              (error: unknown) => {
                report(copy.preferencesFailed, error);
                throw error;
              },
            )
          }
        />
      </SettingsRow>
    </SettingsSection>
  );
}
