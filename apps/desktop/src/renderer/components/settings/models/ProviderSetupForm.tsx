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

// Setting up one provider, in a dialog over the catalog: two steps, and the
// first one is a real request.
//
// Where the Host can do it (`addProviderRoute`), the form VERIFIES before it
// saves — it probes the endpoint with the credential, shows what the endpoint
// actually serves, and only then writes a connection. The alternative, which
// this used to be, is to create the connection and discover afterwards, which
// leaves a dead row behind every mistyped key.
//
// The field gate runs on both routes. It used to run only on the legacy one,
// so a provider that ships no endpoint — which is exactly the company gateway —
// could be submitted empty and would come back as a generic network failure
// from a request sent to nowhere.

import { useState } from 'react';
import {
  deriveConnectionSlug,
  PROVIDER_REGISTRY,
  providerAuthRequiresSecret,
  providerAuthSupportsApiKey,
  type ModelInfo,
  type ProviderType,
} from '@maka/core/llm-connections';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { checkboxBoxClass, CHECKBOX_TICK_SIZE } from '../../ui/checkbox-box.js';
import { Input } from '../../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { SettingsModal, SettingsModalField } from '../settings-kit.js';
import { providerDisplay } from '../../../lib/ported/provider-display-copy.js';
import { buildCatalogRecommendedDefaultModel } from '../../../lib/ported/model-catalog-choices.js';
import {
  addProviderRequiresBaseUrl,
  addProviderRoute,
  initialOnboardingModelIds,
  orderedOnboardingModelIds,
  resolveCreateBaseUrl,
  stableOnboardingModels,
  validateAddProviderDraft,
  type AddProviderField,
  type AddProviderIssue,
} from '../../../lib/ported/provider-add-submission.js';
import { connectionsStore } from '../../../store/index.js';
import { toast } from '../../../store/toast-store.js';
import {
  createConnection,
  fetchConnectionModels,
  saveConnectionOnboarding,
  verifyConnectionOnboarding,
} from '../../../bridge/connections.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

type Phase =
  | { readonly kind: 'input' }
  | {
      readonly kind: 'models';
      readonly models: readonly ModelInfo[];
      readonly selectedIds: readonly string[];
      readonly defaultId: string;
      readonly filter: string;
    };

type FormError = { readonly field: AddProviderField; readonly message: string };

function ProviderSetupForm(props: {
  providerType: ProviderType;
  host: DesktopRuntimeHostRef | undefined;
  existingSlugs: readonly string[];
  onClose: () => void;
  onCreated: (connectionId: string) => void;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const display = providerDisplay(props.providerType, locale);
  const defaults = PROVIDER_REGISTRY[props.providerType];
  const recommendedDefaultModel = buildCatalogRecommendedDefaultModel(props.providerType);
  const requiresBaseUrl = addProviderRequiresBaseUrl(props.providerType);
  const isCloudflare = props.providerType === 'cloudflare-workers-ai';
  const supportsApiKey = providerAuthSupportsApiKey(props.providerType);
  const requiresApiKey = providerAuthRequiresSecret(props.providerType) && supportsApiKey;
  const route = addProviderRoute(props.providerType);

  const [slug, setSlug] = useState(() =>
    deriveConnectionSlug(props.providerType, props.existingSlugs),
  );
  const [name, setName] = useState(display.name);
  const [baseUrl, setBaseUrl] = useState(defaults.baseUrl);
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(recommendedDefaultModel);
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);

  const issueMessage = (issue: AddProviderIssue): string => {
    if (issue.field === 'slug') {
      return issue.reason === 'duplicate'
        ? copy.add.duplicateSlug
        : copy.add.slugIssues[issue.detail];
    }
    if (issue.field === 'apiKey') return copy.add.keyRequired(display.name);
    if (issue.field === 'accountId') return copy.add.cloudflareAccount;
    if (issue.field === 'baseUrl') return copy.add.endpointRequired;
    return copy.add.accountLogin;
  };

  const onboardingFailure = (
    result:
      | { readonly kind: 'failed'; readonly errorClass: string }
      | { readonly kind: 'rejected'; readonly reason: string },
  ): FormError => {
    if (result.kind === 'failed') {
      const message =
        result.errorClass === 'auth'
          ? copy.add.onboardingAuthFailed
          : result.errorClass === 'timeout'
            ? copy.add.onboardingTimeout
            : result.errorClass === 'network'
              ? copy.add.onboardingNetwork
              : result.errorClass === 'provider_unavailable'
                ? copy.add.onboardingUnavailable
                : copy.add.onboardingInvalidResponse;
      return { field: result.errorClass === 'auth' ? 'apiKey' : 'form', message };
    }
    if (result.reason === 'base_url_not_configured') {
      return { field: 'baseUrl', message: copy.add.endpointRequired };
    }
    if (result.reason === 'slug_taken') return { field: 'slug', message: copy.add.duplicateSlug };
    if (result.reason === 'credential_not_configured') {
      return { field: 'apiKey', message: copy.add.keyRequired(display.name) };
    }
    if (result.reason === 'catalog_full') {
      return { field: 'form', message: copy.add.onboardingCatalogFull };
    }
    if (result.reason === 'model_unavailable' || result.reason === 'superseded') {
      return { field: 'form', message: copy.add.onboardingModelsChanged };
    }
    return { field: 'form', message: copy.add.onboardingUnavailable };
  };

  // The Host validates both, and an empty name is not a name: send the keys
  // only when the user actually supplied them, and let the Host derive the rest.
  const onboardingTarget = () => ({
    kind: 'create' as const,
    providerType: props.providerType,
    ...(slug.trim() ? { slug: slug.trim() } : {}),
    ...(name.trim() ? { name: name.trim() } : {}),
  });

  const gate = (): boolean => {
    const issue = validateAddProviderDraft({
      providerType: props.providerType,
      slug,
      existingSlugs: props.existingSlugs,
      apiKey,
      cloudflareAccountId,
      baseUrl,
    });
    if (!issue) return true;
    setError({ field: issue.field, message: issueMessage(issue) });
    return false;
  };

  const verify = async () => {
    if (!props.host) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyConnectionOnboarding(
        {
          target: onboardingTarget(),
          apiKey: apiKey.trim() || null,
          baseUrl: baseUrl.trim() || null,
        },
        props.host,
      );
      if (result.kind !== 'verified') return setError(onboardingFailure(result));
      const models = stableOnboardingModels(result.models);
      const selectedIds = initialOnboardingModelIds(models, recommendedDefaultModel);
      if (selectedIds.length === 0) {
        return setError({ field: 'form', message: copy.add.onboardingNoModels });
      }
      setPhase({
        kind: 'models',
        models,
        selectedIds,
        defaultId: selectedIds[0] ?? '',
        filter: '',
      });
    } catch (error_) {
      props.onError(copy.add.onboardingUnavailable, error_);
    } finally {
      setBusy(false);
    }
  };

  const save = async (current: Extract<Phase, { kind: 'models' }>) => {
    if (!props.host) return;
    if (current.selectedIds.length === 0) {
      return setError({ field: 'form', message: copy.add.onboardingSelectModel });
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await saveConnectionOnboarding(
        {
          target: onboardingTarget(),
          apiKey: apiKey.trim() || null,
          baseUrl: baseUrl.trim() || null,
          enabledModelIds: orderedOnboardingModelIds(current),
        },
        props.host,
      );
      // Three outcomes, three different things to say. "Nothing was written"
      // is a fact the user can act on by retrying; "we do not know" is a
      // warning NOT to retry, because a second attempt would duplicate a
      // connection that may already exist.
      if (outcome.kind === 'not_saved') {
        return setError({ field: 'form', message: copy.add.onboardingUnavailable });
      }
      if (outcome.kind === 'outcome_unknown') {
        setApiKey('');
        return setError({ field: 'form', message: copy.add.onboardingOutcomeUnknownDetail });
      }
      const result = outcome.result;
      if (result.kind !== 'saved') {
        // A stale model list has to go back to the credential step: the ids
        // the user picked describe a catalog the endpoint no longer serves.
        if (
          (result.kind === 'rejected' &&
            (result.reason === 'model_unavailable' || result.reason === 'superseded')) ||
          (result.kind === 'failed' && result.errorClass === 'auth')
        ) {
          setPhase({ kind: 'input' });
        }
        return setError(onboardingFailure(result));
      }
      setApiKey('');
      await connectionsStore.refresh();
      props.onCreated(result.connection.connectionId);
    } catch (error_) {
      props.onError(copy.add.onboardingUnavailable, error_);
    } finally {
      setBusy(false);
    }
  };

  const createLegacy = async () => {
    if (!props.host) return;
    setBusy(true);
    setError(null);
    try {
      const resolvedBaseUrl = resolveCreateBaseUrl({
        providerType: props.providerType,
        baseUrl,
        cloudflareAccountId,
      });
      const created = await createConnection(
        {
          slug,
          name: name.trim() || display.name,
          providerType: props.providerType,
          ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
          defaultModel: defaultModel.trim() || recommendedDefaultModel,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
        props.host,
      );
      // Discovery is a convenience on top of a successful create, never a
      // condition of it: a failure here is reported and the connection stays.
      try {
        await fetchConnectionModels(
          { connectionId: created.connectionId, slug: created.slug },
          props.host,
        );
      } catch {
        toast({ title: copy.detail.modelsFetchFailed(created.name) });
      }
      await connectionsStore.refresh();
      props.onCreated(created.connectionId);
    } catch (error_) {
      props.onError(copy.add.onboardingUnavailable, error_);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (busy) return;
    if (!gate()) return;
    if (route === 'legacy') return void createLegacy();
    if (phase.kind === 'models') return void save(phase);
    void verify();
  };

  const fieldError = (field: AddProviderField) =>
    error?.field === field ? (
      <p role="alert" className="text-[0.8125rem] leading-[1.125rem] text-danger">
        {error.message}
      </p>
    ) : null;

  const modelChoices = phase.kind === 'models' ? phase : null;
  return (
    <SettingsModal
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
      title={copy.panel.connectTitle(display.name)}
      description={modelChoices ? copy.add.onboardingChooseModelsHelp : display.description}
      data-maka-contract="provider-setup"
      footer={
        modelChoices ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setPhase({ kind: 'input' })}>
              {copy.add.onboardingBack}
            </Button>
            <Button onClick={submit} disabled={busy || modelChoices.selectedIds.length === 0}>
              {busy ? copy.add.saving : copy.add.onboardingAddConnection}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={props.onClose} disabled={busy}>
              {copy.add.cancel}
            </Button>
            <Button onClick={submit} disabled={busy || !props.host}>
              {busy
                ? route === 'host'
                  ? copy.add.onboardingVerifying
                  : copy.add.saving
                : route === 'host'
                  ? copy.add.onboardingVerifyAndChoose
                  : copy.add.save}
            </Button>
          </>
        )
      }
    >
      {!modelChoices ? (
        <div className="flex flex-col gap-4">
          <SettingsModalField label={copy.add.name} htmlFor="provider-setup-name">
            <Input
              id="provider-setup-name"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </SettingsModalField>
          <SettingsModalField
            label={copy.add.slug}
            htmlFor="provider-setup-slug"
            hint={fieldError('slug')}
          >
            <Input
              id="provider-setup-slug"
              value={slug}
              disabled={busy}
              onChange={(event) => {
                setSlug(event.target.value);
                setError(null);
              }}
            />
          </SettingsModalField>

          {supportsApiKey && (
            <SettingsModalField
              label={copy.add.apiKeyLabel}
              htmlFor="provider-setup-key"
              hint={
                fieldError('apiKey') ?? (requiresApiKey ? undefined : copy.detail.credentialsHelp)
              }
            >
              <Input
                id="provider-setup-key"
                type="password"
                autoComplete="off"
                placeholder={copy.add.apiKeyPlaceholder}
                value={apiKey}
                disabled={busy}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setError(null);
                }}
              />
            </SettingsModalField>
          )}

          {isCloudflare && (
            <SettingsModalField
              label={copy.add.accountIdLabel}
              htmlFor="provider-setup-account"
              hint={fieldError('accountId')}
            >
              <Input
                id="provider-setup-account"
                placeholder={copy.add.accountIdPlaceholder}
                value={cloudflareAccountId}
                disabled={busy}
                onChange={(event) => {
                  setCloudflareAccountId(event.target.value);
                  setError(null);
                }}
              />
            </SettingsModalField>
          )}

          {requiresBaseUrl && (
            <SettingsModalField
              label={copy.add.endpointLabel}
              htmlFor="provider-setup-endpoint"
              hint={fieldError('baseUrl') ?? copy.page.endpointHelp}
            >
              <Input
                id="provider-setup-endpoint"
                placeholder={copy.page.endpointPlaceholder}
                value={baseUrl}
                disabled={busy}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setError(null);
                }}
              />
            </SettingsModalField>
          )}

          {route === 'legacy' && recommendedDefaultModel.trim() === '' && (
            <SettingsModalField
              label={copy.add.defaultModel}
              htmlFor="provider-setup-model"
              hint={copy.add.defaultModelHelp}
            >
              <Input
                id="provider-setup-model"
                placeholder={copy.add.defaultModelPlaceholder}
                value={defaultModel}
                disabled={busy}
                onChange={(event) => setDefaultModel(event.target.value)}
              />
            </SettingsModalField>
          )}

          {fieldError('form')}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Input
              aria-label={copy.add.onboardingSearchModels}
              placeholder={copy.add.onboardingSearchModels}
              className="w-56"
              value={modelChoices.filter}
              onChange={(event) => setPhase({ ...modelChoices, filter: event.target.value })}
            />
            <span className="shrink-0 text-sm leading-5 text-text-muted">
              {copy.add.onboardingSelectedCount(
                modelChoices.selectedIds.length,
                modelChoices.models.length,
              )}
            </span>
          </div>

          <div
            role="group"
            aria-label={copy.add.onboardingEnabledModels}
            className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-xl p-1 shadow-[inset_0_0_0_1px_var(--alpha-2)]"
          >
            {modelChoices.models
              .filter((model) =>
                modelChoices.filter.trim()
                  ? model.id.toLowerCase().includes(modelChoices.filter.trim().toLowerCase())
                  : true,
              )
              .map((model) => {
                const checked = modelChoices.selectedIds.includes(model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    className="group/cb flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm leading-5 text-text-primary outline-none hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                    onClick={() => {
                      const selectedIds = checked
                        ? modelChoices.selectedIds.filter((id) => id !== model.id)
                        : [...modelChoices.selectedIds, model.id];
                      setPhase({
                        ...modelChoices,
                        selectedIds,
                        defaultId: selectedIds.includes(modelChoices.defaultId)
                          ? modelChoices.defaultId
                          : (selectedIds[0] ?? ''),
                      });
                    }}
                  >
                    <span className={checkboxBoxClass(checked, 'xs')} aria-hidden>
                      {checked && <Anthropicon name="check" size={CHECKBOX_TICK_SIZE.xs} />}
                    </span>
                    <span className="truncate">{model.displayName?.trim() || model.id}</span>
                  </button>
                );
              })}
            {modelChoices.models.length === 0 && (
              <p className="px-2 py-1.5 text-sm leading-5 text-text-secondary">
                {copy.add.onboardingNoModelsMatch}
              </p>
            )}
          </div>

          <SettingsModalField
            label={copy.add.onboardingDefaultModel}
            htmlFor="provider-setup-default"
            hint={copy.add.onboardingDefaultModelHelp}
          >
            <Select
              value={modelChoices.defaultId}
              disabled={busy || modelChoices.selectedIds.length === 0}
              onValueChange={(defaultId) => setPhase({ ...modelChoices, defaultId })}
            >
              <SelectTrigger id="provider-setup-default">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelChoices.selectedIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsModalField>

          {fieldError('form')}
        </div>
      )}
    </SettingsModal>
  );
}

/**
 * Setting up the provider picked in the catalog, as a dialog over it. Keyed
 * by the provider so a second pick starts from a clean form.
 */
export function ProviderSetupDialog(props: {
  providerType: ProviderType | null;
  host: DesktopRuntimeHostRef | undefined;
  existingSlugs: readonly string[];
  onClose: () => void;
  onCreated: (connectionId: string) => void;
  onError: (title: string, error: unknown) => void;
}) {
  if (props.providerType === null) return null;
  return (
    <ProviderSetupForm
      key={props.providerType}
      providerType={props.providerType}
      host={props.host}
      existingSlugs={props.existingSlugs}
      onClose={props.onClose}
      onCreated={props.onCreated}
      onError={props.onError}
    />
  );
}
