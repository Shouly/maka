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

import { app, Notification } from 'electron';
import type { AppSettings } from '@maka/core/settings';
import type { createMainWindowController } from './main-window.js';
import type { DesktopLocaleAuthority } from './desktop-locale-authority.js';
import {
  deduplicateRunNotifications,
  resolveNotificationContent,
  shouldRaiseRunNotification,
  type RunNotificationEvent,
} from './notifications-policy.js';

type MainWindowController = ReturnType<typeof createMainWindowController>;

interface NotificationsDeps {
  settingsStore: { get(): Promise<AppSettings> };
  locale: Pick<DesktopLocaleAuthority, 'observe'>;
  mainWindowController: MainWindowController;
  e2e: boolean;
}

/**
 * Turns a Runtime Host's "this Session finished, failed or waits on the
 * user" into a native OS notification and a Dock bounce. Every connected
 * Host feeds it, whichever conversation the window shows. The gating
 * (product toggle + platform support + window focus) lives here in the
 * main process, which is the only place that authoritatively knows whether
 * the window is focused and can raise/focus it on click.
 */
export function createRunNotifier(
  deps: NotificationsDeps,
): (input: RunNotificationEvent) => Promise<void> {
  return deduplicateRunNotifications(async (input) => {
    const supported = Notification.isSupported();
    // Read the toggle lazily so a mid-session settings change takes
    // effect on the very next turn without any cache invalidation.
    const settings = await deps.settingsStore.get();
    const gate = {
      enabled: settings.notifications.runComplete,
      supported,
      windowFocused: deps.mainWindowController.isFocused(),
      e2e: deps.e2e,
    };
    if (!shouldRaiseRunNotification(gate)) return;

    const copy = resolveNotificationContent(input, deps.locale.observe(settings));
    const notification = new Notification({ title: copy.title, body: copy.body });
    // Clicking the banner should pull the (unfocused/minimized) window
    // back to the foreground — `focus()` already restores + shows.
    notification.on('click', () => deps.mainWindowController.focus());
    notification.show();
    app.dock?.bounce('informational');
  });
}
