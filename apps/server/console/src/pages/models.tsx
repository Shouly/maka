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

// Models: what people can pick in Maka, in the order they see them. Each row
// switches its model on or off and leads to its page, where its routes and
// details are. A new model is named here and routed on its page.

import { useState } from 'react';
import type { ConsoleModel } from '../../../src/admin-console/types.js';
import {
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
} from '@desktop/components/settings/settings-kit.js';
import {
  SettingsRow,
  SettingsSection,
  settingsRowLinkClass,
} from '@desktop/components/settings/settings-row.js';
import { Anthropicon } from '@desktop/components/icons/Anthropicon.js';
import { Button } from '@desktop/components/ui/button.js';
import { Input } from '@desktop/components/ui/input.js';
import { Switch } from '@desktop/components/ui/switch.js';
import { api, segment } from '../api.js';
import { useConsole } from '../context.js';
import { navigate } from '../router.js';
import { Chip, LoadFailed, LoadingRows, reportFailure, smallButton } from '../ui.js';
import { useResource } from '../use-resource.js';

export function ModelsPage() {
  const { copy } = useConsole();
  const text = copy.models;
  const models = useResource(() => api.get<ConsoleModel[]>('/models'), 'models');
  const [adding, setAdding] = useState(false);

  return (
    <>
      <SettingsSection
        title={text.title}
        description={text.help}
        action={
          <Button {...smallButton} onClick={() => setAdding(true)}>
            {text.add}
          </Button>
        }
      >
        {models.error && !models.data ? (
          <LoadFailed error={models.error} onRetry={models.reload} />
        ) : !models.data ? (
          <LoadingRows />
        ) : models.data.length === 0 ? (
          <SettingsEmpty title={text.empty} body={text.emptyHelp} />
        ) : (
          models.data.map((model) => (
            <SettingsRow
              key={model.id}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{model.displayName}</span>
                  {model.routes.length === 0 && <Chip tone="attention">{text.noRoute}</Chip>}
                </span>
              }
              description={
                <span className="block truncate">
                  <span data-mono="true">{model.id}</span>
                  {model.routes.length > 0 &&
                    ` · ${text.via(model.routes.map((route) => route.upstreamName).join(' → '))}`}
                </span>
              }
              control={
                <span className="flex items-center gap-3">
                  <Switch
                    aria-label={text.enableAria(model.displayName)}
                    checked={model.enabled}
                    onCheckedChange={(enabled) =>
                      void api
                        .patch<ConsoleModel[]>(`/models/${segment(model.id)}`, { enabled })
                        .then(models.replace)
                        .catch((error: unknown) => reportFailure(text.toggleFailed, error))
                    }
                  />
                  <button
                    type="button"
                    className={settingsRowLinkClass}
                    aria-label={copy.common.manageAria(model.displayName)}
                    onClick={() => navigate({ page: 'model', id: model.id })}
                  >
                    {copy.common.manage}
                    <Anthropicon name="caretRight" size={12} />
                  </button>
                </span>
              }
            />
          ))
        )}
      </SettingsSection>
      <AddModelDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(id, next) => {
          models.replace(next);
          navigate({ page: 'model', id });
        }}
      />
    </>
  );
}

function AddModelDialog(props: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string, models: ConsoleModel[]) => void;
}) {
  const { copy } = useConsole();
  const text = copy.models;
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setId('');
    setName('');
    setReference('');
    props.onClose();
  };
  const submit = () => {
    const modelId = id.trim();
    setSaving(true);
    api
      .post<ConsoleModel[]>('/models', {
        id: modelId,
        protocol: 'anthropic',
        displayName: name.trim() || modelId,
        ...(reference.trim() ? { capabilities: { referenceModelId: reference.trim() } } : {}),
      })
      .then((next) => {
        close();
        props.onAdded(modelId, next);
      })
      .catch((error: unknown) => reportFailure(text.addFailed, error))
      .finally(() => setSaving(false));
  };

  return (
    <SettingsModal
      open={props.open}
      onOpenChange={(open) => !open && close()}
      title={text.addTitle}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button disabled={saving || !id.trim()} onClick={submit}>
            {saving ? copy.common.saving : copy.common.add}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SettingsModalField label={text.id} htmlFor="model-id" hint={text.idHelp}>
          <Input
            id="model-id"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            value={id}
            placeholder={text.idPlaceholder}
            onChange={(event) => setId(event.target.value)}
          />
        </SettingsModalField>
        <SettingsModalField label={text.name} htmlFor="model-name">
          <Input
            id="model-name"
            value={name}
            placeholder={text.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </SettingsModalField>
        <SettingsModalField
          label={text.reference}
          htmlFor="model-reference"
          hint={text.referenceHelp}
        >
          <Input
            id="model-reference"
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            value={reference}
            placeholder={text.referencePlaceholder}
            onChange={(event) => setReference(event.target.value)}
          />
        </SettingsModalField>
      </div>
    </SettingsModal>
  );
}
