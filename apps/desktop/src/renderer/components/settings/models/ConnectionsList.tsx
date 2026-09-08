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
// on.
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
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { menuDangerItemClass } from '../../ui/menu-variants.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Skeleton } from '../../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { cn } from '../../../lib/cn.js';
import { ProviderBrandMark } from '../../../lib/ported/provider-brand-marks.js';
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
                <SelectTrigger aria-label={copy.page.defaultModel} className="w-64">
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
      </SettingsSection>

      <SettingsSection
        title={copy.panel.connections}
        description={copy.panel.connectionsHelp}
        action={
          <Button size="sm" onClick={props.onAddConnection} disabled={!host}>
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
                size="sm"
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
          <SettingsRow title={copy.panel.empty} description={copy.panel.emptyHelp} control={null} />
        )}

        {connections.map((connection) => {
          const display = providerDisplay(connection.providerType, locale);
          const status = connectionChipStatus(connection, locale);
          const isDefault = snapshot?.defaultConnection === connection.slug;
          const modelCount = connectionEnabledModelIds(connection).length;
          return (
            <SettingsRow
              key={connection.connectionId}
              title={
                <span className="flex items-center gap-2">
                  <span className="flex size-4 shrink-0 items-center justify-center text-text-secondary [&>img]:size-full [&>svg]:size-full">
                    <ProviderBrandMark type={connection.providerType} />
                  </span>
                  <span className="truncate">{connection.name}</span>
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
              }
              description={
                <span className="flex flex-wrap items-center gap-x-2">
                  <span>{display.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{copy.panel.modelCount(modelCount)}</span>
                </span>
              }
              control={
                <span className="flex items-center gap-2">
                  {!isDefault && (
                    <Button
                      variant="secondary"
                      size="sm"
                      title={copy.panel.setDefaultTitle}
                      disabled={!host || !connection.enabled}
                      onClick={() => {
                        if (!host) return;
                        void connectionsStore
                          .setDefault(
                            { connectionId: connection.connectionId, slug: connection.slug },
                            host,
                          )
                          .catch((error: unknown) =>
                            props.onError(copy.panel.setDefaultFailed, error),
                          );
                      }}
                    >
                      {copy.panel.setDefault}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={copy.page.openDetail(connection.name)}
                    onClick={() => props.onOpenDetail(connection.connectionId)}
                  >
                    {copy.detail.edit}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={copy.page.rowMenu(connection.name)}
                      >
                        <Anthropicon name="dotsVertical" size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className={menuDangerItemClass}
                        onSelect={() => setPendingDelete(connection)}
                      >
                        {copy.detail.delete}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              }
            />
          );
        })}
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
