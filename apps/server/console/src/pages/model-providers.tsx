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

// LLM Provider: the organization's accounts with model services, one row
// each. A row's switch turns the account on or off at once; the row opens
// it. Adding one chooses the service, takes its key, reads the models it
// offers and publishes the ones chosen — all in one dialog.

import { useState } from 'react';
import type { ConsoleModelProvider } from '../../../src/admin-console/types.js';
import {
  SettingsEmpty,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { Switch } from '@desktop/components/ui/switch.js';
import { api, segment } from '../api.js';
import { useConsole } from '../context.js';
import { IntegrationMark, integrationLabel } from '../integrations.js';
import { navigate } from '../router.js';
import {
  LoadFailed,
  LoadingRows,
  reportWriteFailure,
  smallButton,
  usePendingSwitches,
} from '../ui.js';
import { useResource } from '../use-resource.js';
import { AddProviderDialog } from './add-provider.js';

/** Turn a provider on or off; the answer is the provider as it now is. */
export function setProviderEnabled(
  provider: ConsoleModelProvider,
  enabled: boolean,
): Promise<ConsoleModelProvider> {
  return api.patch<ConsoleModelProvider>(`/model-providers/${segment(provider.id)}`, {
    expectedRevision: provider.revision,
    enabled,
  });
}

export function ModelProvidersPage() {
  const { copy } = useConsole();
  const text = copy.providers;
  const providers = useResource(
    () => api.get<ConsoleModelProvider[]>('/model-providers'),
    'model-providers',
  );
  const switches = usePendingSwitches();
  // Each opening of the add dialog starts it afresh.
  const [adding, setAdding] = useState(0);
  const add = () => setAdding((count) => count + 1);

  return (
    <>
      <SettingsSection
        title={text.title}
        description={text.help}
        action={
          <Button {...smallButton} onClick={add}>
            {text.add}
          </Button>
        }
      >
        {providers.error && !providers.data ? (
          <LoadFailed error={providers.error} onRetry={providers.reload} />
        ) : !providers.data ? (
          <LoadingRows />
        ) : providers.data.length === 0 ? (
          <SettingsEmpty
            title={text.empty}
            body={text.emptyHelp}
            action={
              <Button {...smallButton} onClick={add}>
                {text.add}
              </Button>
            }
          />
        ) : (
          <SettingsTable
            label={text.title}
            head={
              <>
                <SettingsTableHeadCell>{text.columns.provider}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-[32%]">
                  {text.columns.models}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-20 text-right">
                  {text.columns.enabled}
                </SettingsTableHeadCell>
              </>
            }
          >
            {providers.data.map((provider) => (
              <SettingsTableRow
                key={provider.id}
                onOpen={() => navigate({ page: 'model-provider', id: provider.id })}
                openLabel={text.open(provider.name)}
              >
                <SettingsTableCell>
                  <span className="flex min-w-0 items-center gap-3">
                    <IntegrationMark integration={provider.integration} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate" title={provider.name}>
                        {provider.name}
                      </span>
                      <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                        {integrationLabel(copy, provider.integration)}
                      </span>
                    </span>
                  </span>
                </SettingsTableCell>
                <SettingsTableCell className="text-text-secondary">
                  {text.summary(provider.modelCount, provider.enabled)}
                </SettingsTableCell>
                <SettingsTableCell
                  className="text-right"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Switch
                    aria-label={text.enableAria(provider.name)}
                    checked={switches.checked(provider.id, provider.enabled)}
                    disabled={switches.busy(provider.id)}
                    onCheckedChange={(enabled) =>
                      switches.run(provider.id, enabled, () =>
                        setProviderEnabled(provider, enabled).then(
                          (next) =>
                            providers.update((list) =>
                              list.map((entry) => (entry.id === next.id ? next : entry)),
                            ),
                          (error: unknown) =>
                            reportWriteFailure(text.toggleFailed, error, providers.reload),
                        ),
                      )
                    }
                  />
                </SettingsTableCell>
              </SettingsTableRow>
            ))}
          </SettingsTable>
        )}
      </SettingsSection>

      {adding > 0 && (
        <AddProviderDialog
          key={adding}
          onClose={() => setAdding(0)}
          onCreated={(providerId) => navigate({ page: 'model-provider', id: providerId })}
          onSettled={providers.reload}
        />
      )}
    </>
  );
}
