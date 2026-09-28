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

// The connections this Host can send through, and the model a new task starts
// on — with the thinking level it starts at right under it.
//
// The default MODEL and the default CONNECTION are two different facts and get
// two different controls. A connection can be the default while none of its
// models is the chat default (it was just added, or its catalog moved), and
// showing one control for both would make that state unrepresentable rather
// than visible.

import { useState } from 'react';
import { modelChoiceValue, parseModelChoiceValue, useUiLocale } from '@maka/ui';
import type { ProjectedLlmConnection } from '@maka/core/llm-connections';
import { connectionEnabledModelIds } from '@maka/core/llm-connections';
import { PROVIDER_REGISTRY } from '@maka/core/provider-registry';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Skeleton } from '../../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { DefaultThinkingRow } from '../host-default-settings.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsTable,
  SettingsTableActionsCell,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '../settings-kit.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { ModelCatalogStatusRow } from './ModelCatalogStatusRow.js';
import { cn } from '../../../lib/cn.js';
import { ProviderTile } from './provider-tile.js';
import { providerDisplay } from '../../../lib/ported/provider-display-copy.js';
import { connectionChipStatus } from '../../../lib/ported/provider-connection-status.js';
import { connectionsStore } from '../../../store/index.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import type { DesktopConnectionSnapshot } from '../../../bridge/connections.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

const NO_MODEL = '__none__';

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
  const [pendingDelete, setPendingDelete] = useState<ProjectedLlmConnection | null>(null);
  const host = props.host;
  const snapshot = props.snapshot;
  const connections = snapshot?.connections ?? [];
  const choices = snapshot?.chatModelChoices ?? [];
  const currentModel = choices.find((choice) => choice.isDefault);

  return (
    <div data-maka-contract="providers-panel">
      <SettingsSection title={copy.page.title} description={copy.page.description}>
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
                      {choice.label}
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
        <ModelCatalogStatusRow host={host} onError={props.onError} />
      </SettingsSection>

      <SettingsSection
        title={copy.panel.connections}
        description={copy.panel.connectionsHelp}
        action={
          <Button onClick={props.onAddConnection} disabled={!host}>
            {copy.panel.addConnection}
          </Button>
        }
      >
        {props.loadError !== undefined && (
          <SettingsRow
            title={copy.panel.loadFailed}
            description={props.loadError}
            control={
              <Button
                variant="secondary"
                disabled={props.loading}
                onClick={() => void connectionsStore.refresh()}
              >
                {copy.panel.retry}
              </Button>
            }
          />
        )}

        {snapshot === undefined && props.loadError === undefined && (
          <SettingsRow
            title={<Skeleton className="h-5 w-40 rounded-md" />}
            control={<Skeleton className="h-8 w-24 rounded-lg" />}
          />
        )}

        {snapshot !== undefined && connections.length === 0 && (
          <SettingsEmpty title={copy.panel.empty} body={copy.panel.emptyHelp} />
        )}

        {connections.length > 0 && (
          <SettingsTable
            label={copy.panel.connections}
            head={
              <>
                <SettingsTableHeadCell className="w-[46%]">
                  {copy.panel.columns.connection}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell>{copy.panel.columns.provider}</SettingsTableHeadCell>
                <SettingsTableHeadCell>{copy.panel.columns.models}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-12" srOnly>
                  {copy.panel.columns.actions}
                </SettingsTableHeadCell>
              </>
            }
          >
            {connections.map((connection) => {
              const display = providerDisplay(connection.providerType, locale);
              const status = connectionChipStatus(connection, locale);
              const isDefault = snapshot?.defaultConnection === connection.slug;
              const modelCount = connectionEnabledModelIds(connection).length;
              return (
                <SettingsTableRow
                  key={connection.connectionId}
                  onOpen={() => props.onOpenDetail(connection.connectionId)}
                  openLabel={copy.page.openDetail(connection.name)}
                >
                  <SettingsTableCell>
                    <span className="flex min-w-0 items-center gap-3">
                      <ProviderTile type={connection.providerType} />
                      <span className="min-w-0 truncate font-medium">{connection.name}</span>
                      {isDefault && (
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
                  </SettingsTableCell>
                  <SettingsTableCell className="truncate text-text-secondary">
                    {display.name}
                  </SettingsTableCell>
                  <SettingsTableCell className="text-text-secondary">
                    {copy.panel.modelCount(modelCount)}
                  </SettingsTableCell>
                  <SettingsTableActionsCell>
                    <RowActionsMenu
                      label={copy.page.rowMenu(connection.name)}
                      reveal="hover"
                      actions={[
                        {
                          label: copy.detail.edit,
                          onSelect: () => props.onOpenDetail(connection.connectionId),
                        },
                        ...(isDefault
                          ? []
                          : [
                              {
                                label: copy.panel.setDefault,
                                disabled: !host || !connection.enabled,
                                onSelect: () => {
                                  if (!host) return;
                                  void connectionsStore
                                    .setDefault(
                                      {
                                        connectionId: connection.connectionId,
                                        slug: connection.slug,
                                      },
                                      host,
                                    )
                                    .catch((error: unknown) =>
                                      props.onError(copy.panel.setDefaultFailed, error),
                                    );
                                },
                              },
                            ]),
                        {
                          label: copy.detail.delete,
                          danger: true,
                          onSelect: () => setPendingDelete(connection),
                        },
                      ]}
                    />
                  </SettingsTableActionsCell>
                </SettingsTableRow>
              );
            })}
          </SettingsTable>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? copy.detail.deleteConnectionTitle(pendingDelete.name) : ''}
        // `deleteDescription` already appends the default-connection warning
        // when it applies; the dialog says it once.
        description={
          pendingDelete
            ? copy.detail.deleteDescription(
                snapshot?.defaultConnection === pendingDelete.slug,
                PROVIDER_REGISTRY[pendingDelete.providerType].authKind === 'oauth_token',
              )
            : ''
        }
        confirmText={copy.detail.delete}
        cancelText={copy.detail.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingDelete;
          if (!target || !host) return;
          try {
            await connectionsStore.remove(
              { connectionId: target.connectionId, slug: target.slug },
              host,
            );
          } catch (error) {
            props.onError(copy.detail.deleteFailed, error);
          } finally {
            setPendingDelete(null);
          }
        }}
      />
    </div>
  );
}
