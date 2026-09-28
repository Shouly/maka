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

// The page that owns "how this app looks and behaves for me", laid out as
// Appearance, then Notifications. Who the app is talking to (the name and the
// instructions) is on Account › Profile; the
// defaults a new task starts with are on the pages
// that own them (`host-default-settings.tsx`).
//
// The notification switch is the Desktop client's own setting;
// `settingsStore.update` routes the patch by the same `settings-ownership.ts`
// rule the main process routes by. The Runtime Host's network proxy has no
// row here: an enterprise deployment does not configure one per desktop, so
// the setting stays in the Host and out of the UI.
//
// Every write is a fire-and-forget with a toast on failure. There is no Save
// button and no success toast: a settings page that stays silent when it works
// is how the reference design behaves, and a row that failed has to say so
// because nothing else will.

import { useUiLocale } from '@maka/ui';
import { Switch } from '../ui/switch.js';
import { AppearanceSection } from './AppearanceSettings.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { useClientSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { settingsStore } from '../../store/index.js';
import { getSettingsPreferencesCopy } from '../../locales/settings-preferences-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

export function GeneralSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const preferences = getSettingsPreferencesCopy(useUiLocale());
  const copy = preferences.general;
  const report = useSettingsErrorReporter();
  const client = useClientSettings();

  return (
    <>
      <AppearanceSection />

      <SettingsSection title={preferences.sections.notifications}>
        <SettingsRow
          title={copy.notifications}
          description={copy.notificationsHelp}
          control={
            <Switch
              aria-label={copy.notifications}
              disabled={!client.data}
              checked={client.data?.notifications.runComplete ?? false}
              onCheckedChange={(runComplete) =>
                void settingsStore
                  .update({ notifications: { runComplete } }, props.host)
                  .catch((error: unknown) => report(copy.notificationsFailed, error))
              }
            />
          }
        />
      </SettingsSection>
    </>
  );
}
