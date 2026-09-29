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

// Settings › Models, the list face: sections of plain setting rows, as the
// Preferences pages are. Defaults first — the model and thinking level a new
// task starts on — then the two places a model comes from: the organization
// account, whose models are listed as they are (there is nothing to configure
// on them), and the person's own connections, each with the way into its
// page. The model catalog closes the page.
//
// The organization's connection is the app's, made and kept in step with the
// account (`org-account-connection.ts`), so it has no page of its own: signed
// out it is a way to sign in, signed in it is its models and a refresh.

import { useState } from 'react';
import { useStore } from 'zustand';
import { modelChoiceValue, parseModelChoiceValue, useUiLocale } from '@maka/ui';
import type { ProjectedLlmConnection } from '@maka/core/llm-connections';
import {
  connectionEnabledModelIds,
  providerUsesOrganizationAccount,
} from '@maka/core/llm-connections';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Skeleton } from '../../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { DefaultThinkingRow } from '../host-default-settings.js';
import { SettingsEmpty } from '../settings-kit.js';
import { SettingsRow, SettingsSection, settingsRowLinkClass } from '../settings-row.js';
import { ModelFacts } from './ConnectionModelsSection.js';
import { ModelCatalogStatusRow } from './ModelCatalogStatusRow.js';
import { cn } from '../../../lib/cn.js';
import { connectionModelRows } from '../../../lib/connection-model-rows.js';
import { providerDisplay } from '../../../lib/ported/provider-display-copy.js';
import { connectionChipStatus } from '../../../lib/ported/provider-connection-status.js';
import { connectionsStore, orgAccountStore, uiStore } from '../../../store/index.js';
import { fetchConnectionModels } from '../../../bridge/connections.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import type { DesktopConnectionSnapshot } from '../../../bridge/connections.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

const NO_MODEL = '__none__';

/** The 28px secondary the Preferences pages use: 14px text, 10px sides, radius 7. */
const smallButton = {
  variant: 'secondary',
  size: 'sm',
  className: 'rounded-[7px] text-sm',
} as const;

export function ConnectionsList(props: {
  host: DesktopRuntimeHostRef | undefined;
  snapshot: DesktopConnectionSnapshot | undefined;
  loading: boolean;
  loadError: string | undefined;
  onOpenDetail: (connectionId: string) => void;
  onAddConnection: () => void;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const shared = getSettingsSharedCopy(locale);
  const host = props.host;
  const snapshot = props.snapshot;
  const connections = snapshot?.connections ?? [];
  const choices = snapshot?.chatModelChoices ?? [];
  const currentModel = choices.find((choice) => choice.isDefault);
  const organization = connections.find((row) => providerUsesOrganizationAccount(row.providerType));
  const own = connections.filter((row) => !providerUsesOrganizationAccount(row.providerType));
  // The organisation and a connection of the person's own can offer a model
  // under one name; the picker then says whose each is.
  const labelCounts = new Map<string, number>();
  for (const choice of choices) {
    labelCounts.set(choice.label, (labelCounts.get(choice.label) ?? 0) + 1);
  }
  const choiceLabel = (choice: (typeof choices)[number]) =>
    (labelCounts.get(choice.label) ?? 0) > 1
      ? `${choice.label} · ${choice.connectionName ?? choice.providerLabel}`
      : choice.label;

  // A failed read says so above whatever the last one showed; with nothing
  // shown yet, it is the page.
  const loadFailed = props.loadError !== undefined && (
    <SettingsSection>
      <SettingsRow
        title={copy.panel.loadFailed}
        description={props.loadError}
        control={
          <Button
            {...smallButton}
            disabled={props.loading}
            onClick={() => void connectionsStore.refresh()}
          >
            {shared.retry}
          </Button>
        }
      />
    </SettingsSection>
  );
  if (loadFailed && snapshot === undefined) {
    return <div data-maka-contract="providers-panel">{loadFailed}</div>;
  }

  return (
    <div data-maka-contract="providers-panel">
      {loadFailed}
      <SettingsSection title={copy.sources.defaults}>
        <SettingsRow
          title={copy.page.defaultModel}
          description={copy.page.defaultModelHelp}
          control={
            snapshot ? (
              <Select
                value={
                  currentModel
                    ? modelChoiceValue(currentModel.connectionSlug, currentModel.model)
                    : NO_MODEL
                }
                disabled={!host || choices.length === 0}
                onValueChange={(value) => {
                  if (!host) return;
                  const parsed = value === NO_MODEL ? undefined : parseModelChoiceValue(value);
                  void connectionsStore
                    .setDefaultModel(
                      parsed ? { slug: parsed.llmConnectionSlug, model: parsed.model } : null,
                      host,
                    )
                    .catch((error: unknown) => props.onError(copy.page.defaultModelFailed, error));
                }}
              >
                <SelectTrigger aria-label={copy.page.defaultModel} variant="ghost">
                  <SelectValue placeholder={copy.page.defaultModelNone} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MODEL}>{copy.page.defaultModelNone}</SelectItem>
                  {choices.map((choice) => (
                    <SelectItem
                      key={`${choice.connectionSlug}:${choice.model}`}
                      value={modelChoiceValue(choice.connectionSlug, choice.model)}
                    >
                      {choiceLabel(choice)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Skeleton className="h-8 w-64 rounded-lg" />
            )
          }
        />
        <DefaultThinkingRow host={host} />
      </SettingsSection>

      <OrganizationSection
        host={host}
        connection={organization}
        loaded={snapshot !== undefined}
        defaultModelId={
          organization && currentModel?.connectionSlug === organization.slug
            ? currentModel.model
            : undefined
        }
        onError={props.onError}
      />

      <SettingsSection
        title={copy.sources.own}
        description={copy.sources.ownHelp}
        action={
          <Button {...smallButton} disabled={!host} onClick={props.onAddConnection}>
            {copy.panel.addConnection}
          </Button>
        }
      >
        {snapshot === undefined ? (
          <RowsSkeleton label={shared.loading} />
        ) : own.length === 0 ? (
          <SettingsEmpty title={copy.sources.ownEmpty} body={copy.sources.ownEmptyHelp} />
        ) : (
          own.map((connection) => (
            <OwnConnectionRow
              key={connection.connectionId}
              connection={connection}
              isDefault={snapshot.defaultConnection === connection.slug}
              onOpen={() => props.onOpenDetail(connection.connectionId)}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={copy.sources.catalog}>
        <ModelCatalogStatusRow host={host} onError={props.onError} />
      </SettingsSection>
    </div>
  );
}

/**
 * The organization's models, or the way to them: signed out it is a sign-in
 * (Settings › Account runs it), signed in it is the models as offered.
 */
function OrganizationSection(props: {
  host: DesktopRuntimeHostRef | undefined;
  connection: ProjectedLlmConnection | undefined;
  loaded: boolean;
  defaultModelId: string | undefined;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const shared = getSettingsSharedCopy(locale);
  const signedIn = useStore(orgAccountStore, (state) => state.account?.status === 'signed_in');
  const [refreshing, setRefreshing] = useState(false);
  const { connection, host } = props;
  const models = connection
    ? connectionModelRows(connection.catalogEntries, connectionEnabledModelIds(connection)).filter(
        (row) => row.enabled,
      )
    : [];

  const enable = () => {
    if (!connection || !host) return;
    void connectionsStore
      .update(
        { connectionId: connection.connectionId, slug: connection.slug },
        { enabled: true },
        host,
      )
      .catch((error: unknown) => props.onError(copy.detail.saveFailed, error));
  };

  const refresh = () => {
    if (!connection || !host) return;
    setRefreshing(true);
    void fetchConnectionModels(
      { connectionId: connection.connectionId, slug: connection.slug },
      host,
    )
      .then(() => connectionsStore.refresh())
      .catch((error: unknown) => props.onError(copy.sources.refreshFailed, error))
      .finally(() => setRefreshing(false));
  };

  return (
    <SettingsSection
      title={copy.sources.organization}
      description={copy.sources.organizationHelp}
      action={
        signedIn &&
        connection && (
          <Button {...smallButton} disabled={!host || refreshing} onClick={refresh}>
            {refreshing ? copy.sources.refreshing : copy.sources.refresh}
          </Button>
        )
      }
    >
      {!props.loaded ? (
        <RowsSkeleton label={shared.loading} />
      ) : !signedIn ? (
        <SettingsRow
          title={copy.sources.organizationSignedOut}
          description={copy.sources.organizationSignedOutHelp}
          control={
            <Button {...smallButton} onClick={() => uiStore.openSettings('account')}>
              {copy.sources.signIn}
            </Button>
          }
        />
      ) : !connection ? (
        // Signed in a moment ago, or the app is still trying: it makes the
        // connection on each sign-in and tries again when that fails.
        <SettingsRow
          title={copy.sources.organizationSyncing}
          description={copy.sources.organizationSyncingHelp}
          control={null}
        />
      ) : models.length === 0 ? (
        // An empty list and one that could not be read look the same from
        // here; Refresh says which, as a failure when it is one.
        <SettingsEmpty
          title={copy.sources.organizationNoModels}
          body={copy.sources.organizationNoModelsHelp}
        />
      ) : (
        [
          ...(connection.enabled
            ? []
            : [
                <SettingsRow
                  key="disabled"
                  title={copy.sources.organizationDisabled}
                  description={copy.sources.organizationDisabledHelp}
                  control={
                    <Button {...smallButton} disabled={!host} onClick={enable}>
                      {copy.sources.enable}
                    </Button>
                  }
                />,
              ]),
          ...models.map((row) => (
            <SettingsRow
              key={row.id}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{row.entry?.displayName?.trim() || row.id}</span>
                  {row.id === props.defaultModelId && (
                    <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                      {copy.panel.default}
                    </span>
                  )}
                </span>
              }
              description={<ModelFacts row={row} />}
              control={null}
            />
          )),
        ]
      )}
    </SettingsSection>
  );
}

/** One of the person's connections: what it is, how many of its models are on, and its page. */
function OwnConnectionRow(props: {
  connection: ProjectedLlmConnection;
  isDefault: boolean;
  onOpen: () => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const { connection } = props;
  const status = connectionChipStatus(connection, locale);
  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{connection.name}</span>
          {props.isDefault && (
            <span className={cn(statusChipClass, statusChipToneClass('active'))}>
              {copy.panel.default}
            </span>
          )}
          {status && (
            <span className={cn(statusChipClass, statusChipToneClass(status.tone))}>
              {status.label}
            </span>
          )}
        </span>
      }
      description={copy.sources.connectionSummary(
        providerDisplay(connection.providerType, locale).name,
        connectionEnabledModelIds(connection).length,
      )}
      control={
        <button
          type="button"
          className={settingsRowLinkClass}
          aria-label={copy.sources.manageAria(connection.name)}
          onClick={props.onOpen}
        >
          {copy.sources.manage}
          <Anthropicon name="caretRight" size={12} />
        </button>
      }
    />
  );
}

function RowsSkeleton(props: { label: string }) {
  return (
    <div className="flex flex-col gap-2 py-3" role="status" aria-label={props.label}>
      {[0, 1].map((index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}
