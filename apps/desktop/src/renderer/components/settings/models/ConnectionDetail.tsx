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

// One connection: what it is called, where it points, what it authenticates
// with, which of its models are on, and whether it answers.
//
// Every write goes straight to the Host and the page re-renders from the
// refreshed catalog rather than from local state. The only local state is what
// the user is still typing — a name they have not committed, a key they have
// not saved, a header table they are still assembling — because those are the
// things a refresh must NOT overwrite.
//
// The endpoint and the key rows read their editability from the provider, not
// from the connection: an account-managed connection has both, and neither is
// the user's to change (`provider-endpoint-presentation.ts` owns that verdict).

import { useEffect, useState } from 'react';
import {
  connectionEnabledModelIds,
  providerAuthSupportsApiKey,
  type ProjectedLlmConnection,
} from '@maka/core/llm-connections';
import { providerDefaultsOf, type ProviderDefaults } from '@maka/core/provider-registry';
import type { RelayModelProfiles } from '@maka/core/model-thinking';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import { Input } from '../../ui/input.js';
import { Skeleton } from '../../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { Switch } from '../../ui/switch.js';
import { ConnectionModelsSection } from './ConnectionModelsSection.js';
import {
  RequestHeadersEditor,
  requestHeaderUpdates,
  savedRequestHeaderDrafts,
  type RequestHeaderDraft,
} from './RequestHeadersEditor.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from '../settings-row.js';
import { cn } from '../../../lib/cn.js';
import { ProviderBrandMark } from '../../../lib/ported/provider-brand-marks.js';
import { providerDisplay } from '../../../lib/ported/provider-display-copy.js';
import { providerEndpointPresentation } from '../../../lib/ported/provider-endpoint-presentation.js';
import { connectionChipStatus } from '../../../lib/ported/provider-connection-status.js';
import {
  useConnectionAction,
  useConnectionDetailReads,
} from '../../../hooks/use-connection-detail.js';
import { connectionsStore } from '../../../store/index.js';
import { toast } from '../../../store/toast-store.js';
import {
  fetchConnectionModels,
  setConnectionRequestHeaders,
  testConnection,
  type ConnectionTestResult,
} from '../../../bridge/connections.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

/**
 * The page below reads the provider's registry entry for `.authKind` and
 * `.baseUrl`, so a connection whose `providerType` this build does not
 * register gets a page that states that and offers the one action left.
 */
export function ConnectionDetail(props: ConnectionDetailProps) {
  const defaults = providerDefaultsOf(props.connection.providerType);
  return defaults === undefined ? (
    <UnknownProviderDetail {...props} />
  ) : (
    <KnownConnectionDetail {...props} defaults={defaults} />
  );
}

function UnknownProviderDetail(props: ConnectionDetailProps) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const connection = props.connection;
  const host = props.host;
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <div data-maka-contract="connection-detail">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <Anthropicon name="arrowLeft" size={16} />
          <span className="ml-1.5">{copy.panel.backToList}</span>
        </Button>
      </div>
      <div className="mb-6 flex items-center gap-2">
        <h2 className="min-w-0 truncate text-[15px] font-semibold leading-5 text-text-primary">
          {connection.name || connection.slug}
        </h2>
      </div>
      <SettingsSection>
        <SettingsRow
          title={copy.detail.unknownProvider(connection.providerType)}
          description={copy.detail.unknownProviderHelp}
          control={
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              {copy.detail.delete}
            </Button>
          }
        />
      </SettingsSection>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={copy.detail.deleteConnectionTitle(connection.name || connection.slug)}
        description={copy.detail.deleteDescription(props.isDefault, false)}
        confirmText={copy.detail.delete}
        cancelText={copy.detail.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          if (!host) return;
          try {
            await connectionsStore.remove(
              { connectionId: connection.connectionId, slug: connection.slug },
              host,
            );
            props.onDeleted();
          } catch (error) {
            props.onError(copy.detail.deleteFailed, error);
          } finally {
            setDeleteOpen(false);
          }
        }}
      />
    </div>
  );
}

interface ConnectionDetailProps {
  connection: ProjectedLlmConnection;
  host: DesktopRuntimeHostRef | undefined;
  isDefault: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onError: (title: string, error: unknown) => void;
}

function KnownConnectionDetail(props: ConnectionDetailProps & { defaults: ProviderDefaults }) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const connection = props.connection;
  const host = props.host;
  const identity = { connectionId: connection.connectionId, slug: connection.slug };
  const display = providerDisplay(connection.providerType, locale);
  const endpoint = providerEndpointPresentation(connection);
  const defaults = props.defaults;
  const supportsApiKey = providerAuthSupportsApiKey(connection.providerType);
  const accountManaged = defaults.authKind === 'oauth_token';
  const reads = useConnectionDetailReads(identity, host);
  const action = useConnectionAction();

  const [name, setName] = useState(connection.name);
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [headers, setHeaders] = useState<RequestHeaderDraft[] | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Follow the Host when the connection is renamed elsewhere, but never while
  // the field is mid-edit: the committed value is the one the store carries,
  // so `connection.name` changing IS the signal that the last edit landed.
  useEffect(() => setName(connection.name), [connection.name]);
  useEffect(() => setBaseUrl(connection.baseUrl ?? ''), [connection.baseUrl]);
  useEffect(() => {
    if (reads.savedHeaderNames) setHeaders(savedRequestHeaderDrafts(reads.savedHeaderNames));
  }, [reads.savedHeaderNames]);

  const write = (patch: Parameters<typeof connectionsStore.update>[1], failure: string) => {
    if (!host) return;
    void action
      .run(() => connectionsStore.update(identity, patch, host))
      .catch((error: unknown) => props.onError(failure, error));
  };

  const status = connectionChipStatus(connection, locale);

  return (
    <div data-maka-contract="connection-detail">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <Anthropicon name="arrowLeft" size={16} />
          <span className="ml-1.5">{copy.panel.backToList}</span>
        </Button>
      </div>

      <div className="mb-6 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center text-text-secondary [&>img]:size-full [&>svg]:size-full">
          <ProviderBrandMark type={connection.providerType} />
        </span>
        <h2 className="min-w-0 truncate text-[15px] font-semibold leading-5 text-text-primary">
          {connection.name}
        </h2>
        <span className="text-[13px] leading-[18px] text-text-secondary">{display.name}</span>
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
      </div>

      <SettingsSection title={copy.detail.credentials} description={copy.detail.credentialsHelp}>
        <SettingsRow
          title={copy.detail.connectionName}
          control={
            <Input
              aria-label={copy.detail.connectionName}
              className={settingsFieldWidthClass}
              value={name}
              placeholder={copy.detail.connectionNamePlaceholder}
              disabled={action.busy}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                const next = name.trim();
                if (!next || next === connection.name) return setName(connection.name);
                write({ name: next }, copy.detail.saveFailed);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setName(connection.name);
              }}
            />
          }
        />

        <SettingsRow
          title={copy.detail.endpoint}
          description={endpoint.modelOverrides ? copy.detail.endpointModelOverridesNote : undefined}
          control={
            endpoint.editable ? (
              <Input
                aria-label={copy.detail.endpoint}
                className="w-72"
                value={baseUrl}
                placeholder={copy.page.endpointPlaceholder}
                disabled={action.busy}
                onChange={(event) => setBaseUrl(event.target.value)}
                onBlur={() => {
                  const next = baseUrl.trim();
                  if (next === (connection.baseUrl ?? '')) return;
                  write({ baseUrl: next }, copy.detail.saveFailed);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            ) : (
              <span className="max-w-96 truncate text-[13px] leading-[18px] text-text-secondary">
                {endpoint.value ??
                  (endpoint.emptyState === 'managed'
                    ? copy.detail.endpointManaged
                    : copy.detail.endpointMissing)}
              </span>
            )
          }
        />

        {supportsApiKey && (
          <SettingsRow
            title={copy.detail.modelKey}
            description={
              accountManaged
                ? copy.page.oauthManaged
                : reads.credential === 'loading'
                  ? copy.detail.credentialLoadingDetail
                  : reads.credential === 'unknown'
                    ? copy.detail.credentialUnknownDetail
                    : copy.detail.credentialsHelp
            }
            control={
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    statusChipClass,
                    statusChipToneClass(CREDENTIAL_TONE[reads.credential]),
                  )}
                >
                  {credentialLabel(copy, reads.credential)}
                </span>
                <Input
                  aria-label={copy.detail.modelKeyAria(connection.name)}
                  type="password"
                  autoComplete="off"
                  className="w-56"
                  value={apiKey}
                  placeholder={copy.page.keyReplacePlaceholder}
                  disabled={action.busy || accountManaged}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={action.busy || accountManaged || apiKey.trim().length === 0}
                  onClick={() => {
                    if (!host) return;
                    void action
                      .run(() => connectionsStore.update(identity, { apiKey: apiKey.trim() }, host))
                      .then(() => {
                        setApiKey('');
                        reads.reloadCredential();
                      })
                      .catch((error: unknown) => props.onError(copy.detail.saveFailed, error));
                  }}
                >
                  {copy.page.keyReplace}
                </Button>
              </span>
            }
          />
        )}

        <SettingsRow
          title={copy.detail.status}
          description={
            testResult === null
              ? connection.lastTestMessage
              : testResult.ok
                ? [
                    testResult.latencyMs === undefined
                      ? ''
                      : copy.page.testLatency(testResult.latencyMs),
                    testResult.modelTested ? copy.page.testedModel(testResult.modelTested) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : (testResult.errorMessage ?? testFailureReason(copy, testResult.errorClass))
          }
          control={
            <span className="flex items-center gap-2">
              {testResult && (
                <span
                  role="status"
                  className={cn(
                    statusChipClass,
                    statusChipToneClass(testResult.ok ? 'success' : 'error'),
                  )}
                >
                  {testResult.ok
                    ? copy.detail.connectionSuccess(connection.name)
                    : copy.detail.connectionFailed(connection.name)}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={action.busy || !connection.enabled}
                onClick={() => {
                  setTestResult(null);
                  void action
                    .run(() => testConnection(identity, undefined, host))
                    .then((result) => {
                      if (result) setTestResult(result);
                    })
                    .catch((error: unknown) =>
                      props.onError(copy.detail.connectionTestError(connection.name), error),
                    );
                }}
              >
                {action.busy ? copy.page.testRunning : copy.detail.testConnection}
              </Button>
            </span>
          }
        />

        <SettingsRow
          title={copy.page.enabled}
          description={copy.page.enabledHelp}
          control={
            <Switch
              aria-label={copy.page.enabled}
              checked={connection.enabled}
              disabled={action.busy}
              onCheckedChange={(enabled) => write({ enabled }, copy.detail.saveFailed)}
            />
          }
        />
      </SettingsSection>

      <ConnectionModelsSection
        connection={connection}
        busy={action.busy}
        fetching={fetching}
        onSetEnabledModels={(enabledModelIds) =>
          write({ enabledModelIds }, copy.detail.saveModelsFailed)
        }
        onAddModel={({ id, contextWindow }) =>
          // A typed-in model is one the user means to use, so it joins the
          // selection; its context window is a declaration about an id, which
          // is what `relayModelProfiles` is for.
          write(
            {
              enabledModelIds: [...connectionEnabledModelIds(connection), id],
              relayModelProfiles: {
                ...(connection.relayModelProfiles ?? {}),
                [id]: { contextWindow },
              },
            },
            copy.detail.saveModelsFailed,
          )
        }
        onFetchModels={() => {
          if (!host) return;
          setFetching(true);
          void fetchConnectionModels(identity, host)
            .then((result) => {
              toast({
                title: copy.detail.modelsFetched(result.models.length, connection.name),
                variant: 'success',
              });
              return connectionsStore.refresh();
            })
            .catch((error: unknown) =>
              props.onError(copy.detail.modelsFetchFailed(connection.name), error),
            )
            .finally(() => setFetching(false));
        }}
        onSetRelayProfiles={(relayModelProfiles: RelayModelProfiles) =>
          write({ relayModelProfiles }, copy.detail.saveFailed)
        }
      />

      <SettingsSection
        title={copy.detail.advancedRequest}
        description={copy.detail.advancedRequestHelp}
      >
        <SettingsRow layout="stacked" title={copy.detail.requestHeaders}>
          {headers === null ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : (
            <div className="flex flex-col gap-3">
              <RequestHeadersEditor
                headers={headers}
                disabled={action.busy || reads.headersLoading}
                onChange={setHeaders}
              />
              <div>
                <Button
                  size="sm"
                  disabled={action.busy}
                  onClick={() => {
                    let updates: ReturnType<typeof requestHeaderUpdates>;
                    try {
                      updates = requestHeaderUpdates(headers);
                    } catch {
                      toast({
                        title: copy.detail.requestCustomizationInvalid,
                        description: copy.detail.requestHeadersInvalidDetail,
                        variant: 'destructive',
                      });
                      return;
                    }
                    void action
                      .run(() => setConnectionRequestHeaders(identity, updates, host))
                      .then(() => reads.reloadHeaders())
                      .catch((error: unknown) => props.onError(copy.detail.saveFailed, error));
                  }}
                >
                  {copy.detail.saveAdvancedRequest}
                </Button>
              </div>
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={copy.detail.dangerZone} description={copy.detail.deleteRowHelp}>
        <SettingsRow
          title={copy.detail.deleteUnused}
          control={
            <Button
              variant="destructive"
              size="sm"
              disabled={action.busy}
              onClick={() => setDeleteOpen(true)}
            >
              {accountManaged ? copy.detail.disconnectAndDelete : copy.detail.delete}
            </Button>
          }
        />
      </SettingsSection>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={copy.detail.deleteConnectionTitle(connection.name)}
        description={copy.detail.deleteDescription(props.isDefault, accountManaged)}
        confirmText={copy.detail.delete}
        cancelText={copy.detail.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          if (!host) return;
          try {
            await connectionsStore.remove(identity, host);
            props.onDeleted();
          } catch (error) {
            props.onError(copy.detail.deleteFailed, error);
          } finally {
            setDeleteOpen(false);
          }
        }}
      />
    </div>
  );
}

/**
 * The sentence for a failed test when the Host sent no message of its own.
 * `errorClass` is a closed union and every member has copy; the fallback is for
 * the case where the Host classified nothing at all.
 */
function testFailureReason(
  copy: ReturnType<typeof getSettingsModelsCopy>,
  errorClass: ConnectionTestResult['errorClass'],
): string {
  return errorClass ? copy.shared.lastTest[errorClass] : copy.shared.statusUnavailable;
}

const CREDENTIAL_TONE = {
  loading: 'neutral',
  set: 'success',
  missing: 'attention',
  unknown: 'neutral',
} as const;

function credentialLabel(
  copy: ReturnType<typeof getSettingsModelsCopy>,
  state: keyof typeof CREDENTIAL_TONE,
): string {
  if (state === 'loading') return copy.detail.statusLoading;
  if (state === 'set') return copy.detail.keySet;
  if (state === 'missing') return copy.detail.keyMissing;
  return copy.detail.credentialUnknown;
}
