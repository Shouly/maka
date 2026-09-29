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
import type { ModelOverrides } from '@maka/core/model-thinking';
import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import { Input } from '../../ui/input.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { Switch } from '../../ui/switch.js';
import { ConnectionModelsSection } from './ConnectionModelsSection.js';
import {
  RequestHeadersEditor,
  requestHeaderUpdates,
  savedRequestHeaderDrafts,
  type RequestHeaderDraft,
} from './RequestHeadersEditor.js';
import { RowActionsMenu, SettingsModal } from '../settings-kit.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from '../settings-row.js';
import { ProviderTile } from './provider-tile.js';
import { cn } from '../../../lib/cn.js';
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
      <div className="mb-6 flex items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold leading-5 text-text-primary">
          {connection.name || connection.slug}
        </h2>
        <RowActionsMenu
          label={copy.detail.moreActions(connection.name || connection.slug)}
          actions={[
            {
              label: copy.detail.delete,
              icon: 'trash',
              danger: true,
              onSelect: () => setDeleteOpen(true),
            },
          ]}
        />
      </div>
      <SettingsSection>
        <SettingsRow
          title={copy.detail.unknownProvider(connection.providerType)}
          description={copy.detail.unknownProviderHelp}
          control={null}
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
  onDeleted: () => void;
  onError: (title: string, error: unknown) => void;
}

/** The 28px secondary the Preferences pages use: 14px text, 10px sides, radius 7. */
const smallButton = {
  variant: 'secondary',
  size: 'sm',
  className: 'rounded-[7px] text-sm',
} as const;

function KnownConnectionDetail(props: ConnectionDetailProps & { defaults: ProviderDefaults }) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const connection = props.connection;
  const host = props.host;
  const identity = { connectionId: connection.connectionId, slug: connection.slug };
  const display = providerDisplay(connection.providerType, locale);
  const endpoint = providerEndpointPresentation(connection);
  const supportsApiKey = providerAuthSupportsApiKey(connection.providerType);
  const accountManaged = props.defaults.authKind === 'oauth_token';
  const reads = useConnectionDetailReads(identity, host);
  const action = useConnectionAction();

  const [name, setName] = useState(connection.name);
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl ?? '');
  // The key is typed into its own dialog; the row only says whether there is one.
  const [keyOpen, setKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [headers, setHeaders] = useState<RequestHeaderDraft[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [headersOpen, setHeadersOpen] = useState(false);

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

  const closeKey = () => {
    setApiKey('');
    setKeyOpen(false);
  };
  const saveKey = () => {
    const key = apiKey.trim();
    if (!host || !key) return;
    void action
      .run(() => connectionsStore.update(identity, { apiKey: key }, host))
      .then(() => {
        closeKey();
        // The last test was of the key that was replaced.
        setTestResult(null);
        reads.reloadCredential();
      })
      .catch((error: unknown) => props.onError(copy.detail.saveFailed, error));
  };

  const status = connectionChipStatus(connection, locale);

  return (
    <div data-maka-contract="connection-detail">
      <div className="mb-6 flex items-center gap-3">
        <ProviderTile type={connection.providerType} />
        <h2 className="min-w-0 truncate text-[0.9375rem] font-semibold leading-5 text-text-primary">
          {connection.name}
        </h2>
        <span className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">
          {display.name}
        </span>
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
        <span className="ml-auto">
          <RowActionsMenu
            label={copy.detail.moreActions(connection.name)}
            actions={[
              {
                label: accountManaged ? copy.detail.disconnectAndDelete : copy.detail.delete,
                icon: 'trash',
                danger: true,
                disabled: action.busy,
                onSelect: () => setDeleteOpen(true),
              },
            ]}
          />
        </span>
      </div>

      <SettingsSection title={copy.detail.credentials}>
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
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setName(connection.name);
              }}
            />
          }
        />

        {endpoint.editable ? (
          <SettingsRow
            title={copy.detail.endpoint}
            description={
              endpoint.modelOverrides ? copy.detail.endpointModelOverridesNote : undefined
            }
            control={
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
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            }
          />
        ) : (
          // An address that is not the person's to change is read, under its title.
          <SettingsRow
            title={copy.detail.endpoint}
            description={
              <span className="flex flex-col gap-0.5">
                <span className="break-all">
                  {endpoint.value ??
                    (endpoint.emptyState === 'managed'
                      ? copy.detail.endpointManaged
                      : copy.detail.endpointMissing)}
                </span>
                {endpoint.modelOverrides && <span>{copy.detail.endpointModelOverridesNote}</span>}
              </span>
            }
          />
        )}

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
                    : reads.credential === 'set'
                      ? copy.sources.keyStored
                      : copy.sources.keyMissing
            }
            control={
              accountManaged ? null : (
                <Button
                  {...smallButton}
                  disabled={action.busy || reads.credential === 'loading'}
                  onClick={() => setKeyOpen(true)}
                >
                  {reads.credential === 'set' ? copy.detail.change : copy.detail.set}
                </Button>
              )
            }
          />
        )}

        <SettingsRow
          title={copy.detail.testConnection}
          description={
            testResult === null ? (
              (connection.lastTestMessage ?? copy.sources.testHelp)
            ) : testResult.ok ? (
              <span role="status">
                {[
                  copy.detail.statusHealthy,
                  testResult.latencyMs === undefined
                    ? ''
                    : copy.page.testLatency(testResult.latencyMs),
                  testResult.modelTested ? copy.page.testedModel(testResult.modelTested) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : (
              <span role="alert" className="text-danger">
                {testResult.errorMessage ?? testFailureReason(copy, testResult.errorClass)}
              </span>
            )
          }
          control={
            <Button
              {...smallButton}
              disabled={testing || action.busy || !connection.enabled}
              onClick={() => {
                setTestResult(null);
                setTesting(true);
                // Through the page's one action, so nothing else is written
                // while the test is out; the label is the test's own.
                void action
                  .run(() => testConnection(identity, undefined, host))
                  .then((result) => {
                    if (result) setTestResult(result);
                  })
                  .catch((error: unknown) =>
                    props.onError(copy.detail.connectionTestError(connection.name), error),
                  )
                  .finally(() => setTesting(false));
              }}
            >
              {testing ? copy.page.testRunning : copy.sources.test}
            </Button>
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
          // is what `modelOverrides` is for.
          write(
            {
              enabledModelIds: [...connectionEnabledModelIds(connection), id],
              modelOverrides: {
                ...(connection.modelOverrides ?? {}),
                [id]: { contextWindow },
              },
            },
            copy.detail.saveModelsFailed,
          )
        }
        onFetchModels={() => {
          if (!host) return;
          setFetching(true);
          // Silent when it works, as every settings write is: the list itself
          // is what changed.
          void fetchConnectionModels(identity, host)
            .then(() => connectionsStore.refresh())
            .catch((error: unknown) =>
              props.onError(copy.detail.modelsFetchFailed(connection.name), error),
            )
            .finally(() => setFetching(false));
        }}
        onSetModelOverrides={(modelOverrides: ModelOverrides) =>
          write({ modelOverrides }, copy.detail.saveFailed)
        }
      />

      <SettingsSection title={copy.detail.advancedRequest}>
        <SettingsRow
          title={copy.detail.requestHeaders}
          description={
            reads.savedHeaderNames
              ? copy.detail.requestHeadersSummary(reads.savedHeaderNames.length)
              : undefined
          }
          control={
            <Button
              {...smallButton}
              disabled={action.busy || headers === null}
              onClick={() => setHeadersOpen(true)}
            >
              {copy.detail.manage}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsModal
        open={keyOpen}
        onOpenChange={(open) => {
          if (!open) closeKey();
        }}
        size="sm"
        title={copy.sources.keyDialogTitle(connection.name)}
        description={copy.detail.credentialsHelp}
        footer={
          <>
            <Button variant="secondary" disabled={action.busy} onClick={closeKey}>
              {copy.detail.cancel}
            </Button>
            <Button disabled={action.busy || apiKey.trim().length === 0} onClick={saveKey}>
              {copy.detail.save}
            </Button>
          </>
        }
      >
        <Input
          aria-label={copy.detail.modelKeyAria(connection.name)}
          type="password"
          autoComplete="off"
          autoFocus
          value={apiKey}
          placeholder={copy.detail.pasteModelKey}
          disabled={action.busy}
          onChange={(event) => setApiKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') saveKey();
          }}
        />
      </SettingsModal>

      <SettingsModal
        open={headersOpen && headers !== null}
        onOpenChange={(open) => {
          if (open) return;
          // Closing without saving puts back what is stored.
          if (reads.savedHeaderNames) setHeaders(savedRequestHeaderDrafts(reads.savedHeaderNames));
          setHeadersOpen(false);
        }}
        title={copy.detail.requestHeaders}
        description={copy.detail.advancedRequestHelp}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => {
                if (reads.savedHeaderNames)
                  setHeaders(savedRequestHeaderDrafts(reads.savedHeaderNames));
                setHeadersOpen(false);
              }}
            >
              {copy.detail.cancel}
            </Button>
            <Button
              disabled={action.busy || headers === null}
              onClick={() => {
                if (headers === null) return;
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
                  .then(() => {
                    reads.reloadHeaders();
                    setHeadersOpen(false);
                  })
                  .catch((error: unknown) => props.onError(copy.detail.saveFailed, error));
              }}
            >
              {copy.detail.save}
            </Button>
          </>
        }
      >
        {headers !== null && (
          <RequestHeadersEditor
            headers={headers}
            disabled={action.busy || reads.headersLoading}
            onChange={setHeaders}
          />
        )}
      </SettingsModal>

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
