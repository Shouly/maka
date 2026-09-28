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

// Signing in to a provider that authenticates with an account rather than a key.
//
// One component for all three, because the flow is one flow; what differs is
// declared by `oauthProviderCapabilities`, not tested against provider ids
// here. Only GitHub Copilot can adopt a credential the local `gh` CLI already
// holds, and only OpenAI Codex reports who is signed in.
//
// Every state on screen is one the bridge reported. There is deliberately no
// optimistic "signed in!" after the browser opens: the Host is still polling
// the provider at that point, and a panel that claims success before the
// completion call returns is how a failed sign-in reads as a working one until
// the first turn fails.

import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { RowActionsMenu } from '../settings-kit.js';
import { SettingsRow } from '../settings-row.js';
import { ProviderTile } from './provider-tile.js';
import { cn } from '../../../lib/cn.js';
import { providerDisplay } from '../../../lib/ported/provider-display-copy.js';
import { useOAuthLoginFlow } from '../../../hooks/use-oauth-login-flow.js';
import { oauthFailureMessage } from '../../../lib/ported/provider-oauth-message.js';
import { toast } from '../../../store/toast-store.js';
import {
  importLocalCopilotCredential,
  oauthProviderCapabilities,
  type DesktopOAuthConnectionIdentity,
  type InteractiveOAuthProviderType,
} from '../../../bridge/oauth.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

export function OAuthPanel(props: {
  provider: InteractiveOAuthProviderType;
  host: DesktopRuntimeHostRef | undefined;
  /** Absent for "add an account"; present to manage one that already exists. */
  connectionId?: string;
  connectionName?: string;
  onSignedIn: (connection: DesktopOAuthConnectionIdentity) => void | Promise<void>;
  onSignedOut: () => void | Promise<void>;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const section = copy.oauthSection;
  const display = providerDisplay(props.provider, locale);
  const capabilities = oauthProviderCapabilities(props.provider);
  const flow = useOAuthLoginFlow({
    provider: props.provider,
    host: props.host,
    ...(props.connectionId ? { connectionId: props.connectionId } : {}),
    onSignedIn: props.onSignedIn,
    onSignedOut: props.onSignedOut,
  });

  const runtimeState = flow.account?.runtimeState;
  const busy = flow.pending !== null;
  const signedIn = runtimeState === 'authenticated' || runtimeState === 'refreshing';
  // Only an explicit `false` hides sign-in; `undefined` is "the Host has not
  // answered yet" and must not remove an action that would work.
  const enrollmentBlocked = flow.enrollmentEnabled === false;

  const statusLabel =
    flow.stateHint !== null
      ? section.waitingAuthorization
      : runtimeState === undefined
        ? undefined
        : runtimeState === 'authenticated'
          ? section.signedIn
          : runtimeState === 'refreshing'
            ? section.refreshing
            : runtimeState === 'authorizing'
              ? section.authorizing
              : runtimeState === 'refresh_failed'
                ? section.refreshTokenFailed
                : runtimeState === 'storage_failed'
                  ? section.storageFailed(display.name)
                  : section.signedOut(display.name);

  const statusTone =
    flow.stateHint !== null || runtimeState === 'authorizing' || runtimeState === 'refreshing'
      ? 'active'
      : runtimeState === 'authenticated'
        ? 'success'
        : runtimeState === 'refresh_failed' || runtimeState === 'storage_failed'
          ? 'error'
          : 'neutral';

  const importLocal = () => {
    void importLocalCopilotCredential(props.host)
      .then((result) => {
        if (!result.ok) {
          toast({
            title: section.copilotActionFailed,
            description: oauthFailureMessage(result, section.copilotActionFailed, locale),
            variant: 'destructive',
          });
          return;
        }
        return flow.reloadAccount();
      })
      .catch((error: unknown) => props.onError(section.copilotActionFailed, error));
  };

  // Codex is the only projection that carries an identity; the other two
  // report a runtime state and nothing about who is behind it.
  const identity =
    capabilities.reportsAccountIdentity && signedIn && flow.account
      ? [
          'email' in flow.account ? flow.account.email : undefined,
          'plan' in flow.account ? flow.account.plan : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-3">
          <ProviderTile type={props.provider} />
          <span className="truncate">{props.connectionName ?? display.name}</span>
          {statusLabel && (
            <span className={cn(statusChipClass, statusChipToneClass(statusTone))} role="status">
              {statusLabel}
            </span>
          )}
        </span>
      }
      description={
        <span className="flex flex-col gap-0.5 pl-9">
          <span>{identity || display.description}</span>
          {flow.accountLoading && props.connectionId !== undefined && (
            <Skeleton className="h-4 w-40 rounded-md" />
          )}
          {flow.stateHint !== null && (
            <span>
              {section.deviceCode}
              <span className="font-mono text-text-primary">{flow.stateHint}</span>
            </span>
          )}
          {enrollmentBlocked && <span role="status">{copy.oauthFlow.enrollmentDisabled}</span>}
          {flow.errorMessage && (
            <span role="alert" className="text-danger">
              {flow.errorMessage}
            </span>
          )}
        </span>
      }
      control={
        <span className="flex items-center gap-2">
          {flow.stateHint !== null ? (
            <Button variant="secondary" onClick={flow.cancelLogin}>
              {copy.detail.cancel}
            </Button>
          ) : props.connectionId !== undefined && signedIn ? (
            <RowActionsMenu
              label={section.manageAccount(props.connectionName ?? display.name)}
              actions={[
                {
                  label: copy.detail.relogin,
                  disabled: busy || !props.host || enrollmentBlocked,
                  onSelect: () => void flow.startLogin(),
                },
                {
                  label: flow.pending === 'logout' ? section.loggingOut : section.logout,
                  disabled: busy,
                  danger: true,
                  onSelect: () => void flow.signOut(),
                },
              ]}
            />
          ) : (
            <>
              {capabilities.canImportLocalCredential && (
                <Button variant="secondary" disabled={busy || !props.host} onClick={importLocal}>
                  {section.importCredential}
                </Button>
              )}
              {!enrollmentBlocked && (
                <Button
                  variant="secondary"
                  disabled={busy || !props.host}
                  onClick={() => void flow.startLogin()}
                >
                  {busy && flow.pending === 'login' ? section.openingBrowser : section.signIn}
                </Button>
              )}
            </>
          )}
        </span>
      }
    />
  );
}
