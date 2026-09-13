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

// Settings › Remote access, the list: the platforms already in use, worst
// first, then the catalog of platforms that can still be connected. Pure —
// the page owns status and routing; each row is derived during render.

import { RelativeTime, useUiLocale } from '@maka/ui';
import {
  BOT_PROVIDERS,
  type BotChannelSettings,
  type BotProvider,
} from '@maka/core/bot-chat-settings';
import type { BotStatus } from '@maka/runtime/bots';
import { cn } from '../../../lib/cn.js';
import {
  BOT_SUPPORT,
  botOverviewSummary,
  botReadinessCopy,
  deriveBotChannelViewState,
} from '../../../lib/bot-channel-view.js';
import { getBotSettingsCopy } from '../../../locales/settings-bot-copy.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { NoticeCard } from '../../session/notices/NoticeCard.js';
import { SettingsSection } from '../settings-row.js';
import { BotBrandTile, ReadinessChip } from './bot-shared.js';

export function BotChatOverview(props: {
  channels: Record<BotProvider, BotChannelSettings>;
  statuses: Record<BotProvider, BotStatus> | undefined;
  statusLoadError: string | undefined;
  onOpenChannel(provider: BotProvider): void;
  onRefreshStatuses(): void;
}) {
  const locale = useUiLocale();
  const botCopy = getBotSettingsCopy(locale);
  const copy = botCopy.overview;
  const rows = BOT_PROVIDERS.map((provider, index) => {
    const channel = props.channels[provider];
    const status = props.statuses?.[provider];
    const support = BOT_SUPPORT[provider];
    const view = deriveBotChannelViewState({ channel, status });
    const readiness = botReadinessCopy(support, view.readiness, locale);
    return { provider, index, status, support, view, readiness };
  });
  const active = rows
    .filter((row) => row.view.configured)
    .sort((left, right) => {
      if (left.view.needsAttention !== right.view.needsAttention)
        return left.view.needsAttention ? -1 : 1;
      const activity = (right.status?.lastEventAt ?? 0) - (left.status?.lastEventAt ?? 0);
      return activity || left.index - right.index;
    });
  const available = rows.filter((row) => !row.view.configured);

  return (
    <div data-maka-contract="bot-chat-overview">
      {props.statusLoadError && (
        <div className="mb-6">
          <NoticeCard
            tone="destructive"
            title={copy.loadFailed}
            description={props.statusLoadError}
            actions={[{ label: copy.reload, onClick: props.onRefreshStatuses }]}
          />
        </div>
      )}
      <SettingsSection id="settings-bots-active" title={copy.active} description={copy.sortHint}>
        {active.length === 0 ? (
          <p className="py-3 text-sm leading-5 text-text-muted">{copy.empty}</p>
        ) : (
          active.map((row) => {
            const summary = botOverviewSummary({
              status: row.status,
              view: row.view,
              fallback: row.readiness.detail,
              locale,
            });
            return (
              <ChannelRow
                key={row.provider}
                provider={row.provider}
                ariaLabel={copy.manageAria(
                  botCopy.providers[row.provider].label,
                  row.readiness.label,
                )}
                attention={row.view.needsAttention}
                chip={<ReadinessChip tone={row.readiness.tone} label={row.readiness.label} />}
                onClick={() => props.onOpenChannel(row.provider)}
              >
                {summary.text}
                {summary.lastEventAt ? (
                  <>
                    {' · '}
                    <RelativeTime ts={summary.lastEventAt} />
                  </>
                ) : null}
              </ChannelRow>
            );
          })
        )}
      </SettingsSection>
      <SettingsSection id="settings-bots-available" title={copy.more} description={copy.choose}>
        {available.map((row) => (
          <ChannelRow
            key={row.provider}
            provider={row.provider}
            ariaLabel={copy.connectAria(botCopy.providers[row.provider].label)}
            attention={false}
            onClick={() => props.onOpenChannel(row.provider)}
          >
            {botCopy.providers[row.provider].help}
          </ChannelRow>
        ))}
      </SettingsSection>
    </div>
  );
}

function ChannelRow(props: {
  provider: BotProvider;
  ariaLabel: string;
  attention: boolean;
  chip?: React.ReactNode;
  children: React.ReactNode;
  onClick(): void;
}) {
  const label = getBotSettingsCopy(useUiLocale()).providers[props.provider].label;
  return (
    <button
      type="button"
      data-provider={props.provider}
      data-attention={props.attention ? 'true' : undefined}
      aria-label={props.ariaLabel}
      onClick={props.onClick}
      className={cn(
        'flex w-full items-center gap-3 py-3 text-left outline-none',
        'rounded-lg focus-visible:shadow-[var(--sidebar-focus-shadow)]',
      )}
    >
      <BotBrandTile provider={props.provider} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-sm leading-5 text-text-primary">
          <span className="truncate">{label}</span>
          {props.chip}
        </span>
        <span
          className={cn(
            'truncate text-[0.8125rem] leading-[1.125rem]',
            props.attention ? 'text-danger' : 'text-text-secondary',
          )}
        >
          {props.children}
        </span>
      </span>
      <Anthropicon name="caretRight" size={12} className="shrink-0 text-text-muted" />
    </button>
  );
}
