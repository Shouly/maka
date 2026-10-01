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

// Adding models, in two dialogs that end the same way:
//
//   AddProviderDialog  choose the service, enter the account (its key, or
//                      the Vertex project and service account), fetch the
//                      models it offers, choose — or keep the provider alone
//   AddModelsDialog    an existing provider's models, fetched with the key
//                      the server keeps; those already published are shown
//                      as added and cannot be chosen again
//
// The list fetched is a snapshot the server remembers for a while. Saving
// after it expired fetches it again and keeps the choices still offered.
// Either dialog can be closed while a list is being fetched (the answer is
// then dropped); only a save in flight holds it open.
//
// A save carries an idempotency key. Once a save's answer is lost (the
// network, a proxy's 5xx) it may have been made, so every later save from
// the dialog carries the same key until an answer comes back: the server
// answers a repeat with the first result, and a different save under that
// key with `idempotency_conflict` — the earlier one went through — instead
// of making a second provider.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MODEL_INTEGRATIONS, type ModelIntegrationId } from '@maka/core/model-gateway';
import type {
  ConsoleCreateModelProvider,
  ConsoleModelCatalog,
  ConsoleModelProvider,
  ConsoleModelProviderDraft,
  ConsolePublished,
  ConsolePublishToProvider,
} from '../../../src/admin-console/types.js';
import { Anthropicon } from '@desktop/components/icons/Anthropicon.js';
import {
  SettingsCallout,
  SettingsModal,
  SettingsModalField,
} from '@desktop/components/settings/settings-kit.js';
import { Button } from '@desktop/components/ui/button.js';
import { CHECKBOX_TICK_SIZE, checkboxBoxClass } from '@desktop/components/ui/checkbox-box.js';
import { Input } from '@desktop/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@desktop/components/ui/select.js';
import { Textarea } from '@desktop/components/ui/textarea.js';
import { cn } from '@desktop/lib/cn.js';
import { answerLost, api, errorCode, newIdempotencyKey, segment } from '../api.js';
import { useConsole } from '../context.js';
import {
  CUSTOM_INTEGRATIONS,
  type CustomIntegration,
  capabilitySummary,
  choiceLabel,
  INTEGRATION_GROUPS,
  type IntegrationChoice,
  IntegrationMark,
} from '../integrations.js';
import { Chip, failureReason, LoadingRows, reportDone, reportFailure, reportStale } from '../ui.js';
import {
  API_KEY_MAX,
  isApiAddress,
  isApiKey,
  isProviderName,
  isVertexProject,
  isVertexRegion,
  PROVIDER_NAME_MAX,
  parseServiceAccount,
} from '../validation.js';

type Catalog = Extract<ConsoleModelCatalog, { status: 'ready' }>;
type CatalogFailure = Extract<ConsoleModelCatalog, { status: 'failed' }>['reason'];

/** The models a catalog offers that are not published yet. */
function offeredIds(catalog: Catalog): Set<string> {
  return new Set(
    catalog.models.filter((model) => !model.publishedModelId).map((model) => model.id),
  );
}

/** The choices still offered once the list is fetched again. */
function keepSelected(selected: ReadonlySet<string>, catalog: Catalog): Set<string> {
  const offered = offeredIds(catalog);
  return new Set([...selected].filter((id) => offered.has(id)));
}

/**
 * The idempotency key the next save carries: a new one for each attempt,
 * kept while an earlier attempt's answer is outstanding.
 */
function useSaveAttempt() {
  const attempt = useRef({ key: newIdempotencyKey(), outstanding: false });
  return useMemo(
    () => ({
      get key() {
        return attempt.current.key;
      },
      /** A new attempt (a new list to choose from), unless one may still have been made. */
      begin() {
        if (!attempt.current.outstanding) {
          attempt.current = { key: newIdempotencyKey(), outstanding: false };
        }
      },
      /** The answer did not come: the next save goes under the same key. */
      lost() {
        attempt.current = { ...attempt.current, outstanding: true };
      },
      /** The server answered: the next save is a new attempt. */
      settled() {
        attempt.current = { key: newIdempotencyKey(), outstanding: false };
      },
    }),
    [],
  );
}

/* ------------------------------------------------------------------ *
 * Choosing models
 * ------------------------------------------------------------------ */

/**
 * The fetched list as checkboxes: a search over name and id, "select all
 * (results)" and "clear", and how many are chosen of how many offered.
 */
export function ModelPicker(props: {
  catalog: Catalog;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const { copy, locale } = useConsole();
  const text = copy.picker;
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const { models } = props.catalog;
  const offered = models.filter((model) => !model.publishedModelId).length;
  const visible = needle
    ? models.filter(
        (model) =>
          model.displayName.toLowerCase().includes(needle) ||
          model.id.toLowerCase().includes(needle),
      )
    : models;
  const choosable = visible.filter((model) => !model.publishedModelId);
  const allChosen = choosable.every((model) => props.selected.has(model.id));
  const skipped = props.catalog.skippedModels ?? 0;

  const toggle = (id: string) => {
    const next = new Set(props.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onSelectedChange(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        type="search"
        aria-label={text.search}
        placeholder={text.search}
        autoFocus
        value={query}
        disabled={props.disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm leading-5 text-text-muted tabular-nums" aria-live="polite">
          {text.count(props.selected.size, offered)}
        </span>
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-[7px] text-sm"
            disabled={props.disabled || choosable.length === 0 || allChosen}
            onClick={() =>
              props.onSelectedChange(
                new Set([...props.selected, ...choosable.map((model) => model.id)]),
              )
            }
          >
            {needle ? text.selectResults : text.selectAll}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-[7px] text-sm"
            disabled={props.disabled || props.selected.size === 0}
            onClick={() => props.onSelectedChange(new Set())}
          >
            {text.clear}
          </Button>
        </span>
      </div>
      <div
        role="group"
        aria-label={text.listLabel}
        className="flex max-h-[min(22rem,45dvh)] min-h-40 flex-col gap-0.5 overflow-y-auto rounded-xl p-1 shadow-[inset_0_0_0_1px_var(--alpha-2)]"
      >
        {models.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm leading-5 text-text-secondary">
            {text.empty}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm leading-5 text-text-secondary">
            {text.noMatch}
          </p>
        ) : (
          visible.map((model) => {
            const added = Boolean(model.publishedModelId);
            const checked = added || props.selected.has(model.id);
            const summary = capabilitySummary(copy, locale, model.contract);
            return (
              <button
                key={model.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={props.disabled || added}
                onClick={() => toggle(model.id)}
                className="group/cb flex w-full shrink-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className={cn(checkboxBoxClass(checked, 'xs'), added && 'opacity-40')}
                  aria-hidden="true"
                >
                  {checked && <Anthropicon name="check" size={CHECKBOX_TICK_SIZE.xs} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-sm leading-5',
                        added ? 'text-text-secondary' : 'text-text-primary',
                      )}
                    >
                      {model.displayName}
                    </span>
                    {added && <Chip tone="neutral">{text.added}</Chip>}
                  </span>
                  {model.displayName !== model.id && (
                    <span
                      data-mono="true"
                      className="truncate text-[0.8125rem] leading-[1.125rem] text-text-muted"
                    >
                      {model.id}
                    </span>
                  )}
                </span>
                {summary && (
                  <span className="hidden shrink-0 text-[0.8125rem] leading-[1.125rem] text-text-muted sm:block">
                    {summary}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {skipped > 0 && (
        <p className="text-[0.8125rem] leading-[1.125rem] text-text-muted">
          {text.skipped(skipped)}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A new provider
 * ------------------------------------------------------------------ */

type Step = 'choose' | 'details' | 'models';
type Busy = 'discovering' | 'saving-provider' | 'saving-models';

interface Details {
  readonly name: string;
  readonly apiKey: string;
  readonly serviceAccount: string;
  readonly projectId: string;
  readonly region: string;
  readonly baseUrl: string;
}
type DetailField = keyof Details;

const EMPTY_DETAILS: Details = {
  name: '',
  apiKey: '',
  serviceAccount: '',
  projectId: '',
  region: 'global',
  baseUrl: '',
};

export function AddProviderDialog(props: {
  onClose: () => void;
  onCreated: (providerId: string) => void;
  /** An earlier save turned out to have been made: read the list again. */
  onSettled: () => void;
}) {
  const { copy } = useConsole();
  const text = copy.addProvider;
  const [step, setStep] = useState<Step>('choose');
  const [choice, setChoice] = useState<IntegrationChoice>();
  const [customApi, setCustomApi] = useState<CustomIntegration>('custom-chat');
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [errors, setErrors] = useState<Partial<Record<DetailField, string>>>({});
  const [failure, setFailure] = useState<Exclude<CatalogFailure, 'credentials'>>();
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<Busy>();
  const [found, setFound] = useState<{ draft: ConsoleModelProviderDraft; catalog: Catalog }>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string>();
  /** What the dialog is doing: one thing at a time, and only a save holds it open. */
  const activity = useRef<'idle' | 'discovering' | 'saving'>('idle');
  /** Bumped by every fetch, and when one is abandoned (back, close, unmount): a later answer to an older one is dropped. */
  const fetches = useRef(0);
  const attempt = useSaveAttempt();

  useEffect(
    () => () => {
      fetches.current += 1;
    },
    [],
  );

  const integration: ModelIntegrationId | undefined = choice === 'custom' ? customApi : choice;
  const definition = integration ? MODEL_INTEGRATIONS[integration] : undefined;
  const serviceAccount = definition?.auth === 'service-account';
  const custom = choice === 'custom';
  const credentialField: DetailField = serviceAccount ? 'serviceAccount' : 'apiKey';

  /** Stop waiting for a fetch: its answer, when it comes, is dropped. */
  const abandonFetch = () => {
    if (activity.current !== 'discovering') return;
    fetches.current += 1;
    activity.current = 'idle';
    setBusy(undefined);
  };

  const close = () => {
    if (activity.current === 'saving') return;
    abandonFetch();
    props.onClose();
  };

  const pick = (next: IntegrationChoice) => {
    if (next !== choice) {
      setDetails(EMPTY_DETAILS);
      setErrors({});
      setFailure(undefined);
      setAdvanced(false);
      setFound(undefined);
      setSelected(new Set());
      setCustomApi('custom-chat');
    }
    setChoice(next);
    setStep('details');
  };

  /** Another API: what was said about the last one (a refused key, a failed fetch) no longer holds. */
  const pickCustomApi = (next: CustomIntegration) => {
    if (next === customApi) return;
    setCustomApi(next);
    setErrors({});
    setFailure(undefined);
    setFound(undefined);
  };

  const edit = (field: keyof Details, value: string) => {
    setDetails((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _, ...rest }) => rest);
  };

  /** The draft the form describes, or the reasons it does not describe one yet. */
  const draftOf = (): ConsoleModelProviderDraft | undefined => {
    if (!integration) return undefined;
    const invalid: Partial<Record<DetailField, string>> = {};
    const name = details.name.trim();
    const baseUrl = details.baseUrl.trim();
    if (!isProviderName(name)) invalid.name = text.nameTooLong(String(PROVIDER_NAME_MAX));
    let config: Record<string, unknown>;
    let credential: Record<string, unknown>;
    if (serviceAccount) {
      const projectId = details.projectId.trim();
      const region = details.region.trim();
      const account = parseServiceAccount(details.serviceAccount);
      if (!projectId) invalid.projectId = text.required;
      else if (!isVertexProject(projectId)) invalid.projectId = text.invalidProjectId;
      if (!region) invalid.region = text.required;
      else if (!isVertexRegion(region)) invalid.region = text.invalidRegion;
      if (!details.serviceAccount.trim()) invalid.serviceAccount = text.required;
      else if (!account) invalid.serviceAccount = text.invalidServiceAccount;
      config = { projectId, region };
      credential = { serviceAccount: account };
    } else {
      if (custom && !baseUrl) invalid.baseUrl = text.required;
      else if (baseUrl && !isApiAddress(baseUrl)) invalid.baseUrl = text.invalidUrl;
      if (!details.apiKey.trim()) invalid.apiKey = text.required;
      else if (!isApiKey(details.apiKey.trim()))
        invalid.apiKey = text.keyTooLong(String(API_KEY_MAX));
      config = baseUrl ? { baseUrl } : {};
      credential = { apiKey: details.apiKey.trim() };
    }
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      // An address that is wrong must be seen to be fixed.
      if (invalid.baseUrl && !custom) setAdvanced(true);
      return undefined;
    }
    setErrors({});
    return { integration, ...(name ? { name } : {}), config, credential };
  };

  /**
   * Fetch the models; true when there is a list to choose from. The dialog
   * can be closed (or stepped back) meanwhile, which drops the answer.
   */
  const fetchCatalog = async (
    draft: ConsoleModelProviderDraft,
    keep: ReadonlySet<string>,
  ): Promise<boolean> => {
    const fetch = ++fetches.current;
    activity.current = 'discovering';
    setBusy('discovering');
    setFailure(undefined);
    const current = () => fetch === fetches.current;
    try {
      let catalog: ConsoleModelCatalog;
      try {
        catalog = await api.post<ConsoleModelCatalog>('/model-providers/discover', { draft });
      } catch (error) {
        if (current()) reportFailure(text.discoverFailed, error);
        return false;
      }
      if (!current()) return false;
      if (catalog.status === 'ready') {
        setFound({ draft, catalog });
        setSelected(keepSelected(keep, catalog));
        attempt.begin();
        setStep('models');
        return true;
      }
      setFound(undefined);
      setStep('details');
      if (catalog.reason === 'credentials') {
        setErrors({ [credentialField]: text.catalogCredentials });
      } else {
        setFailure(catalog.reason);
      }
      return false;
    } finally {
      if (current()) {
        activity.current = 'idle';
        setBusy(undefined);
      }
    }
  };

  const fetchModels = () => {
    if (activity.current !== 'idle') return;
    const draft = draftOf();
    if (draft) void fetchCatalog(draft, selected);
  };

  const save = async (publish: boolean) => {
    if (!found || activity.current !== 'idle') return;
    const ids = publish ? [...selected].sort() : [];
    // Keeping the provider alone still names the list it was fetched with.
    const body: ConsoleCreateModelProvider = {
      draft: found.draft,
      publish: {
        snapshotId: found.catalog.snapshotId,
        selections: ids.map((id) => ({ id })),
        idempotencyKey: attempt.key,
      },
    };
    activity.current = 'saving';
    setBusy(publish ? 'saving-models' : 'saving-provider');
    setNotice(undefined);
    let published: ConsolePublished;
    try {
      published = await api.post<ConsolePublished>('/model-providers', body);
    } catch (error) {
      activity.current = 'idle';
      setBusy(undefined);
      if (answerLost(error)) {
        attempt.lost();
        reportFailure(text.saveFailed, error);
        return;
      }
      attempt.settled();
      const code = errorCode(error);
      if (code === 'idempotency_conflict') {
        // An earlier save whose answer was lost went through.
        reportDone(text.alreadySaved);
        props.onClose();
        props.onSettled();
        return;
      }
      if (code === 'catalog_expired') {
        if (await fetchCatalog(found.draft, selected)) setNotice(text.catalogRefreshed);
        return;
      }
      if (code === 'credentials_rejected') {
        setFound(undefined);
        setStep('details');
        setErrors({ [credentialField]: text.catalogCredentials });
        return;
      }
      reportFailure(text.saveFailed, error);
      return;
    }
    activity.current = 'idle';
    const asked = found.draft.name;
    if (asked && published.providerName !== asked) {
      reportDone(text.renamed(published.providerName));
    }
    props.onClose();
    props.onCreated(published.providerId);
  };

  const back = () => {
    if (activity.current === 'saving') return;
    abandonFetch();
    setNotice(undefined);
    setStep(step === 'models' ? 'details' : 'choose');
  };

  const fieldHint = (field: DetailField, help?: string) =>
    errors[field] ? (
      <span role="alert" className="text-danger">
        {errors[field]}
      </span>
    ) : (
      help
    );

  const title =
    step === 'choose' || !choice
      ? text.chooseTitle
      : step === 'details'
        ? text.detailsTitle(choiceLabel(copy, choice))
        : text.modelsTitle;
  const description =
    step === 'choose' ? text.chooseHelp : step === 'details' ? text.detailsHelp : text.modelsHelp;

  // Keyed per step: a button never turns into another kind of button, whose
  // fill (drawn on a pseudo-element) would otherwise keep the old colour.
  const footer =
    step === 'choose' ? (
      <Button key="cancel" variant="secondary" onClick={close}>
        {copy.common.cancel}
      </Button>
    ) : step === 'details' ? (
      <>
        <Button
          key="back-to-choose"
          variant="secondary"
          disabled={busy === 'saving-provider' || busy === 'saving-models'}
          onClick={back}
        >
          {copy.common.back}
        </Button>
        <Button key="discover" type="submit" form="add-provider-details" disabled={Boolean(busy)}>
          {busy === 'discovering' ? text.discovering : text.discover}
        </Button>
      </>
    ) : (
      <>
        <Button
          key="back-to-details"
          variant="ghost"
          className="mr-auto"
          disabled={busy === 'saving-provider' || busy === 'saving-models'}
          onClick={back}
        >
          {copy.common.back}
        </Button>
        <Button
          key="save-provider"
          variant="secondary"
          disabled={Boolean(busy)}
          onClick={() => void save(false)}
        >
          {busy === 'saving-provider' ? text.saving : text.saveProviderOnly}
        </Button>
        <Button
          key="save-models"
          disabled={Boolean(busy) || selected.size === 0}
          onClick={() => void save(true)}
        >
          {busy === 'saving-models'
            ? text.saving
            : busy === 'discovering'
              ? text.discovering
              : text.saveAndPublish(selected.size)}
        </Button>
      </>
    );

  return (
    <SettingsModal
      open
      onOpenChange={(open) => !open && close()}
      size="lg"
      title={title}
      description={description}
      footer={footer}
    >
      {step === 'choose' && (
        <div className="flex flex-col gap-5">
          {INTEGRATION_GROUPS.map(({ group, choices }) => (
            <section key={group} className="flex flex-col gap-2.5">
              <h3 className="text-sm font-medium leading-5 text-text-primary">
                {copy.integrations.groups[group]}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {choices.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={id === choice}
                    onClick={() => pick(id)}
                    // The directory card: r11 on the soft surface, a 10% ring
                    // that deepens on hover and on the one chosen before.
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-[11px] bg-surface-1 p-3.5 text-left outline-none transition-shadow focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                      id === choice
                        ? 'shadow-[inset_0_0_0_1px_var(--alpha-4)]'
                        : 'shadow-[inset_0_0_0_1px_var(--alpha-2)] hover:shadow-[inset_0_0_0_1px_var(--alpha-3)]',
                    )}
                  >
                    <IntegrationMark integration={id} size="md" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium leading-5 text-text-primary">
                        {choiceLabel(copy, id)}
                      </span>
                      <span className="line-clamp-2 text-[0.8125rem] leading-[1.0625rem] text-text-secondary">
                        {copy.integrations.descriptions[id]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {step === 'details' && integration && definition && (
        <form
          id="add-provider-details"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            fetchModels();
          }}
        >
          <fieldset disabled={Boolean(busy)} className="flex min-w-0 flex-col gap-5">
            {failure && (
              <SettingsCallout
                tone="danger"
                title={failure === 'unavailable' ? text.catalogUnavailable : text.catalogInvalid}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-[7px] text-sm"
                    type="submit"
                  >
                    {copy.common.retry}
                  </Button>
                }
              />
            )}
            <SettingsModalField
              label={text.name}
              htmlFor="provider-name"
              hint={fieldHint('name', text.nameHelp)}
            >
              <Input
                id="provider-name"
                autoComplete="off"
                spellCheck={false}
                placeholder={definition.label}
                value={details.name}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => edit('name', event.target.value)}
              />
            </SettingsModalField>

            {custom && (
              <>
                <SettingsModalField
                  label={text.apiType}
                  htmlFor="provider-api-type"
                  hint={text.apiTypeHelp}
                >
                  <Select
                    value={customApi}
                    onValueChange={(value) => pickCustomApi(value as CustomIntegration)}
                  >
                    <SelectTrigger id="provider-api-type" aria-label={text.apiType}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOM_INTEGRATIONS.map((id) => (
                        <SelectItem key={id} value={id}>
                          {MODEL_INTEGRATIONS[id].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsModalField>
                <SettingsModalField
                  label={text.baseUrl}
                  htmlFor="provider-base-url"
                  hint={fieldHint('baseUrl', text.customBaseUrlHelp)}
                >
                  <Input
                    id="provider-base-url"
                    type="url"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    placeholder="https://"
                    value={details.baseUrl}
                    aria-invalid={errors.baseUrl ? true : undefined}
                    onChange={(event) => edit('baseUrl', event.target.value)}
                  />
                </SettingsModalField>
              </>
            )}

            {serviceAccount ? (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <SettingsModalField
                    label={text.projectId}
                    htmlFor="provider-project"
                    hint={fieldHint('projectId')}
                  >
                    <Input
                      id="provider-project"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                      value={details.projectId}
                      aria-invalid={errors.projectId ? true : undefined}
                      onChange={(event) => edit('projectId', event.target.value)}
                    />
                  </SettingsModalField>
                  <SettingsModalField
                    label={text.region}
                    htmlFor="provider-region"
                    hint={fieldHint('region', text.regionHelp)}
                  >
                    <Input
                      id="provider-region"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                      value={details.region}
                      aria-invalid={errors.region ? true : undefined}
                      onChange={(event) => edit('region', event.target.value)}
                    />
                  </SettingsModalField>
                </div>
                <SettingsModalField
                  label={text.serviceAccount}
                  htmlFor="provider-service-account"
                  hint={fieldHint('serviceAccount', text.serviceAccountHelp)}
                >
                  <Textarea
                    id="provider-service-account"
                    spellCheck={false}
                    autoComplete="off"
                    className="field-sizing-content min-h-[88px] max-h-48 font-mono text-xs"
                    value={details.serviceAccount}
                    aria-invalid={errors.serviceAccount ? true : undefined}
                    onChange={(event) => edit('serviceAccount', event.target.value)}
                  />
                </SettingsModalField>
              </>
            ) : (
              <SettingsModalField
                label={text.apiKey}
                htmlFor="provider-key"
                hint={fieldHint('apiKey', text.apiKeyHelp)}
              >
                <Input
                  id="provider-key"
                  type="password"
                  autoFocus={!custom}
                  autoComplete="off"
                  spellCheck={false}
                  value={details.apiKey}
                  aria-invalid={errors.apiKey ? true : undefined}
                  onChange={(event) => edit('apiKey', event.target.value)}
                />
              </SettingsModalField>
            )}

            {!custom && !serviceAccount && (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  aria-expanded={advanced}
                  aria-controls="provider-advanced"
                  onClick={() => setAdvanced((open) => !open)}
                  className="-ml-1 flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1 text-sm leading-5 text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                >
                  <Anthropicon
                    name="caretRight"
                    size={12}
                    className={cn('transition-transform', advanced && 'rotate-90')}
                  />
                  {text.advanced}
                </button>
                {advanced && (
                  <div id="provider-advanced">
                    <SettingsModalField
                      label={text.baseUrl}
                      htmlFor="provider-base-url"
                      hint={fieldHint('baseUrl', text.overrideBaseUrlHelp)}
                    >
                      <Input
                        id="provider-base-url"
                        type="url"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        placeholder={definition.baseUrl}
                        value={details.baseUrl}
                        aria-invalid={errors.baseUrl ? true : undefined}
                        onChange={(event) => edit('baseUrl', event.target.value)}
                      />
                    </SettingsModalField>
                  </div>
                )}
              </div>
            )}
          </fieldset>
        </form>
      )}

      {step === 'models' && found && (
        <div className="flex min-w-0 flex-col gap-4">
          {notice && <SettingsCallout tone="warning" title={notice} />}
          <ModelPicker
            catalog={found.catalog}
            selected={selected}
            onSelectedChange={setSelected}
            disabled={Boolean(busy)}
          />
        </div>
      )}
    </SettingsModal>
  );
}

/* ------------------------------------------------------------------ *
 * More models from a provider
 * ------------------------------------------------------------------ */

type Fetch =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly catalog: Catalog }
  | { readonly kind: 'failed'; readonly message: string };

export function AddModelsDialog(props: {
  provider: ConsoleModelProvider;
  onClose: () => void;
  /** Models were published: read the provider again. */
  onPublished: () => void;
  /** The provider changed elsewhere: read it again; settles once it has been read. */
  onStale: () => Promise<void> | void;
}) {
  const { copy } = useConsole();
  const text = copy.addModels;
  const providerId = props.provider.id;
  const [fetched, setFetched] = useState<Fetch>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<'discovering' | 'saving'>();
  const [notice, setNotice] = useState<string>();
  /** What the dialog is doing: one thing at a time, and only a publish holds it open. */
  const activity = useRef<'idle' | 'discovering' | 'saving'>('idle');
  /** Bumped by every fetch, on close and on unmount: an older fetch's answer is dropped. */
  const fetches = useRef(0);
  // A publish sends the revision last read, which a reload may have just renewed.
  const provider = useRef(props.provider);
  provider.current = props.provider;
  const attempt = useSaveAttempt();

  const close = () => {
    if (activity.current === 'saving') return;
    fetches.current += 1;
    props.onClose();
  };

  /**
   * Fetch the provider's models with its stored key — and, after a conflict,
   * read the provider again alongside, so nothing can be published until
   * both are back. True when there is a list to choose from.
   */
  const discover = useCallback(
    async (keep: ReadonlySet<string>, reread?: () => Promise<void> | void): Promise<boolean> => {
      const fetch = ++fetches.current;
      const current = () => fetch === fetches.current;
      activity.current = 'discovering';
      setBusy('discovering');
      const message = (reason: CatalogFailure) =>
        reason === 'credentials'
          ? text.credentials
          : reason === 'unavailable'
            ? copy.addProvider.catalogUnavailable
            : copy.addProvider.catalogInvalid;
      try {
        const [answer] = await Promise.all([
          api
            .post<ConsoleModelCatalog>(`/model-providers/${segment(providerId)}/discover`, {})
            .then(
              (catalog) => ({ catalog }) as const,
              (error: unknown) => ({ error }) as const,
            ),
          reread?.(),
        ]);
        if (!current()) return false;
        if ('error' in answer) {
          setFetched({ kind: 'failed', message: failureReason(answer.error) });
          return false;
        }
        if (answer.catalog.status === 'failed') {
          setFetched({ kind: 'failed', message: message(answer.catalog.reason) });
          return false;
        }
        setFetched({ kind: 'ready', catalog: answer.catalog });
        setSelected(keepSelected(keep, answer.catalog));
        attempt.begin();
        return true;
      } finally {
        if (current()) {
          activity.current = 'idle';
          setBusy(undefined);
        }
      }
    },
    [attempt, copy, providerId, text],
  );

  const refetch = (keep: ReadonlySet<string>) => {
    if (activity.current !== 'idle') return;
    setNotice(undefined);
    setFetched({ kind: 'loading' });
    void discover(keep);
  };

  // A fetch per opening; the cleanup drops it when the dialog goes (and,
  // in development, when the effect is run twice).
  useEffect(() => {
    void discover(new Set());
    return () => {
      fetches.current += 1;
    };
  }, [discover]);

  const publish = async () => {
    if (fetched.kind !== 'ready' || activity.current !== 'idle' || selected.size === 0) return;
    const ids = [...selected].sort();
    const body: ConsolePublishToProvider = {
      expectedRevision: provider.current.revision,
      snapshotId: fetched.catalog.snapshotId,
      selections: ids.map((id) => ({ id })),
      idempotencyKey: attempt.key,
    };
    activity.current = 'saving';
    setBusy('saving');
    setNotice(undefined);
    try {
      await api.post<ConsolePublished>(`/model-providers/${segment(providerId)}/publish`, body);
    } catch (error) {
      activity.current = 'idle';
      setBusy(undefined);
      if (answerLost(error)) {
        attempt.lost();
        reportFailure(text.publishFailed, error);
        return;
      }
      attempt.settled();
      const code = errorCode(error);
      if (code === 'idempotency_conflict') {
        // An earlier publish whose answer was lost went through.
        reportDone(text.alreadyPublished);
        props.onPublished();
        props.onClose();
        return;
      }
      if (code === 'not_found') {
        reportStale(error);
        void props.onStale();
        props.onClose();
        return;
      }
      if (code === 'catalog_expired' || code === 'revision_conflict') {
        // Someone else published or changed this provider, or the list
        // expired: fetch it again (and the provider, for its revision),
        // keeping the choices still offered.
        const ready = await discover(
          selected,
          code === 'revision_conflict' ? props.onStale : undefined,
        );
        if (ready) {
          setNotice(
            code === 'catalog_expired' ? copy.addProvider.catalogRefreshed : text.refreshed,
          );
        }
        return;
      }
      reportFailure(text.publishFailed, error);
      return;
    }
    activity.current = 'idle';
    props.onPublished();
    props.onClose();
  };

  return (
    <SettingsModal
      open
      onOpenChange={(open) => !open && close()}
      size="lg"
      title={text.title(props.provider.name)}
      description={text.help}
      footer={
        <>
          <Button variant="secondary" disabled={busy === 'saving'} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button
            disabled={Boolean(busy) || fetched.kind !== 'ready' || selected.size === 0}
            onClick={() => void publish()}
          >
            {busy === 'saving' ? text.publishing : text.publish(selected.size)}
          </Button>
        </>
      }
    >
      {fetched.kind === 'loading' ? (
        <LoadingRows rows={4} />
      ) : fetched.kind === 'failed' ? (
        <SettingsCallout
          tone="danger"
          title={fetched.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              className="rounded-[7px] text-sm"
              disabled={Boolean(busy)}
              onClick={() => refetch(selected)}
            >
              {copy.common.retry}
            </Button>
          }
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {notice && <SettingsCallout tone="warning" title={notice} />}
          <ModelPicker
            catalog={fetched.catalog}
            selected={selected}
            onSelectedChange={setSelected}
            disabled={Boolean(busy)}
          />
        </div>
      )}
    </SettingsModal>
  );
}
