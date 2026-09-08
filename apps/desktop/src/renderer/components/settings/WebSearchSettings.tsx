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

// Where the agent's web search comes from, and proof that it works.
//
// Two sources, and only one of them has a credential: `model` reuses the
// current chat model's provider-hosted search, decided per turn against the
// exact connection and model, so there is nothing to configure and nothing to
// test beyond asking. `tavily` is a key this machine holds.
//
// The key is never displayed. It arrives from the settings store already
// masked (`MASKED_TOKEN_SENTINEL`), and re-submitting that sentinel means
// "keep what is stored" — so the field holds only what the user just typed,
// and an empty field is never a request to clear.
//
// Both probes keep their answer on the page rather than only in a toast: a
// credential test whose result scrolled away is a test the user has to run
// again to remember.

import { useState } from 'react';
import {
  webSearchCredentialStatusFromResponse,
  type WebSearchCredentialSource,
  type WebSearchCredentialStatus,
  type WebSearchProvider,
  type WebSearchResponse,
  type WebSearchResultRow,
} from '@maka/core/web-search';
import { normalizeSearchUrl } from '@maka/core/search';
import { RelativeTime, redactSecrets, useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';
import { Switch } from '../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from './settings-row.js';
import { queryWebSearch, testWebSearch } from '../../bridge/web-search.js';
import { useHostSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { settingsStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import {
  getWebSearchSettingsCopy,
  type WebSearchSettingsCopy,
} from '../../locales/settings-web-search-copy.js';
import { openExternal } from '../../bridge/external-links.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

const TAVILY_SIGNUP_URL = 'https://tavily.com';

type ChipTone = 'success' | 'active' | 'attention' | 'error' | 'neutral';
type Pending = 'save' | 'clear' | 'test' | 'query' | null;

export function WebSearchSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getWebSearchSettingsCopy(locale);
  const groups = getSettingsSharedCopy(locale).groups;
  const report = useSettingsErrorReporter();
  const settings = useHostSettings().data;

  const [draftKey, setDraftKey] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [testResult, setTestResult] = useState<WebSearchResponse | null>(null);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<readonly WebSearchResultRow[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  if (!settings) {
    return (
      <SettingsSection title={groups.searchProvider} description={groups.searchProviderHelp}>
        <SettingsRow title={copy.provider} control={<Skeleton className="h-8 w-56 rounded-lg" />} />
        <SettingsRow title={copy.enabled} control={<Skeleton className="h-5 w-9 rounded-full" />} />
      </SettingsSection>
    );
  }

  const webSearch = settings.webSearch;
  const tavily = webSearch.providers.tavily;
  const usingModel = webSearch.defaultProvider === 'model';
  const usingEnvKey = tavily.credentialSource === 'env';
  const hasStoredKey = tavily.apiKey.length > 0;
  const hasUsableKey = hasStoredKey || usingEnvKey;
  const hasUsableProvider = usingModel || hasUsableKey;
  const busy = pending !== null;

  const write = async (
    patch: NonNullable<Parameters<typeof settingsStore.update>[0]['webSearch']>,
    failure = copy.saveFailed,
  ): Promise<boolean> => {
    if (!props.host) return false;
    try {
      await settingsStore.update({ webSearch: patch }, props.host);
      return true;
    } catch (error) {
      report(failure, error);
      return false;
    }
  };

  /**
   * Record what a probe learned about the stored key.
   *
   * Carries the version it observed so a slow answer cannot overwrite the
   * status of a key the user has replaced since — `mergeWebSearchSettings`
   * drops a status whose version is stale.
   */
  const recordStatus = (status: WebSearchCredentialStatus, credentialVersion: number) =>
    write(
      {
        providers: {
          tavily: {
            credentialVersion,
            credentialStatus: status,
            credentialCheckedAt: new Date().toISOString(),
          },
        },
      },
      copy.saveStatusFailed,
    );

  const status: { label: string; tone: ChipTone } = usingModel
    ? {
        label: webSearch.enabled ? copy.statuses.modelEnabled : copy.statuses.modelDisabled,
        tone: webSearch.enabled ? 'success' : 'attention',
      }
    : credentialStatusChip(
        tavily.credentialSource,
        webSearch.enabled,
        tavily.credentialStatus,
        copy,
      );

  const checkedAtMs = tavily.credentialCheckedAt
    ? Date.parse(tavily.credentialCheckedAt)
    : Number.NaN;
  const queryBlocked = !hasUsableProvider
    ? copy.disabledReasons.noKey
    : !webSearch.enabled
      ? copy.disabledReasons.disabled
      : query.trim().length === 0
        ? copy.disabledReasons.noQuery
        : null;

  const runTest = () => {
    const usesDraftKey = !usingModel && draftKey.trim().length > 0;
    const observedVersion = tavily.credentialVersion;
    setPending('test');
    setTestResult(null);
    void testWebSearch(
      {
        provider: webSearch.defaultProvider,
        ...(usesDraftKey ? { apiKey: draftKey } : {}),
      },
      props.host,
    )
      .then((result) => {
        setTestResult(result);
        // Only a test of the STORED key says anything about the stored key.
        if (!usingModel && !usesDraftKey && hasUsableKey) {
          void recordStatus(webSearchCredentialStatusFromResponse(result), observedVersion);
        }
      })
      .catch((error: unknown) => report(copy.testError, error))
      .finally(() => setPending(null));
  };

  return (
    <>
      <SettingsSection title={groups.searchProvider} description={groups.searchProviderHelp}>
        <SettingsRow
          title={copy.provider}
          description={copy.providerHelp}
          control={
            <Select
              label={copy.provider}
              value={webSearch.defaultProvider}
              disabled={busy}
              options={[
                { value: 'model', label: copy.providerModel },
                { value: 'tavily', label: copy.providerTavily },
              ]}
              onChange={(value) => {
                setTestResult(null);
                void write({ defaultProvider: value as WebSearchProvider });
              }}
            />
          }
        />
        <SettingsRow
          title={copy.enabled}
          description={copy.enabledHelp}
          control={
            <span className="flex items-center gap-3" role="group" aria-label={copy.statusAria}>
              <span className="flex flex-col items-end gap-0.5">
                <span className={`${statusChipClass} ${statusChipToneClass(status.tone)}`}>
                  {status.label}
                </span>
                <small className="text-[12px] leading-4 text-text-muted">
                  {usingModel
                    ? copy.sources.model
                    : credentialSourceLabel(tavily.credentialSource, hasStoredKey, copy)}
                </small>
                {!usingModel && Number.isFinite(checkedAtMs) && (
                  <small className="text-[12px] leading-4 text-text-muted">
                    {copy.lastTest}
                    <RelativeTime ts={checkedAtMs} />
                  </small>
                )}
              </span>
              <Switch
                aria-label={copy.enabledAria}
                checked={webSearch.enabled}
                disabled={!hasUsableProvider || busy}
                onCheckedChange={(enabled) => void write({ enabled })}
              />
            </span>
          }
        />

        {usingModel ? (
          <SettingsRow title={copy.modelCredential} description={copy.modelCredentialHelp} />
        ) : (
          <SettingsRow
            title={copy.key}
            description={
              usingEnvKey ? (
                copy.envKeyHelp
              ) : (
                <>
                  {copy.savedKeyHelp}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-text-primary"
                    onClick={() => openExternal(TAVILY_SIGNUP_URL)}
                  >
                    tavily.com
                  </button>
                </>
              )
            }
            layout="stacked"
          >
            <Input
              type="password"
              aria-label={copy.keyAria}
              className={settingsFieldWidthClass}
              autoComplete="off"
              placeholder={
                usingEnvKey
                  ? copy.envPlaceholder
                  : hasStoredKey
                    ? copy.storedPlaceholder
                    : copy.keyPlaceholder
              }
              value={draftKey}
              disabled={usingEnvKey || busy}
              onChange={(event) => setDraftKey(event.target.value)}
            />
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={copy.actions}
            >
              <Button
                size="sm"
                disabled={busy || usingEnvKey || draftKey.length === 0}
                onClick={() => {
                  setPending('save');
                  void write({ providers: { tavily: { apiKey: draftKey } } })
                    .then((saved) => {
                      if (!saved) return;
                      setDraftKey('');
                      setTestResult(null);
                      toast({
                        title: copy.keySaved,
                        description: copy.keySavedDetail,
                        variant: 'success',
                      });
                    })
                    .finally(() => setPending(null));
                }}
              >
                {pending === 'save' ? copy.saving : copy.saveKey}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || (draftKey.length === 0 && !hasUsableKey)}
                onClick={runTest}
              >
                {pending === 'test' ? copy.testing : copy.testKey}
              </Button>
              {hasStoredKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setPending('clear');
                    // Clearing the key turns the feature off in the same write:
                    // leaving it on would arm a source that cannot answer.
                    void write({ enabled: false, providers: { tavily: { apiKey: '' } } })
                      .then((saved) => {
                        if (!saved) return;
                        setDraftKey('');
                        setTestResult(null);
                        toast({
                          title: copy.credentialsCleared,
                          description: copy.credentialsClearedDetail,
                          variant: 'success',
                        });
                      })
                      .finally(() => setPending(null));
                  }}
                >
                  {pending === 'clear' ? copy.clearing : copy.clearKey}
                </Button>
              )}
            </div>
            {testResult && (
              <p
                role="status"
                className={`text-[13px] leading-[18px] ${testResult.ok ? 'text-success' : 'text-danger'}`}
              >
                {testResult.ok
                  ? `${copy.credentialValid} · ${copy.resultCount(testResult.results.length)}`
                  : `${copy.testFailed} · ${copy.errors[testResult.reason]}`}
              </p>
            )}
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={groups.searchBehavior} description={groups.searchBehaviorHelp}>
        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              {copy.testSearch}
              <span className={`${statusChipClass} ${statusChipToneClass('neutral')}`}>
                {copy.beta}
              </span>
            </span>
          }
          description={copy.testSearchHelp}
          layout="stacked"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={copy.testSearch}
              className="w-72"
              placeholder={copy.queryPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setRows(null);
                setQueryError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || busy || queryBlocked) return;
                event.preventDefault();
                runQuery();
              }}
            />
            <Button size="sm" disabled={busy || queryBlocked !== null} onClick={runQuery}>
              {pending === 'query' ? copy.searching : copy.search}
            </Button>
            {queryBlocked && (
              <small className="text-[12px] leading-4 text-text-muted">{queryBlocked}</small>
            )}
          </div>
          {queryError && (
            <p role="alert" className="text-[13px] leading-[18px] text-danger">
              {copy.queryFailed(queryError)}
            </p>
          )}
          {rows !== null && rows.length === 0 && !queryError && (
            <p className="text-[13px] leading-[18px] text-text-secondary">{copy.noResults}</p>
          )}
          {rows !== null && rows.length > 0 && (
            <ul className="flex flex-col gap-3" aria-label={copy.resultsAria}>
              {safeRows(rows).map((row, index) => (
                <li key={`${row.url}-${index}`} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="text-left text-sm leading-5 text-accent underline-offset-2 hover:underline"
                    onClick={() => openExternal(row.url)}
                  >
                    {row.title}
                  </button>
                  <small className="text-[12px] leading-4 text-text-muted">{row.source}</small>
                  <p className="text-[13px] leading-[18px] text-text-secondary">{row.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
      </SettingsSection>
    </>
  );

  function runQuery() {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    const observedVersion = tavily.credentialVersion;
    setPending('query');
    setQueryError(null);
    setRows(null);
    void queryWebSearch(
      { provider: webSearch.defaultProvider, query: trimmed, limit: 5 },
      props.host,
    )
      .then((result) => {
        if (result.ok) setRows(result.results);
        else setQueryError(copy.errors[result.reason]);
        if (!usingModel && hasUsableKey) {
          void recordStatus(webSearchCredentialStatusFromResponse(result), observedVersion);
        }
      })
      .catch((error: unknown) => report(copy.testError, error))
      .finally(() => setPending(null));
  }
}

/**
 * Rows come back over IPC, so the renderer re-checks them: a non-http(s) or
 * malformed URL is dropped outright and every text cell is redacted before it
 * reaches the DOM. The main-process client filters first; this is the second
 * of the two, and the one that runs where the value is rendered.
 */
function safeRows(rows: readonly WebSearchResultRow[]) {
  return rows.flatMap((row) => {
    const normalized = normalizeSearchUrl(row.url);
    if (!normalized.ok) return [];
    return [
      {
        title: redactSecrets(row.title),
        url: redactSecrets(normalized.value),
        source: redactSecrets(row.source),
        snippet: redactSecrets(row.snippet),
      },
    ];
  });
}

function credentialStatusChip(
  source: WebSearchCredentialSource,
  enabled: boolean,
  status: WebSearchCredentialStatus,
  copy: WebSearchSettingsCopy,
): { label: string; tone: ChipTone } {
  if (source === 'none') return { label: copy.statuses.not_configured, tone: 'attention' };
  if (status === 'valid') {
    return enabled
      ? { label: copy.statuses.validEnabled, tone: 'success' }
      : // Valid credentials with the feature off is a fact the user set, not a
        // problem to flag.
        { label: copy.statuses.validDisabled, tone: 'neutral' };
  }
  if (status === 'invalid_credentials') {
    return { label: copy.statuses.invalid_credentials, tone: 'error' };
  }
  if (status === 'rate_limited') return { label: copy.statuses.rate_limited, tone: 'attention' };
  if (status === 'timeout') return { label: copy.statuses.timeout, tone: 'attention' };
  if (status === 'network_error') return { label: copy.statuses.network_error, tone: 'attention' };
  if (status === 'not_configured')
    return { label: copy.statuses.not_configured, tone: 'attention' };
  // Configured but never tested: setup is unfinished, and the amber says so.
  return enabled
    ? { label: copy.statuses.unknownEnabled, tone: 'attention' }
    : { label: copy.statuses.untested, tone: 'attention' };
}

function credentialSourceLabel(
  source: WebSearchCredentialSource,
  hasStoredKey: boolean,
  copy: WebSearchSettingsCopy,
): string {
  if (source === 'env') return hasStoredKey ? copy.sources.envWithSaved : copy.sources.env;
  if (source === 'saved') return copy.sources.saved;
  return copy.sources.none;
}

/** A labelled `<select>`-shaped control over the shared Select primitive. */
function Select(props: {
  label: string;
  value: string;
  disabled?: boolean;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <SelectRoot value={props.value} disabled={props.disabled} onValueChange={props.onChange}>
      <SelectTrigger aria-label={props.label} className={settingsFieldWidthClass}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
