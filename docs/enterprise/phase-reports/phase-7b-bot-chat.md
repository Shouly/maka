<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# Phase 7b — Settings › Remote access (bot chats)

Closes the "Bot chats" row of the release checklist (2026-09-13): the nine
`settings.bots.*` / `testBotChannel` methods now have a page, and the
scheduled-task form's "deliver to a bot" option has somewhere to configure
the channel it names.

## What landed

- `bridge/bots.ts` — status list and push channel, the credential probe,
  restart, the WeChat bridge QR, and the four onboarding calls.
- `store/bots-store.ts` — the bridges' live status (read once, patched per
  platform from the push channel, failure kept beside the last snapshot)
  and the one-at-a-time action gate the overview and detail share.
- `lib/bot-channel-view.ts` — the pure verdict a row is drawn from
  (`deriveBotChannelViewState`: readiness, in use, needs attention, current
  error, live), the per-platform support table, and the reason / connection
  / summary copy helpers. Ported from upstream's view model and shared file.
- `components/settings/bots/` —
  `BotChatSettings` (page: overview ⇄ detail, test / test-and-connect /
  restart / WeChat sign-out lifecycles, fixture auto-open),
  `BotChatOverview` (in use, worst first; then the catalog),
  `BotChannelDetail` (enable switch with its lock reason, runtime readout and
  actions, quick / manual setup, per-platform credential table, allow-list,
  WeChat token + folded advanced block), `BotOnboardingDialog` (scan-to-connect
  with polling and QR cache), `WechatQrDialog`, `bot-shared` (brand tile,
  readiness chip).
- Nav: `bot-chat` leaves `DEFERRED_SETTINGS_SECTIONS` and joins the
  capabilities group after Web search. `SettingsView` routes it.
- Copy: `locales/settings-bot-copy.ts` was already ported in full; nothing
  added.

Departures from upstream, on purpose: credential fields commit on blur or
Enter rather than per keystroke (each commit is an IPC settings write and a
re-read of every channel); the readout is `SettingsRow`s rather than a
metadata grid; the QR dialogs are our Radix dialog.

## Verification

- Renderer tsc, biome, `check:architecture` (ledger regenerated), ASF
  headers, locale hygiene, knip.
- `test:renderer-state`: 294 pass, five new in `bots-settings.test.tsx`
  (view-model verdicts, the switch lock, the status store, the overview
  partition and sort, the detail page's quick vs manual poses). The phase 5
  nav tests and the electron smoke's nav list were updated for the new row.
- Fixture captures (`settings-bots-onboarding`, light and dark):
  `.maka-shots/enterprise/phase7b-bots-*.png` — scan dialog in its waiting
  state, DingTalk detail in quick and manual mode, the overview, Telegram's
  manual form.

## Owed

- A real scan. The desktop boot installs the fixture onboarding adapters only
  under `settings-bots-onboarding`, and that variant holds the session in
  `waiting` by design; every other scenario talks to the real platform.
  Driving the onboarding IPC directly from the page confirmed the dialog
  mirrors main exactly (start → waiting, polls → waiting), so the remaining
  check is a real DingTalk / Feishu / WeCom scan: confirm → credentials saved
  → channel under "In use" → enable → a message answered.
- Test-and-connect against a real Telegram token; WeChat bridge QR sign-in
  against a running `wechat-bridge`.
