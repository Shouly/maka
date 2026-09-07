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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UI_LOCALES } from '@maka/core/ui-locale';
import { botStatusReasonMessage, getBotSettingsCopy } from '../../renderer/locales/settings-bot-copy.js';

// TODO(phase-5): the page-level half of this suite bundled
// `renderer/settings/health-center-page.tsx` and asserted that
// `localizedSignalDetail` resolves bot capability reasons through the copy
// table (and passes non-bot reasons through unchanged). The page went with the
// Astryx renderer in the enterprise rewrite (Phase 0a); Phase 5a rebuilds it
// and restores those two cases. What survives here is the catalog contract the
// page depends on, which is where the regression actually lived.

// Producers emit machine codes; every renderer surface must resolve them
// through the bot copy table. A raw code such as `gateway-closed-4004` must
// never survive to the page in any locale (P2: Permission Center regression).
const BOT_REASONS = ['gateway-closed-4004', 'stream-failed', 'connections-open-503', 'rate-limited'] as const;

test('bot capability reasons resolve to localized sentences for every locale', () => {
  for (const reason of BOT_REASONS) {
    for (const locale of UI_LOCALES) {
      const rendered = botStatusReasonMessage(reason, locale);
      assert.ok(rendered, `${locale}: ${reason} must render copy`);
      assert.notEqual(rendered, reason, `${locale}: ${reason} must not render raw`);
      assert.notEqual(rendered, getBotSettingsCopy(locale).status.detailsInLogs, `${locale}: ${reason} must localize, not fall back to detailsInLogs`);
    }
  }
});

test('unknown bot reasons degrade to the localized generic line, never the raw code', () => {
  for (const locale of UI_LOCALES) {
    assert.equal(botStatusReasonMessage('future-code', locale), getBotSettingsCopy(locale).status.detailsInLogs);
  }
});
