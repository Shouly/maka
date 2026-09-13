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

// One platform: the enable switch, the bridge's runtime readout with its
// actions, and the credential form — quick scan-to-connect where the
// platform offers it, manual fields everywhere else, WeChat's own token
// plus a folded advanced block.
//
// Pure with respect to the stores: the page owns the action lifecycles and
// status; this component owns only its dialogs and the setup-mode choice.
// Credential fields commit on blur or Enter, not per keystroke — each commit
// is a settings write over IPC and a re-read of every channel.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RelativeTime, useUiLocale, BOT_BRAND } from '@maka/ui';
import {
  BOT_ONBOARDING_PROVIDERS,
  type BotOnboardingBrand,
  type BotOnboardingProvider,
  type BotOnboardingSnapshot,
} from '@maka/core/bot-onboarding';
import type { BotChannelSettings, BotProvider } from '@maka/core/bot-chat-settings';
import { MAX_ALLOWED_USER_IDS, parseAllowedUserIdsFromText } from '@maka/core/settings';
import type { BotStatus } from '@maka/runtime/bots';
import { openExternal } from '../../../bridge/external-links.js';
import { cn } from '../../../lib/cn.js';
import {
  BOT_SUPPORT,
  botConnectionLabel,
  botReadinessCopy,
  botStatusDetail,
  canEnableBotChannel,
  deriveBotChannelViewState,
  type BotPendingActionName,
} from '../../../lib/bot-channel-view.js';
import {
  botStatusReasonMessage,
  getBotSettingsCopy,
  type BotSettingsCopy,
} from '../../../locales/settings-bot-copy.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { SegmentedControl } from '../../ui/segmented-control.js';
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.js';
import { Switch } from '../../ui/switch.js';
import { Textarea } from '../../ui/textarea.js';
import { NoticeCard } from '../../session/notices/NoticeCard.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from '../settings-row.js';
import { BotOnboardingDialog } from './BotOnboardingDialog.js';
import { BotBrandTile, ReadinessChip } from './bot-shared.js';
import { WechatQrDialog } from './WechatQrDialog.js';

function supportsQuickOnboarding(provider: BotProvider): provider is BotOnboardingProvider {
  return (BOT_ONBOARDING_PROVIDERS as readonly string[]).includes(provider);
}

export interface BotChannelDetailProps {
  provider: BotProvider;
  channel: BotChannelSettings;
  status: BotStatus | undefined;
  statusLoadError: string | undefined;
  /** Any action in flight anywhere on the page: every control waits. */
  actionBusy: boolean;
  /** The action in flight for THIS provider, for the button that started it. */
  pendingAction: BotPendingActionName | null;
  /** Under the e2e fixture only: open the scan dialog at mount. */
  autoOpenScan?: boolean;
  onBack(): void;
  onUpdateChannel(patch: Partial<BotChannelSettings>): Promise<boolean>;
  onTest(): void;
  onTestAndConnect(): void;
  onRestart(): void;
  onDisconnectWechat(): void;
  onConnected(snapshot: BotOnboardingSnapshot): Promise<void>;
  onRefreshStatuses(): void;
}

export function BotChannelDetail(props: BotChannelDetailProps) {
  const { provider, channel, status } = props;
  const locale = useUiLocale();
  const botCopy = getBotSettingsCopy(locale);
  const copy = botCopy.detail;
  const presentation = botCopy.providers[provider];
  const [scanOpen, setScanOpen] = useState(props.autoOpenScan === true);
  const [wechatQrOpen, setWechatQrOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<'quick' | 'manual'>('quick');
  const [feishuBrand, setFeishuBrand] = useState<BotOnboardingBrand>(
    channel.domain === 'larksuite.com' ? 'lark' : 'feishu',
  );

  const support = BOT_SUPPORT[provider];
  const view = deriveBotChannelViewState({ channel, status });
  const readiness = botReadinessCopy(support, view.readiness, locale);
  const quickOnboarding = supportsQuickOnboarding(provider);
  const qrOnly = provider === 'wechat';
  const inQuickOnboarding = quickOnboarding && (qrOnly || setupMode === 'quick');

  // Mode resets with the provider; the brand mirrors the stored domain.
  useEffect(() => {
    setSetupMode('quick');
  }, [provider]);
  useEffect(() => {
    if (provider === 'feishu')
      setFeishuBrand(channel.domain === 'larksuite.com' ? 'lark' : 'feishu');
  }, [provider, channel.domain]);

  const switchLocked =
    support === 'planned' || (!channel.enabled && !canEnableBotChannel(view.readiness));
  const switchHint =
    support === 'planned'
      ? copy.unavailableHint
      : !channel.enabled && !canEnableBotChannel(view.readiness)
        ? inQuickOnboarding
          ? copy.scanFirstHint
          : copy.testFirstHint
        : undefined;
  const hintId = `settings-bot-enable-hint-${provider}`;
  const docUrl = BOT_BRAND[provider].configDocUrl;
  const pending = props.pendingAction;

  const actions: ReactNode = inQuickOnboarding ? (
    <>
      <Button size="sm" disabled={props.actionBusy} onClick={() => setScanOpen(true)}>
        {provider === 'wecom'
          ? copy.quickBind
          : provider === 'wechat'
            ? copy.scanLogin
            : copy.scanConnect}
      </Button>
      {provider === 'wechat' && (channel.token || status?.identity) && (
        <Button
          variant="secondary"
          size="sm"
          disabled={props.actionBusy}
          onClick={props.onDisconnectWechat}
        >
          {pending === 'disconnect' ? copy.disconnecting : copy.disconnectWechat}
        </Button>
      )}
      {provider === 'wechat' && (
        <Button
          variant="secondary"
          size="sm"
          disabled={props.actionBusy}
          onClick={() => setWechatQrOpen(true)}
        >
          {copy.bridgeQr}
        </Button>
      )}
      <Button variant="secondary" size="sm" disabled={props.actionBusy} onClick={props.onTest}>
        {pending === 'test' ? copy.testing : copy.test}
      </Button>
    </>
  ) : support === 'runtime' && !status?.running ? (
    <Button size="sm" disabled={props.actionBusy} onClick={props.onTestAndConnect}>
      {pending === 'connect' ? copy.connecting : copy.testAndConnect}
    </Button>
  ) : (
    <Button
      variant="secondary"
      size="sm"
      disabled={props.actionBusy || support === 'planned'}
      onClick={props.onTest}
    >
      {pending === 'test' ? copy.testing : support === 'runtime' ? copy.test : copy.testAndConnect}
    </Button>
  );
  const restarting = pending === 'restart';
  const showRestart =
    support === 'runtime' && (status?.running || restarting) && provider !== 'wechat';

  return (
    <div data-maka-contract="bot-channel-detail" data-provider={provider}>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={props.actionBusy} onClick={props.onBack}>
          <Anthropicon name="arrowLeft" size={16} />
          <span className="ml-1.5">{copy.back}</span>
        </Button>
      </div>

      <header className="mb-8 flex items-start gap-4" data-support={support}>
        <BotBrandTile provider={provider} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-[0.9375rem] font-semibold leading-5 text-text-primary">
            <span className="truncate">{presentation.label}</span>
            <ReadinessChip tone={readiness.tone} label={readiness.label} />
          </h2>
          <p className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">
            {presentation.help}
          </p>
          {switchHint && (
            <small id={hintId} className="text-[0.75rem] leading-4 text-text-muted">
              {switchHint}
            </small>
          )}
          {docUrl && (
            <button
              type="button"
              className="self-start text-[0.8125rem] leading-[1.125rem] text-accent underline-offset-2 hover:underline"
              onClick={() => openExternal(docUrl)}
            >
              {copy.configDocs}
            </button>
          )}
        </div>
        <Switch
          aria-label={copy.enableAria(presentation.label)}
          aria-describedby={switchHint ? hintId : undefined}
          checked={channel.enabled}
          disabled={switchLocked || props.actionBusy}
          onCheckedChange={(enabled) => void props.onUpdateChannel({ enabled })}
        />
      </header>

      <SettingsSection
        id="settings-bot-runtime"
        title={view.liveOperational ? copy.listening : readiness.label}
        description={view.liveOperational ? copy.healthy : readiness.detail}
        action={
          <div
            className="flex flex-wrap items-center justify-end gap-2"
            role="group"
            aria-label={copy.actionsAria(presentation.label)}
          >
            {actions}
            {showRestart && (
              <Button
                variant="secondary"
                size="sm"
                disabled={props.actionBusy}
                onClick={props.onRestart}
              >
                {restarting ? copy.restarting : copy.restart}
              </Button>
            )}
          </div>
        }
      >
        <div role="group" aria-label={copy.runtimeAria(presentation.label)} className="contents">
          <Readout label={copy.identity}>
            {status?.identity?.username ?? status?.identity?.displayName ?? copy.unknownIdentity}
          </Readout>
          <Readout label={copy.connectionType}>
            {botConnectionLabel(status?.connection ?? 'none', locale)}
          </Readout>
          <Readout label={copy.lastEvent}>
            {status?.lastEventAt ? <RelativeTime ts={status.lastEventAt} /> : copy.noneYet}
          </Readout>
          <Readout label={copy.lastTest}>
            {channel.lastTestAt ? <RelativeTime ts={channel.lastTestAt} /> : copy.neverTested}
          </Readout>
        </div>
      </SettingsSection>

      {(props.statusLoadError ||
        (status?.reason && channel.enabled && !view.liveOperational) ||
        (view.currentError && support !== 'planned')) && (
        <div className="mb-10 flex flex-col gap-2">
          {props.statusLoadError && (
            <NoticeCard
              tone="destructive"
              title={copy.statusRefreshFailed}
              description={props.statusLoadError}
            />
          )}
          {status?.reason && channel.enabled && !view.liveOperational && (
            <NoticeCard
              tone="warning"
              title={botStatusDetail(status, locale)}
              description={readiness.detail}
            />
          )}
          {view.currentError && support !== 'planned' && (
            <NoticeCard
              tone="destructive"
              title={copy.latestFailure}
              description={botStatusReasonMessage(view.currentError, locale)}
            />
          )}
        </div>
      )}

      <SettingsSection
        id="settings-bot-setup"
        title={quickOnboarding && !qrOnly ? copy.setupMethod : copy.connectionSettings}
        description={quickOnboarding ? copy.localCredentials : copy.autosave}
      >
        {quickOnboarding && !qrOnly && (
          <div className="py-3">
            <SegmentedControl
              value={setupMode}
              ariaLabel={copy.setupAria(presentation.label)}
              options={[
                { value: 'quick', label: copy.quickRecommended },
                { value: 'manual', label: copy.manual },
              ]}
              onChange={setSetupMode}
            />
          </div>
        )}

        {quickOnboarding && !qrOnly && setupMode === 'quick' && (
          <div
            className="my-3 flex flex-col items-start gap-3 rounded-xl border border-hairline bg-surface-2 p-4"
            role="region"
            aria-label={copy.quickAria(presentation.label)}
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium leading-5 text-text-primary">
                {provider === 'wecom'
                  ? copy.quickWecomTitle
                  : provider === 'qq'
                    ? copy.quickQqTitle
                    : copy.quickTitle}
              </p>
              <p className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                {provider === 'wecom'
                  ? copy.quickWecomDetail
                  : provider === 'qq'
                    ? copy.quickQqDetail
                    : copy.quickDetail}
              </p>
            </div>
            {provider === 'feishu' && (
              <SegmentedControl
                value={feishuBrand}
                ariaLabel={copy.feishuRegionAria}
                options={[
                  { value: 'feishu', label: copy.feishu },
                  { value: 'lark', label: 'Lark' },
                ]}
                onChange={setFeishuBrand}
              />
            )}
            <Button size="sm" disabled={props.actionBusy} onClick={() => setScanOpen(true)}>
              {provider === 'wecom'
                ? copy.beginQuickBind
                : copy.scanWith(
                    provider === 'feishu' && feishuBrand === 'lark' ? 'Lark' : presentation.label,
                  )}
            </Button>
          </div>
        )}

        {(!quickOnboarding || qrOnly || setupMode === 'manual') && (
          <CredentialFields
            provider={provider}
            channel={channel}
            onUpdateChannel={props.onUpdateChannel}
          />
        )}
        {provider === 'wechat' && (
          <WechatFields channel={channel} onUpdateChannel={props.onUpdateChannel} />
        )}
        {support === 'planned' && <NoticeCard tone="info" title={copy.planned} />}
      </SettingsSection>

      {scanOpen && quickOnboarding && (
        <BotOnboardingDialog
          provider={provider}
          {...(provider === 'feishu' ? { brand: feishuBrand } : {})}
          open={scanOpen}
          onOpenChange={setScanOpen}
          onConnected={props.onConnected}
        />
      )}
      {wechatQrOpen && (
        <WechatQrDialog
          open={wechatQrOpen}
          onOpenChange={setWechatQrOpen}
          onLoggedIn={props.onRefreshStatuses}
        />
      )}
    </div>
  );
}

function Readout(props: { label: string; children: ReactNode }) {
  return (
    <SettingsRow
      title={props.label}
      control={<span className="text-sm leading-5 text-text-secondary">{props.children}</span>}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Credential fields: one table per platform, rendered by kind. WeChat has
 * its own block below because of the folded advanced section.
 * ------------------------------------------------------------------ */

type CredentialField =
  | {
      kind: 'text' | 'password';
      key: 'token' | 'proxyUrl' | 'appId' | 'appSecret';
      label: string;
      description?: string;
      placeholder: string;
    }
  | {
      kind: 'select';
      key: 'domain';
      label: string;
      defaultValue: string;
      options: ReadonlyArray<readonly [string, string]>;
    }
  | { kind: 'allowed-user-ids' }
  | { kind: 'notice'; text: string };

function credentialFields(
  copy: BotSettingsCopy['detail'],
): Partial<Record<BotProvider, ReadonlyArray<CredentialField>>> {
  return {
    telegram: [
      {
        kind: 'password',
        key: 'token',
        label: 'Telegram Bot Token',
        placeholder: '123456:ABC-DEF...',
      },
      { kind: 'notice', text: copy.telegramOfficialFlow },
      {
        kind: 'text',
        key: 'proxyUrl',
        label: copy.telegramProxyAria,
        description: copy.chinaRequired,
        placeholder: 'http://127.0.0.1:7890',
      },
      { kind: 'allowed-user-ids' },
      { kind: 'notice', text: copy.telegramNotice },
    ],
    feishu: [
      { kind: 'text', key: 'appId', label: copy.feishuCredentialId, placeholder: 'cli_xxxx' },
      { kind: 'password', key: 'appSecret', label: copy.feishuSecret, placeholder: 'xxxx' },
      {
        kind: 'select',
        key: 'domain',
        label: copy.feishuDomain,
        defaultValue: 'feishu.cn',
        options: [
          ['feishu.cn', copy.feishuOption],
          ['larksuite.com', 'Lark (larksuite.com)'],
        ],
      },
    ],
    discord: [
      { kind: 'password', key: 'token', label: 'Discord Bot Token', placeholder: 'MTAx...' },
      {
        kind: 'text',
        key: 'proxyUrl',
        label: copy.discordProxyAria,
        description: copy.authOnly,
        placeholder: 'http://127.0.0.1:7890',
      },
      { kind: 'notice', text: copy.discordNotice },
    ],
    dingtalk: [
      { kind: 'text', key: 'appId', label: copy.dingtalkId, placeholder: 'dingxxxxxxxx' },
      { kind: 'password', key: 'appSecret', label: copy.dingtalkSecret, placeholder: 'xxxx' },
    ],
    wecom: [
      {
        kind: 'text',
        key: 'appId',
        label: copy.wecomBotAria,
        placeholder: copy.wecomBotPlaceholder,
      },
      {
        kind: 'password',
        key: 'appSecret',
        label: copy.wecomSecretAria,
        placeholder: copy.wecomSecretPlaceholder,
      },
    ],
    qq: [
      { kind: 'text', key: 'appId', label: copy.qqId, placeholder: '102xxxxxx' },
      { kind: 'password', key: 'appSecret', label: 'QQ AppSecret', placeholder: 'xxxx' },
    ],
    slack: [
      { kind: 'password', key: 'token', label: 'Slack Bot Token', placeholder: 'xoxb-…' },
      { kind: 'password', key: 'appSecret', label: 'Slack App-Level Token', placeholder: 'xapp-…' },
    ],
  };
}

function CredentialFields(props: {
  provider: BotProvider;
  channel: BotChannelSettings;
  onUpdateChannel(patch: Partial<BotChannelSettings>): Promise<boolean>;
}) {
  const copy = getBotSettingsCopy(useUiLocale()).detail;
  const fields = credentialFields(copy)[props.provider];
  if (!fields) return null;
  return (
    <>
      {fields.map((field, index) => {
        switch (field.kind) {
          case 'text':
          case 'password':
            return (
              <CommittedField
                key={field.key}
                kind={field.kind}
                label={field.label}
                {...(field.description ? { description: field.description } : {})}
                placeholder={field.placeholder}
                value={props.channel[field.key] ?? ''}
                onCommit={(value) => void props.onUpdateChannel({ [field.key]: value })}
              />
            );
          case 'select':
            return (
              <SettingsRow
                key={field.key}
                title={field.label}
                control={
                  <SelectRoot
                    value={props.channel[field.key] ?? field.defaultValue}
                    onValueChange={(value) => void props.onUpdateChannel({ [field.key]: value })}
                  >
                    <SelectTrigger aria-label={field.label} className={settingsFieldWidthClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                }
              />
            );
          case 'allowed-user-ids':
            return (
              <AllowedUserIdsField
                key="allowed-user-ids"
                value={props.channel.allowedUserIds}
                onChange={(next) => void props.onUpdateChannel({ allowedUserIds: next })}
              />
            );
          case 'notice':
            return (
              <div key={`notice-${index}`} className="py-3">
                <NoticeCard tone="info" title={field.text} />
              </div>
            );
        }
      })}
    </>
  );
}

/** A text field that writes on blur or Enter, and follows the stored value otherwise. */
function CommittedField(props: {
  kind: 'text' | 'password';
  label: string;
  description?: string;
  placeholder: string;
  value: string;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(props.value);
  const { value } = props;
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  return (
    <SettingsRow
      title={props.label}
      {...(props.description ? { description: props.description } : {})}
      layout="stacked"
    >
      <Input
        type={props.kind === 'password' ? 'password' : 'text'}
        aria-label={props.label}
        className="w-full max-w-md"
        autoComplete="off"
        placeholder={props.placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
    </SettingsRow>
  );
}

/**
 * Platform-native user ids allowed to message the bot, one per line. Parsed on
 * commit only, so a half-typed id is never dropped mid-edit; an empty list is
 * written as `undefined`, the stored "no restriction" default.
 */
function AllowedUserIdsField(props: {
  value: ReadonlyArray<string> | undefined;
  onChange(next: ReadonlyArray<string> | undefined): void;
}) {
  const copy = getBotSettingsCopy(useUiLocale()).detail;
  const persisted = props.value ?? [];
  const persistedText = persisted.join('\n');
  const [buffer, setBuffer] = useState(persistedText);
  useEffect(() => {
    setBuffer(persistedText);
  }, [persistedText]);
  const parsed = useMemo(() => parseAllowedUserIdsFromText(buffer), [buffer]);
  const atCap = parsed.length >= MAX_ALLOWED_USER_IDS;
  const invalid = useMemo(() => parsed.filter((id) => !/^[0-9]+$/.test(id)), [parsed]);
  const commit = () => {
    const next = parsed.length === 0 ? undefined : parsed;
    const same =
      (next?.length ?? 0) === persisted.length &&
      (next ?? []).every((id, i) => id === persisted[i]);
    if (!same) props.onChange(next);
  };
  const fieldId = 'settings-bot-allowed-user-ids';
  return (
    <SettingsRow
      title={copy.allowedUsersLabel(parsed.length, MAX_ALLOWED_USER_IDS)}
      description={copy.allowedUsersHelp(atCap)}
      layout="stacked"
      htmlFor={fieldId}
    >
      <Textarea
        id={fieldId}
        className="max-w-md"
        rows={3}
        spellCheck={false}
        placeholder={copy.allowedUsersPlaceholder}
        value={buffer}
        onChange={(event) => setBuffer(event.target.value)}
        onBlur={commit}
      />
      {invalid.length > 0 && (
        <p role="status" className="text-[0.8125rem] leading-[1.125rem] text-warning">
          {copy.invalidUsers(invalid)}
        </p>
      )}
    </SettingsRow>
  );
}

/** WeChat: one bot token for the local bridge, and the 公众号 fields folded away. */
function WechatFields(props: {
  channel: BotChannelSettings;
  onUpdateChannel(patch: Partial<BotChannelSettings>): Promise<boolean>;
}) {
  const copy = getBotSettingsCopy(useUiLocale()).wechat;
  const { channel } = props;
  const hasAdvanced = Boolean(channel.appId || channel.appSecret || channel.webhookUrl);
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvanced);
  return (
    <>
      <CommittedField
        kind="password"
        label={copy.token}
        placeholder={copy.tokenPlaceholder}
        value={channel.token}
        onCommit={(token) => void props.onUpdateChannel({ token })}
      />
      <div className="py-3">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <Anthropicon name={advancedOpen ? 'collapse' : 'expand'} size={12} />
          <span className="ml-1.5">
            {advancedOpen ? copy.collapseAdvanced : copy.expandAdvanced}
          </span>
        </Button>
      </div>
      {advancedOpen && (
        <>
          <CommittedField
            kind="text"
            label={copy.bridgeAddress}
            placeholder="http://127.0.0.1:18400"
            value={channel.webhookUrl ?? ''}
            onCommit={(webhookUrl) => void props.onUpdateChannel({ webhookUrl })}
          />
          <CommittedField
            kind="text"
            label={copy.appId}
            placeholder={copy.appIdPlaceholder}
            value={channel.appId ?? ''}
            onCommit={(appId) => void props.onUpdateChannel({ appId })}
          />
          <CommittedField
            kind="password"
            label={copy.appSecret}
            placeholder={copy.appSecretPlaceholder}
            value={channel.appSecret ?? ''}
            onCommit={(appSecret) => void props.onUpdateChannel({ appSecret })}
          />
          <div className="py-3">
            <NoticeCard tone="info" title={copy.advancedNotice} />
          </div>
        </>
      )}
    </>
  );
}
