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

// Models: every model the organization offers, whichever provider it comes
// from. A row's switch publishes it to employees at once; the row (or its
// menu) opens its settings; its provider's name opens the provider. Models
// are added from a provider's page, where its list is read.

import { useState } from 'react';
import type { ConsoleModel } from '../../../src/admin-console/types.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsTable,
  SettingsTableActionsCell,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { Input } from '@desktop/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@desktop/components/ui/select.js';
import { Switch } from '@desktop/components/ui/switch.js';
import { api } from '../api.js';
import { useConsole } from '../context.js';
import { formatNumber } from '../format.js';
import { navigate } from '../router.js';
import {
  Chip,
  LoadFailed,
  LoadingRows,
  reportWriteFailure,
  smallButton,
  usePendingSwitches,
} from '../ui.js';
import { useResource } from '../use-resource.js';
import { DeleteModelDialog, ModelSettingsDialog, patchModel, withModel } from './model-settings.js';

/** A search box from this many models; a provider filter once two providers have models. */
const SEARCH_FROM = 9;
const ALL = 'all';

export function ModelsPage() {
  const { copy, locale } = useConsole();
  const text = copy.models;
  const models = useResource(() => api.get<ConsoleModel[]>('/models'), 'models');
  const switches = usePendingSwitches();
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [editingId, setEditingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();

  const all = models.data;
  const providers = [
    ...new Map((all ?? []).map((model) => [model.provider.id, model.provider.name])),
  ].sort((a, b) => a[1].localeCompare(b[1], locale));
  const filterable = providers.length > 1;
  const searchable = (all?.length ?? 0) >= SEARCH_FROM;
  const provider =
    filterable && providers.some(([id]) => id === providerFilter) ? providerFilter : ALL;
  const needle = searchable ? query.trim().toLowerCase() : '';
  const shown = all?.filter(
    (model) =>
      (provider === ALL || model.provider.id === provider) &&
      (!needle ||
        model.displayName.toLowerCase().includes(needle) ||
        model.providerModel.toLowerCase().includes(needle)),
  );
  const editing = all?.find((model) => model.id === editingId);
  const deleting = all?.find((model) => model.id === deletingId);
  const replaceModel = (next: ConsoleModel) => models.update((list) => withModel(list, next));
  const openProvider = (model: ConsoleModel) =>
    navigate({ page: 'model-provider', id: model.provider.id });

  return (
    <>
      <SettingsSection
        title={text.title}
        description={text.help}
        action={
          (searchable || filterable) && (
            <span className="flex items-center gap-2">
              {filterable && (
                <Select value={provider} onValueChange={setProviderFilter}>
                  <SelectTrigger variant="ghost" aria-label={text.filterProvider}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{text.allProviders}</SelectItem>
                    {providers.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {searchable && (
                <Input
                  type="search"
                  aria-label={text.search}
                  placeholder={text.search}
                  className="w-56"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </span>
          )
        }
      >
        {models.error && !all ? (
          <LoadFailed error={models.error} onRetry={models.reload} />
        ) : !shown ? (
          <LoadingRows />
        ) : all?.length === 0 ? (
          <SettingsEmpty
            title={text.empty}
            body={text.emptyHelp}
            action={
              <Button {...smallButton} onClick={() => navigate({ page: 'model-providers' })}>
                {text.toProviders}
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <SettingsEmpty title={text.noMatch} />
        ) : (
          <SettingsTable
            label={text.title}
            head={
              <>
                <SettingsTableHeadCell>{text.columns.model}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-[24%]">
                  {text.columns.provider}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-28 text-right">
                  {text.columns.quota}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-28 text-right">
                  {text.columns.published}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-12" srOnly>
                  {copy.model.actions}
                </SettingsTableHeadCell>
              </>
            }
          >
            {shown.map((model) => (
              <SettingsTableRow
                key={model.id}
                onOpen={() => setEditingId(model.id)}
                openLabel={copy.common.manageAria(model.displayName)}
              >
                <SettingsTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate" title={model.displayName}>
                        {model.displayName}
                      </span>
                      {model.availability === 'provider_disabled' && (
                        <Chip tone="neutral">{text.providerDisabled}</Chip>
                      )}
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
                <SettingsTableCell className="text-text-secondary">
                  <button
                    type="button"
                    aria-label={text.openProvider(model.provider.name)}
                    title={model.provider.name}
                    className="block max-w-full cursor-pointer truncate rounded text-left outline-none hover:text-text-primary hover:underline focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProvider(model);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {model.provider.name}
                  </button>
                </SettingsTableCell>
                <SettingsTableCell className="text-right tabular-nums text-text-secondary">
                  {model.costWeight === 0
                    ? text.unmetered
                    : text.weight(formatNumber(locale, model.costWeight))}
                </SettingsTableCell>
                <SettingsTableCell
                  className="text-right"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Switch
                    aria-label={text.publishAria(model.displayName)}
                    checked={switches.checked(model.id, model.enabled)}
                    disabled={switches.busy(model.id)}
                    onCheckedChange={(enabled) =>
                      switches.run(model.id, enabled, () =>
                        patchModel(model, { enabled }).then(replaceModel, (error: unknown) =>
                          reportWriteFailure(text.toggleFailed, error, models.reload),
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
                        disabled: switches.busy(model.id),
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

      <ModelSettingsDialog
        model={editing}
        onClose={() => setEditingId(undefined)}
        onSaved={replaceModel}
        onStale={models.reload}
      />
      <DeleteModelDialog
        model={deleting}
        onClose={() => setDeletingId(undefined)}
        onDeleted={models.reload}
        onStale={models.reload}
      />
    </>
  );
}
