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

// The three interactive OAuth namespaces of the preload bridge, wrapped as one.
//
// `openAiCodex`, `xaiOAuth` and `githubCopilotSubscription` are three separate
// namespaces with, method for method, the same shape: get an authorization
// request id, open the provider page, complete or cancel that request, read the
// account state, refresh, sign out. Settings › Models draws ONE panel for all
// three, so wrapping them one namespace at a time would mean three copies of
// that panel differing only in which object they reach for.
//
// What differs is not the shape but the extras: only GitHub Copilot can adopt a
// credential the local `gh` CLI already holds (`connectExistingLogin`), and only
// OpenAI Codex reports an account (email / plan / picture). Those stay typed as
// themselves — `oauthProviderCapabilities` states which provider has which, so a
// panel asks the capability rather than testing the provider id.
//
// The URL itself never reaches the renderer: `getAuthUrl` returns an opaque
// `authRequestId` plus the short `stateHint` the provider page asks the user to
// confirm, and `openAuthUrl` looks the URL up by that id in the main process
// (`packages/core/src/oauth-subscription.ts` says why).

import type {
  AuthorizationUrlPayload,
  SubscriptionActionResult,
} from '@maka/core/oauth-subscription';
import type { InteractiveOAuthProviderType } from '@maka/core/llm-connections';
import type {
  DesktopOAuthAuthorizationResult,
  DesktopOAuthAuthorizationStartResult,
  DesktopOAuthConnectionIdentity,
  DesktopOAuthLoginTarget,
  DesktopRuntimeHostRef,
  MakaBridge,
} from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

export type {
  AuthorizationUrlPayload,
  DesktopOAuthAuthorizationResult,
  DesktopOAuthAuthorizationStartResult,
  DesktopOAuthConnectionIdentity,
  DesktopOAuthLoginTarget,
  InteractiveOAuthProviderType,
  SubscriptionActionResult,
};

/** The account state each namespace projects, as a union over the three. */
export type OAuthAccountState =
  | Awaited<ReturnType<MakaBridge['openAiCodex']['getAccountState']>>
  | Awaited<ReturnType<MakaBridge['xaiOAuth']['getAccountState']>>
  | Awaited<ReturnType<MakaBridge['githubCopilotSubscription']['getAccountState']>>;

/** The signed-in half of {@link OAuthAccountState}: the shape with a provider. */
export type OAuthAccountProjection = Extract<OAuthAccountState, { provider: string }>;

/** True for the projection half; false for a `{ ok: false }` failure envelope. */
export function isOAuthAccountProjection(
  state: OAuthAccountState,
): state is OAuthAccountProjection {
  return 'provider' in state;
}

const NAMESPACE = {
  'openai-codex': 'openAiCodex',
  'xai-oauth': 'xaiOAuth',
  'github-copilot': 'githubCopilotSubscription',
} as const satisfies Record<InteractiveOAuthProviderType, keyof MakaBridge>;

/**
 * The three namespaces have identical method sets apart from the two extras
 * below, so the shared surface is typed off one of them rather than restated.
 */
type SharedOAuthNamespace = Omit<MakaBridge['xaiOAuth'], 'getAccountState'>;

function namespaceOf(provider: InteractiveOAuthProviderType): SharedOAuthNamespace {
  return requireNamespace(NAMESPACE[provider]) as SharedOAuthNamespace;
}

/** What a provider's flow can do beyond the shared six methods. */
export function oauthProviderCapabilities(provider: InteractiveOAuthProviderType): {
  readonly canImportLocalCredential: boolean;
  readonly reportsAccountIdentity: boolean;
} {
  return {
    // `gh auth login` may already hold a Copilot credential on this machine.
    canImportLocalCredential: provider === 'github-copilot',
    // Only the Codex projection carries email / plan / picture.
    reportsAccountIdentity: provider === 'openai-codex',
  };
}

/**
 * Begin an authorization round. The result is either the request id plus the
 * connection identity the Host allocated, or a failure envelope — a start that
 * failed is a value here, not a rejection, because the panel has to say which
 * of the closed reasons it was.
 */
export function startOAuthAuthorization(
  provider: InteractiveOAuthProviderType,
  target: DesktopOAuthLoginTarget,
  host?: DesktopRuntimeHostRef,
): Promise<DesktopOAuthAuthorizationStartResult> {
  return namespaceOf(provider).getAuthUrl(host, target);
}

/** Open the provider page for a started request. The URL never crosses here. */
export function openOAuthAuthorizationUrl(
  provider: InteractiveOAuthProviderType,
  authRequestId: string,
  host?: DesktopRuntimeHostRef,
): Promise<SubscriptionActionResult> {
  return namespaceOf(provider).openAuthUrl(authRequestId, host);
}

/** Wait for the round the user is completing in the browser to settle. */
export function completeOAuthAuthorization(
  provider: InteractiveOAuthProviderType,
  authRequestId: string,
  host?: DesktopRuntimeHostRef,
): Promise<DesktopOAuthAuthorizationResult> {
  return namespaceOf(provider).completeAuthorization(authRequestId, host);
}

/** Abandon an in-flight round. Safe to call when none is active. */
export function cancelOAuthAuthorization(
  provider: InteractiveOAuthProviderType,
  authRequestId?: string,
  host?: DesktopRuntimeHostRef,
): Promise<{ ok: true }> {
  return namespaceOf(provider).cancelAuthorization(authRequestId, host);
}

/**
 * The account behind one connection, as the Host sees it right now.
 *
 * Read this rather than inferring sign-in from the connection existing: a
 * connection whose refresh failed still exists and still cannot send.
 */
export function getOAuthAccountState(
  provider: InteractiveOAuthProviderType,
  connectionId: string,
  host?: DesktopRuntimeHostRef,
): Promise<OAuthAccountState> {
  switch (provider) {
    case 'openai-codex':
      return requireNamespace('openAiCodex').getAccountState(host, connectionId);
    case 'xai-oauth':
      return requireNamespace('xaiOAuth').getAccountState(host, connectionId);
    case 'github-copilot':
      return requireNamespace('githubCopilotSubscription').getAccountState(host, connectionId);
  }
}

/**
 * Whether this install offers the provider's sign-in at all.
 *
 * A build can ship with a flow compiled in and switched off; the panel says so
 * instead of opening a browser window that will be refused.
 */
export function getOAuthEnrollmentState(
  provider: InteractiveOAuthProviderType,
  host?: DesktopRuntimeHostRef,
): Promise<{ enabled: boolean }> {
  return namespaceOf(provider).getEnrollmentState(host);
}

/** Force a token refresh for one connection. */
export function refreshOAuthTokens(
  provider: InteractiveOAuthProviderType,
  connectionId: string,
  host?: DesktopRuntimeHostRef,
): Promise<SubscriptionActionResult> {
  return namespaceOf(provider).refreshTokens(host, connectionId);
}

/** Sign out of one connection, dropping the local credential with it. */
export function signOutOAuthConnection(
  provider: InteractiveOAuthProviderType,
  connectionId: string,
  host?: DesktopRuntimeHostRef,
): Promise<SubscriptionActionResult> {
  return namespaceOf(provider).logout(host, connectionId);
}

/**
 * Adopt the Copilot credential the local `gh` CLI already holds.
 *
 * GitHub Copilot only — `oauthProviderCapabilities` is how a panel decides to
 * offer it, so the other two never reach this call.
 */
export function importLocalCopilotCredential(
  host?: DesktopRuntimeHostRef,
): Promise<SubscriptionActionResult> {
  return requireNamespace('githubCopilotSubscription').connectExistingLogin(host);
}
