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

// One LLM provider: its switch in the header, the models published from it
// (each with its own switch, settings and delete), and its settings — the
// name, what it is (fixed once created), its key, and deleting it, which the
// server refuses while models still come from it.

import { useRef, useState } from 'react';
import type {
  ConsoleModel,
  ConsoleModelProvider,
  ConsoleModelProviderDetail,
  ConsoleModelProviderPatch,
} from '../../../src/admin-console/types.js';
import {
  RowActionsMenu,
  SettingsCallout,
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
  SettingsTable,
  SettingsTableActionsCell,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsRow, SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { ConfirmDialog } from '@desktop/components/ui/confirm-dialog.js';
import { Input } from '@desktop/components/ui/input.js';
import { Switch } from '@desktop/components/ui/switch.js';
import { Textarea } from '@desktop/components/ui/textarea.js';
import { api, ConsoleApiError, errorCode, isStale, segment } from '../api.js';
import { useConsole } from '../context.js';
import { configText, IntegrationMark, integrationLabel, providerAddress } from '../integrations.js';
import { navigate } from '../router.js';
import {
  DetailHeader,
  LoadFailed,
  LoadingRows,
  reportDone,
  reportFailure,
  reportStale,
  reportWriteFailure,
  smallButton,
  usePendingSwitches,
} from '../ui.js';
import { useResource } from '../use-resource.js';
import {
  API_KEY_MAX,
  isApiKey,
  isProviderName,
  PROVIDER_NAME_MAX,
  parseServiceAccount,
} from '../validation.js';
import { AddModelsDialog } from './add-provider.js';
import { setProviderEnabled } from './model-providers.js';
import { DeleteModelDialog, ModelSettingsDialog, patchModel, withModel } from './model-settings.js';
import { NotFoundPanel } from './not-found.js';

type Dialog = 'add-models' | 'rename' | 'credential' | 'delete';

export function ModelProviderPage(props: { id: string }) {
  const { copy } = useConsole();
  const text = copy.provider;
  const path = `/model-providers/${segment(props.id)}`;
  const detail = useResource(() => api.get<ConsoleModelProviderDetail>(path), props.id);
  const providerSwitch = usePendingSwitches();
  const modelSwitches = usePendingSwitches();
  const [dialog, setDialog] = useState<Dialog>();
  // Each opening of a dialog with a form starts it afresh.
  const [opening, setOpening] = useState(0);
  const [editingId, setEditingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();

  if (detail.error instanceof ConsoleApiError && detail.error.status === 404) {
    return (
      <NotFoundPanel
        title={copy.notFound.providerTitle}
        body={copy.notFound.providerBody}
        action={copy.notFound.toProviders}
        onAction={() => navigate({ page: 'model-providers' })}
      />
    );
  }
  if (detail.error && !detail.data) {
    return (
      <SettingsSection>
        <LoadFailed error={detail.error} onRetry={detail.reload} />
      </SettingsSection>
    );
  }
  const provider = detail.data;
  if (!provider) return <LoadingRows rows={4} />;

  const open = (next: Dialog) => {
    setOpening((count) => count + 1);
    setDialog(next);
  };
  const closeDialog = () => setDialog(undefined);
  // The models carry their provider's name and switch too (the model
  // settings dialog shows the name): they change with it.
  const replaceProvider = (next: ConsoleModelProvider) =>
    detail.update((current) => ({
      ...current,
      ...next,
      models: current.models.map((model) => ({
        ...model,
        provider: { ...model.provider, name: next.name, enabled: next.enabled },
      })),
    }));
  const replaceModel = (next: ConsoleModel) =>
    detail.update((current) => ({ ...current, models: withModel(current.models, next) }));
  const enabled = providerSwitch.checked(provider.id, provider.enabled);
  const address = providerAddress(provider);
  const vertex = provider.integration === 'vertex';
  const editing = provider.models.find((model) => model.id === editingId);
  const deleting = provider.models.find((model) => model.id === deletingId);
  const hasModels = provider.models.length > 0;

  return (
    <>
      <DetailHeader
        aside={
          <>
            <span className="text-sm leading-5 text-text-secondary">
              {enabled ? text.enabled : text.disabled}
            </span>
            <Switch
              aria-label={copy.providers.enableAria(provider.name)}
              checked={enabled}
              disabled={providerSwitch.busy(provider.id)}
              onCheckedChange={(next) =>
                providerSwitch.run(provider.id, next, () =>
                  setProviderEnabled(provider, next).then(replaceProvider, (error: unknown) =>
                    reportWriteFailure(copy.providers.toggleFailed, error, detail.reload),
                  ),
                )
              }
            />
          </>
        }
      >
        <IntegrationMark integration={provider.integration} size="md" />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-[0.9375rem] font-semibold leading-5">{provider.name}</h2>
          <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
            {integrationLabel(copy, provider.integration)}
          </span>
        </div>
      </DetailHeader>

      {!provider.enabled && (
        <SettingsCallout tone="warning" title={text.disabledNotice} className="-mt-3 mb-8" />
      )}

      <SettingsSection
        id="provider-models"
        title={text.models}
        description={text.modelsHelp}
        action={
          <Button {...smallButton} onClick={() => open('add-models')}>
            {text.addModels}
          </Button>
        }
      >
        {!hasModels ? (
          <SettingsEmpty
            title={text.noModels}
            body={text.noModelsHelp}
            action={
              <Button {...smallButton} onClick={() => open('add-models')}>
                {text.addModels}
              </Button>
            }
          />
        ) : (
          <SettingsTable
            label={text.models}
            head={
              <>
                <SettingsTableHeadCell>{text.columns.model}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-28 text-right">
                  {text.columns.published}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-12" srOnly>
                  {copy.model.actions}
                </SettingsTableHeadCell>
              </>
            }
          >
            {provider.models.map((model) => (
              <SettingsTableRow
                key={model.id}
                onOpen={() => setEditingId(model.id)}
                openLabel={copy.common.manageAria(model.displayName)}
              >
                <SettingsTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate" title={model.displayName}>
                      {model.displayName}
                    </span>
                    {model.providerModel !== model.displayName && (
                      <span
                        data-mono="true"
                        className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary"
                        title={model.providerModel}
                      >
                        {model.providerModel}
                      </span>
                    )}
                  </span>
                </SettingsTableCell>
                <SettingsTableCell
                  className="text-right"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Switch
                    aria-label={copy.models.publishAria(model.displayName)}
                    checked={modelSwitches.checked(model.id, model.enabled)}
                    disabled={modelSwitches.busy(model.id)}
                    onCheckedChange={(next) =>
                      modelSwitches.run(model.id, next, () =>
                        patchModel(model, { enabled: next }).then(replaceModel, (error: unknown) =>
                          reportWriteFailure(copy.models.toggleFailed, error, detail.reload),
                        ),
                      )
                    }
                  />
                </SettingsTableCell>
                <SettingsTableActionsCell>
                  <RowActionsMenu
                    label={copy.common.moreActions(model.displayName)}
                    actions={[
                      {
                        label: copy.model.settings,
                        icon: 'settings',
                        onSelect: () => setEditingId(model.id),
                      },
                      {
                        label: copy.model.delete,
                        icon: 'trash',
                        danger: true,
                        disabled: modelSwitches.busy(model.id),
                        onSelect: () => setDeletingId(model.id),
                      },
                    ]}
                  />
                </SettingsTableActionsCell>
              </SettingsTableRow>
            ))}
          </SettingsTable>
        )}
      </SettingsSection>

      <SettingsSection title={text.settings}>
        <SettingsRow
          title={text.name}
          control={
            <span className="flex min-w-0 items-center gap-3">
              <span className="max-w-64 truncate text-text-secondary" title={provider.name}>
                {provider.name}
              </span>
              <Button {...smallButton} onClick={() => open('rename')}>
                {copy.common.edit}
              </Button>
            </span>
          }
        />
        <SettingsRow
          title={text.integration}
          description={text.fixedHelp}
          control={
            <span className="text-text-secondary">
              {integrationLabel(copy, provider.integration)}
            </span>
          }
        />
        {vertex ? (
          <>
            <SettingsRow
              title={text.projectId}
              control={
                <span data-mono="true" className="max-w-80 truncate text-text-secondary">
                  {configText(provider, 'projectId')}
                </span>
              }
            />
            <SettingsRow
              title={text.region}
              control={
                <span data-mono="true" className="max-w-80 truncate text-text-secondary">
                  {configText(provider, 'region')}
                </span>
              }
            />
          </>
        ) : (
          <SettingsRow
            title={text.baseUrl}
            control={
              <span className="flex min-w-0 max-w-96 items-center gap-1.5 text-text-secondary">
                <span data-mono="true" className="truncate" title={address.url}>
                  {address.url}
                </span>
                {address.official && (
                  <span className="shrink-0 text-text-muted">· {text.defaultBaseUrl}</span>
                )}
              </span>
            }
          />
        )}
        <SettingsRow
          title={vertex ? text.serviceAccount : text.apiKey}
          description={text.credentialHelp}
          control={
            <Button {...smallButton} onClick={() => open('credential')}>
              {vertex ? text.replaceServiceAccount : text.replaceKey}
            </Button>
          }
        />
        <SettingsRow
          title={text.delete}
          description={hasModels ? text.deleteBlocked(provider.models.length) : text.deleteHelp}
          control={
            <Button {...smallButton} disabled={hasModels} onClick={() => open('delete')}>
              {text.deleteAction}
            </Button>
          }
        />
      </SettingsSection>

      {dialog === 'add-models' && (
        <AddModelsDialog
          key={opening}
          provider={provider}
          onClose={closeDialog}
          onPublished={detail.reload}
          onStale={detail.reload}
        />
      )}
      {dialog === 'rename' && (
        <RenameDialog
          key={opening}
          provider={provider}
          onClose={closeDialog}
          onSaved={replaceProvider}
          onStale={detail.reload}
        />
      )}
      {dialog === 'credential' && (
        <CredentialDialog
          key={opening}
          provider={provider}
          onClose={closeDialog}
          onSaved={replaceProvider}
          onStale={detail.reload}
        />
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(next) => !next && closeDialog()}
        title={text.deleteTitle(provider.name)}
        description={text.deleteBody}
        confirmText={copy.common.delete}
        cancelText={copy.common.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          try {
            await api.delete(path, { expectedRevision: provider.revision });
            navigate({ page: 'model-providers' });
          } catch (error) {
            if (errorCode(error) === 'provider_in_use') {
              reportFailure(text.deleteFailed, error);
              detail.reload();
            } else {
              reportWriteFailure(text.deleteFailed, error, detail.reload);
            }
          }
        }}
      />
      <ModelSettingsDialog
        model={editing}
        onClose={() => setEditingId(undefined)}
        onSaved={replaceModel}
        onStale={detail.reload}
      />
      <DeleteModelDialog
        model={deleting}
        onClose={() => setDeletingId(undefined)}
        onDeleted={detail.reload}
        onStale={detail.reload}
      />
    </>
  );
}

/** Send one change to the provider with the revision the page last read. */
function patchProvider(
  provider: ConsoleModelProvider,
  patch: Omit<ConsoleModelProviderPatch, 'expectedRevision'>,
): Promise<ConsoleModelProvider> {
  return api.patch<ConsoleModelProvider>(`/model-providers/${segment(provider.id)}`, {
    expectedRevision: provider.revision,
    ...patch,
  } satisfies ConsoleModelProviderPatch);
}

function RenameDialog(props: {
  provider: ConsoleModelProvider;
  onClose: () => void;
  onSaved: (provider: ConsoleModelProvider) => void;
  onStale: () => void;
}) {
  const { copy } = useConsole();
  const text = copy.provider;
  const [name, setName] = useState(props.provider.name);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const close = () => {
    if (!inFlight.current) props.onClose();
  };
  const submit = () => {
    if (inFlight.current) return;
    const next = name.trim();
    if (!next) {
      setError(copy.addProvider.required);
      return;
    }
    if (!isProviderName(next)) {
      setError(copy.addProvider.nameTooLong(String(PROVIDER_NAME_MAX)));
      return;
    }
    if (next === props.provider.name) {
      props.onClose();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    patchProvider(props.provider, { name: next })
      .then((saved) => {
        props.onSaved(saved);
        props.onClose();
      })
      .catch((failure: unknown) => {
        if (errorCode(failure) === 'name_taken') setError(copy.common.errors.name_taken);
        else reportWriteFailure(text.renameFailed, failure, props.onStale);
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };
  return (
    <SettingsModal
      open
      onOpenChange={(next) => !next && close()}
      size="sm"
      title={text.renameTitle}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="provider-rename-form" disabled={saving}>
            {saving ? copy.common.saving : copy.common.save}
          </Button>
        </>
      }
    >
      <form
        id="provider-rename-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={saving} className="min-w-0">
          <SettingsModalField
            label={text.name}
            htmlFor="provider-rename"
            hint={
              error ? (
                <span role="alert" className="text-danger">
                  {error}
                </span>
              ) : undefined
            }
          >
            <Input
              id="provider-rename"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={name}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(undefined);
              }}
            />
          </SettingsModalField>
        </fieldset>
      </form>
    </SettingsModal>
  );
}

/** A new key (or service account), which the provider must accept before it replaces the old. */
function CredentialDialog(props: {
  provider: ConsoleModelProvider;
  onClose: () => void;
  onSaved: (provider: ConsoleModelProvider) => void;
  onStale: () => void;
}) {
  const { copy } = useConsole();
  const text = copy.provider;
  const serviceAccount = props.provider.integration === 'vertex';
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const close = () => {
    if (!inFlight.current) props.onClose();
  };
  const credential = (): Record<string, unknown> | undefined => {
    if (!value.trim()) {
      setError(copy.addProvider.required);
      return undefined;
    }
    if (!serviceAccount) {
      if (isApiKey(value.trim())) return { apiKey: value.trim() };
      setError(copy.addProvider.keyTooLong(String(API_KEY_MAX)));
      return undefined;
    }
    const account = parseServiceAccount(value);
    if (account) return { serviceAccount: account };
    setError(copy.addProvider.invalidServiceAccount);
    return undefined;
  };
  const submit = () => {
    if (inFlight.current) return;
    const next = credential();
    if (!next) return;
    inFlight.current = true;
    setSaving(true);
    patchProvider(props.provider, { credential: next })
      .then((saved) => {
        props.onSaved(saved);
        props.onClose();
        reportDone(text.replaced);
      })
      .catch((failure: unknown) => {
        if (errorCode(failure) === 'credentials_rejected') {
          setError(copy.common.errors.credentials_rejected);
        } else if (isStale(failure)) {
          props.onStale();
          reportStale(failure);
        } else {
          reportFailure(text.replaceFailed, failure);
        }
      })
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };
  const label = serviceAccount ? text.newServiceAccount : text.newApiKey;
  return (
    <SettingsModal
      open
      onOpenChange={(next) => !next && close()}
      size={serviceAccount ? 'md' : 'sm'}
      title={serviceAccount ? text.replaceServiceAccountTitle : text.replaceKeyTitle}
      description={text.replaceHelp}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="provider-credential-form" disabled={saving}>
            {saving ? text.verifying : text.replace}
          </Button>
        </>
      }
    >
      <form
        id="provider-credential-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={saving} className="min-w-0">
          <SettingsModalField
            label={label}
            htmlFor="provider-credential"
            hint={
              error ? (
                <span role="alert" className="text-danger">
                  {error}
                </span>
              ) : serviceAccount ? (
                copy.addProvider.serviceAccountHelp
              ) : (
                copy.addProvider.apiKeyHelp
              )
            }
          >
            {serviceAccount ? (
              <Textarea
                id="provider-credential"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="field-sizing-content min-h-[88px] max-h-48 font-mono text-xs"
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(undefined);
                }}
              />
            ) : (
              <Input
                id="provider-credential"
                type="password"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(undefined);
                }}
              />
            )}
          </SettingsModalField>
        </fieldset>
      </form>
    </SettingsModal>
  );
}
