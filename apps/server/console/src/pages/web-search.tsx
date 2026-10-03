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

// Web search & fetch: the organization's web service, which Maka's WebSearch
// and WebFetch use for everyone signed in. One Tavily key, checked with
// Tavily before it is saved, and a switch.

import { useRef, useState } from 'react';
import type { ConsoleWebSearch, ConsoleWebSearchPatch } from '../../../src/admin-console/types.js';
import {
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsRow, SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { Input } from '@desktop/components/ui/input.js';
import { Switch } from '@desktop/components/ui/switch.js';
import { api, errorCode, isStale } from '../api.js';
import { useConsole } from '../context.js';
import {
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
import { API_KEY_MAX, isApiKey, isSearchKey } from '../validation.js';

const save = (patch: ConsoleWebSearchPatch) => api.put<ConsoleWebSearch>('/web-search', patch);

export function WebSearchPage() {
  const { copy } = useConsole();
  const text = copy.webSearch;
  const settings = useResource(() => api.get<ConsoleWebSearch>('/web-search'), 'web-search');
  const switches = usePendingSwitches();
  // Each opening of the key dialog starts it afresh.
  const [keyDialog, setKeyDialog] = useState(0);
  const [editingKey, setEditingKey] = useState(false);
  const openKey = () => {
    setKeyDialog((count) => count + 1);
    setEditingKey(true);
  };

  const current = settings.data;
  return (
    <>
      <SettingsSection title={text.title} description={text.help}>
        {settings.error && !current ? (
          <LoadFailed error={settings.error} onRetry={settings.reload} />
        ) : !current ? (
          <LoadingRows rows={3} />
        ) : !current.configured ? (
          <SettingsEmpty
            title={text.empty}
            body={text.emptyHelp}
            action={
              <Button {...smallButton} onClick={openKey}>
                {text.addKey}
              </Button>
            }
          />
        ) : (
          <>
            <SettingsRow
              title={text.service}
              description={text.serviceHelp}
              control={<span className="text-text-secondary">Tavily</span>}
            />
            <SettingsRow
              title={text.enabled}
              description={
                switches.checked('web-search', current.enabled)
                  ? text.enabledHelp
                  : text.disabledHelp
              }
              control={
                <Switch
                  aria-label={text.enableAria}
                  checked={switches.checked('web-search', current.enabled)}
                  disabled={switches.busy('web-search')}
                  onCheckedChange={(next) =>
                    switches.run('web-search', next, () =>
                      save({ expectedRevision: current.revision, enabled: next }).then(
                        settings.replace,
                        (error: unknown) =>
                          reportWriteFailure(text.toggleFailed, error, settings.reload),
                      ),
                    )
                  }
                />
              }
            />
            <SettingsRow
              title={text.apiKey}
              description={text.keyHelp}
              control={
                <Button {...smallButton} onClick={openKey}>
                  {text.replaceKey}
                </Button>
              }
            />
          </>
        )}
      </SettingsSection>
      {editingKey && current && (
        <KeyDialog
          key={keyDialog}
          settings={current}
          onClose={() => setEditingKey(false)}
          onSaved={settings.replace}
          onStale={() => void settings.reload()}
        />
      )}
    </>
  );
}

function KeyDialog(props: {
  settings: ConsoleWebSearch;
  onClose: () => void;
  onSaved: (settings: ConsoleWebSearch) => void;
  onStale: () => void;
}) {
  const { copy } = useConsole();
  const text = copy.webSearch;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const close = () => {
    if (!inFlight.current) props.onClose();
  };
  const submit = () => {
    if (inFlight.current) return;
    const apiKey = value.trim();
    if (!apiKey) return setError(copy.addProvider.required);
    if (!isApiKey(apiKey)) return setError(copy.addProvider.keyTooLong(String(API_KEY_MAX)));
    if (!isSearchKey(apiKey)) return setError(text.invalidKey);
    inFlight.current = true;
    setSaving(true);
    save({ expectedRevision: props.settings.revision, apiKey })
      .then((saved) => {
        props.onSaved(saved);
        props.onClose();
        reportDone(text.saved);
      })
      .catch((failure: unknown) => {
        if (errorCode(failure) === 'credentials_rejected') {
          setError(text.rejected);
        } else if (isStale(failure)) {
          props.onStale();
          reportStale(failure);
        } else {
          reportFailure(text.saveFailed, failure);
        }
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
      title={props.settings.configured ? text.replaceKeyTitle : text.addKeyTitle}
      description={text.keyDialogHelp}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="web-search-key-form" disabled={saving}>
            {saving ? text.verifying : copy.common.save}
          </Button>
        </>
      }
    >
      <form
        id="web-search-key-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={saving} className="min-w-0">
          <SettingsModalField
            label={text.newApiKey}
            htmlFor="web-search-key"
            hint={
              error ? (
                <span role="alert" className="text-danger">
                  {error}
                </span>
              ) : (
                text.keyHint
              )
            }
          >
            <Input
              id="web-search-key"
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
          </SettingsModalField>
        </fieldset>
      </form>
    </SettingsModal>
  );
}
