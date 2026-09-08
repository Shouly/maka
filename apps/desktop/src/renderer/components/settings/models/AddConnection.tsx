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

// Adding a connection: sign in to an account, or pick a provider and configure it.
//
// The two are separated because they end differently. An account sign-in
// CREATES the connection as a side effect of authorizing — there is no form and
// nothing to save — while everything else is a form the user fills in. Mixing
// them into one grid produced cards that looked the same and behaved nothing
// alike.
//
// Existing account connections are managed here too, next to the sign-in that
// made them: signing out is the same panel's other button, and putting it on
// the connection's detail page would leave the sign-in and the sign-out on two
// different screens.

import { useUiLocale } from '@maka/ui';
import type { ProjectedLlmConnection, ProviderType } from '@maka/core/llm-connections';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { ProviderCatalog } from './ProviderCatalog.js';
import { OAuthPanel } from './OAuthPanel.js';
import { SettingsSection } from '../settings-row.js';
import { connectionsStore } from '../../../store/index.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import type { InteractiveOAuthProviderType } from '../../../bridge/oauth.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

/** The three providers whose credential is an account login rather than a key. */
const OAUTH_PROVIDERS: readonly InteractiveOAuthProviderType[] = [
  'openai-codex',
  'xai-oauth',
  'github-copilot',
];

export function AddConnection(props: {
  host: DesktopRuntimeHostRef | undefined;
  connections: readonly ProjectedLlmConnection[];
  onBack: () => void;
  onPickProvider: (providerType: ProviderType) => void;
  onConnected: (connectionId: string) => void;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);

  return (
    <div data-maka-contract="add-connection">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <Anthropicon name="arrowLeft" size={16} />
          <span className="ml-1.5">{copy.panel.backToList}</span>
        </Button>
      </div>

      <SettingsSection title={copy.add.accountTitle} description={copy.add.accountDetail}>
        {OAUTH_PROVIDERS.flatMap((provider) => {
          const existing = props.connections.filter((row) => row.providerType === provider);
          const managed = existing.map((connection) => (
            <OAuthPanel
              key={`${provider}:${connection.connectionId}`}
              provider={provider}
              host={props.host}
              connectionId={connection.connectionId}
              connectionName={connection.name}
              onSignedIn={() => connectionsStore.refresh()}
              onSignedOut={() => connectionsStore.refresh()}
              onError={props.onError}
            />
          ));
          return [
            ...managed,
            <OAuthPanel
              key={`${provider}:add`}
              provider={provider}
              host={props.host}
              onSignedIn={async (connection) => {
                await connectionsStore.refresh();
                props.onConnected(connection.connectionId);
              }}
              onSignedOut={() => connectionsStore.refresh()}
              onError={props.onError}
            />,
          ];
        })}
      </SettingsSection>

      <SettingsSection title={copy.panel.addConnection} description={copy.panel.addHelp}>
        <div className="py-3">
          <ProviderCatalog onPick={props.onPickProvider} />
        </div>
      </SettingsSection>
    </div>
  );
}
