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

// The company account, owned by the main process (design §4.2–4.3).
//
// Sign-in is OAuth for native apps: the system browser opens the server's
// authorize page with a PKCE challenge and a loopback redirect; the code that
// comes back is exchanged, with its verifier, for a 15-minute access token and
// a refresh token. The refresh token stays here, sealed by the OS keychain;
// the Runtime Host will ask for access tokens as it needs them.

import { createHash, randomBytes } from 'node:crypto';
import {
  CLIENT_VERSION_HEADER,
  DESKTOP_CLIENT_ID,
  decodeTokenResponse,
  PLATFORM_API_VERSION,
  PLATFORM_METADATA_PATH,
  type PlatformIdentityProvider,
  type PlatformMe,
  type PlatformMetadata,
  type TokenResponse,
  versionAtLeast,
} from '@maka/platform-protocol';
import type {
  OrgAccountError,
  OrgAccountProfile,
  OrgAccountSetServerResult,
  OrgAccountState,
} from '../../shared/org-account.js';
import { type LoopbackPage, startLoopbackListener } from './loopback-listener.js';
import type { OrgAccountStore, StoredSession } from './org-account-store.js';

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
/** Refresh this long before the access token expires. */
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;
const SERVER_ERRORS: readonly OrgAccountError[] = [
  'domain_not_allowed',
  'email_not_verified',
  'account_deactivated',
  'identity_conflict',
  'provider_error',
];

export class OrgAccountUnavailable extends Error {
  constructor(readonly reason: OrgAccountError | 'signed_out') {
    super(`Company account unavailable: ${reason}`);
  }
}

class SignInFailed extends Error {
  constructor(readonly reason: OrgAccountError) {
    super(reason);
  }
}

export interface OrgAccountServiceDeps {
  readonly store: OrgAccountStore;
  readonly openExternal: (url: string) => Promise<void>;
  readonly appVersion: string;
  readonly deviceName: string;
  /** The browser's page once the provider sends it back, in the app's locale at that moment. */
  readonly loopbackPage: () => LoopbackPage;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly signInTimeoutMs?: number;
  /**
   * The company server this deployment is bound to. When set, signing in is
   * required and the address cannot be changed from the app.
   */
  readonly managedServerUrl?: string;
}

/** An https origin (or loopback http for development), with an optional path prefix. */
export function normalizeServerUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
  if (url.search || url.hash || url.username || url.password) return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** A request's own timeout, and the sign-in round's cancellation when there is one. */
function requestSignal(round: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return round ? AbortSignal.any([round, timeout]) : timeout;
}

export class OrgAccountService {
  readonly #deps: OrgAccountServiceDeps;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #listeners = new Set<(state: OrgAccountState) => void>();
  #serverUrl: string | null = null;
  #session: StoredSession | undefined;
  #access: { token: string; expiresAt: number } | undefined;
  #refreshing: Promise<string> | undefined;
  #signIn: { cancel(): void } | undefined;
  #lastError: OrgAccountError | undefined;
  #expiryTimer: NodeJS.Timeout | undefined;
  #managed = false;
  #providers: readonly PlatformIdentityProvider[] | undefined;
  #signingInWith: string | undefined;

  constructor(deps: OrgAccountServiceDeps) {
    this.#deps = deps;
    this.#fetch = deps.fetch ?? fetch;
    this.#now = deps.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    const stored = await this.#deps.store.load();
    // A deployment bound to a server stays bound even when the address it was
    // given is unusable: failing open would run the app with no sign-in.
    this.#managed = this.#deps.managedServerUrl !== undefined;
    const managed = this.#deps.managedServerUrl ? normalizeServerUrl(this.#deps.managedServerUrl) : undefined;
    if (this.#managed && !managed) {
      console.error('[org-account] MAKA_ORG_SERVER_URL is not an https address (or loopback http); sign-in is blocked');
      this.#lastError = 'server_incompatible';
    }
    this.#serverUrl = this.#managed ? (managed ?? null) : stored.serverUrl;
    // A sign-in belongs to the server it was made with.
    if (
      stored.session &&
      stored.session.refreshExpiresAt > this.#now() &&
      stored.serverUrl === this.#serverUrl
    ) {
      this.#session = stored.session;
      this.#armExpiry();
    }
    this.#emit();
    if (!this.#session) void this.refresh();
  }

  /** Load the server's sign-in options again (the retry after "cannot reach the server"). */
  async refresh(): Promise<void> {
    const serverUrl = this.#serverUrl;
    if (!serverUrl) return;
    try {
      const metadata = await this.#metadata(serverUrl);
      if (this.#serverUrl !== serverUrl) return;
      this.#providers = metadata.identityProviders;
      // The server answered, and answered this version: those reasons are over.
      if (
        this.#lastError === 'server_unreachable' ||
        this.#lastError === 'server_incompatible' ||
        this.#lastError === 'upgrade_required'
      ) {
        this.#lastError = undefined;
      }
    } catch (error) {
      if (this.#serverUrl !== serverUrl) return;
      this.#providers = undefined;
      this.#lastError = error instanceof SignInFailed ? error.reason : 'server_unreachable';
    }
    this.#emit();
  }

  state(): OrgAccountState {
    const enforced = this.#managed;
    if (this.#signIn && this.#serverUrl) {
      return {
        enforced,
        status: 'signing_in',
        serverUrl: this.#serverUrl,
        ...(this.#signingInWith ? { provider: this.#signingInWith } : {}),
        ...(this.#providers ? { providers: this.#providers } : {}),
      };
    }
    if (this.#session && this.#serverUrl) {
      return {
        enforced,
        status: 'signed_in',
        serverUrl: this.#serverUrl,
        profile: this.#session.profile,
        signInExpiresAt: this.#session.refreshExpiresAt,
        remembered: this.#deps.store.remembers,
      };
    }
    return {
      enforced,
      status: 'signed_out',
      serverUrl: this.#serverUrl,
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      ...(this.#providers ? { providers: this.#providers } : {}),
    };
  }

  subscribe(listener: (state: OrgAccountState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async setServerUrl(value: string): Promise<OrgAccountSetServerResult> {
    if (this.#managed) return { ok: false, reason: 'managed' };
    if (this.#session || this.#signIn) return { ok: false, reason: 'signed_in' };
    const normalized = normalizeServerUrl(value);
    if (!normalized) return { ok: false, reason: 'invalid_url' };
    this.#serverUrl = normalized;
    this.#lastError = undefined;
    this.#providers = undefined;
    await this.#persist();
    this.#emit();
    await this.refresh();
    return { ok: true, state: this.state() };
  }

  /**
   * Run a browser sign-in to completion with `provider` (one of the server's
   * identity providers; without it the server offers the choice). Resolves
   * with the resulting state either way. A second call starts over: the round
   * before it stops where it is, and a sign-in it still completes is revoked
   * rather than kept or dropped on the floor.
   */
  async signIn(provider?: string): Promise<OrgAccountState> {
    const serverUrl = this.#serverUrl;
    if (!serverUrl || this.#session) return this.state();
    this.#signIn?.cancel();
    const abort = new AbortController();
    const round = { cancel: () => abort.abort() };
    this.#signIn = round;
    this.#signingInWith = provider;
    this.#lastError = undefined;
    this.#emit();
    try {
      const { tokens, profile } = await this.#runSignIn(serverUrl, abort.signal, provider);
      if (this.#signIn !== round || abort.signal.aborted) {
        this.#revoke(serverUrl, tokens.refresh_token);
        return this.state();
      }
      this.#session = {
        refreshToken: tokens.refresh_token,
        sessionId: tokens.session_id,
        refreshExpiresAt: tokens.refresh_expires_at,
        profile,
      };
      this.#access = { token: tokens.access_token, expiresAt: this.#now() + tokens.expires_in * 1000 };
      this.#armExpiry();
      await this.#persist();
    } catch (error) {
      if (this.#signIn === round) {
        this.#lastError = abort.signal.aborted
          ? 'cancelled'
          : error instanceof SignInFailed
            ? error.reason
            : 'unknown';
      }
    } finally {
      if (this.#signIn === round) {
        this.#signIn = undefined;
        this.#signingInWith = undefined;
      }
      this.#emit();
    }
    return this.state();
  }

  /** Stop the sign-in now; its round notices at its next step and leaves the state alone. */
  cancelSignIn(): void {
    if (!this.#endSignIn()) return;
    this.#lastError = 'cancelled';
    this.#emit();
  }

  async signOut(): Promise<void> {
    this.#endSignIn();
    const session = this.#session;
    const serverUrl = this.#serverUrl;
    this.#clearSession(undefined);
    await this.#persist();
    this.#emit();
    void this.refresh();
    // Best effort, and not waited for: the device is signed out here whether
    // or not the server hears it, and the sign-in screen is usable at once.
    if (session && serverUrl) this.#revoke(serverUrl, session.refreshToken);
  }

  #endSignIn(): boolean {
    const round = this.#signIn;
    if (!round) return false;
    round.cancel();
    this.#signIn = undefined;
    this.#signingInWith = undefined;
    return true;
  }

  #revoke(serverUrl: string, refreshToken: string): void {
    void this.#post(serverUrl, '/oauth/revoke', new URLSearchParams({ token: refreshToken })).catch(() => {});
  }

  /** A current access token, refreshed when it is about to expire. */
  async accessToken(): Promise<string> {
    const access = this.#access;
    if (access && access.expiresAt - this.#now() > ACCESS_TOKEN_MARGIN_MS) return access.token;
    if (!this.#session || !this.#serverUrl) throw new OrgAccountUnavailable('signed_out');
    this.#refreshing ??= this.#refresh(this.#serverUrl, this.#session).finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #refresh(serverUrl: string, session: StoredSession): Promise<string> {
    let response: Response;
    try {
      response = await this.#post(
        serverUrl,
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: DESKTOP_CLIENT_ID,
          refresh_token: session.refreshToken,
        }),
      );
    } catch {
      throw new OrgAccountUnavailable('server_unreachable');
    }
    if (response.status === 426) throw new OrgAccountUnavailable('upgrade_required');
    const body: unknown = await response.json().catch(() => undefined);
    if ((response.status === 400 || response.status === 401) && (body as { error?: unknown })?.error === 'invalid_grant') {
      // Revoked, replayed, expired or deactivated: this sign-in is over. Any
      // other refusal (a proxy's 400, a misrouted request) is not the
      // server's verdict on the sign-in, and does not end it.
      if (this.#session === session) {
        this.#clearSession('sign_in_expired');
        await this.#persist();
        this.#emit();
        // The sign-in screen needs the server's providers again.
        void this.refresh();
      }
      throw new OrgAccountUnavailable('sign_in_expired');
    }
    if (!response.ok) throw new OrgAccountUnavailable('server_unreachable');
    let tokens: TokenResponse;
    try {
      tokens = decodeTokenResponse(body);
    } catch {
      throw new OrgAccountUnavailable('server_unreachable');
    }
    if (this.#session !== session) throw new OrgAccountUnavailable('signed_out');
    this.#session = { ...session, refreshToken: tokens.refresh_token, refreshExpiresAt: tokens.refresh_expires_at };
    this.#access = { token: tokens.access_token, expiresAt: this.#now() + tokens.expires_in * 1000 };
    this.#armExpiry();
    await this.#persist();
    return tokens.access_token;
  }

  async #runSignIn(
    serverUrl: string,
    signal: AbortSignal,
    provider: string | undefined,
  ): Promise<{ tokens: TokenResponse; profile: OrgAccountProfile }> {
    const metadata = await this.#metadata(serverUrl, signal);
    signal.throwIfAborted();
    this.#providers = metadata.identityProviders;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    const listener = await startLoopbackListener(state, this.#deps.loopbackPage());
    const timeout = setTimeout(() => listener.close(), this.#deps.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
    const onAbort = () => listener.close();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Cancelled while the listener was starting: the browser never opens.
      signal.throwIfAborted();
      const authorize = new URL(metadata.authorizationEndpoint);
      authorize.search = new URLSearchParams({
        client_id: DESKTOP_CLIENT_ID,
        response_type: 'code',
        redirect_uri: listener.redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        device_name: this.#deps.deviceName.slice(0, 100),
        ...(provider && metadata.identityProviders.some((known) => known.id === provider) ? { provider } : {}),
      }).toString();
      await this.#deps.openExternal(authorize.toString());
      signal.throwIfAborted();
      const result = await listener.result.catch(() => {
        throw new SignInFailed(signal.aborted ? 'cancelled' : 'timed_out');
      });
      if ('error' in result) {
        const reason = SERVER_ERRORS.find((known) => known === result.errorDescription) ?? 'provider_error';
        throw new SignInFailed(reason);
      }
      const tokenResponse = await this.#post(
        serverUrl,
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: DESKTOP_CLIENT_ID,
          code: result.code,
          code_verifier: verifier,
          redirect_uri: listener.redirectUri,
        }),
        signal,
      ).catch(() => {
        signal.throwIfAborted();
        throw new SignInFailed('server_unreachable');
      });
      if (tokenResponse.status === 426) throw new SignInFailed('upgrade_required');
      if (!tokenResponse.ok) throw new SignInFailed('provider_error');
      const tokens = decodeTokenResponse(await tokenResponse.json());
      try {
        const profile = await this.#profile(serverUrl, tokens.access_token, signal);
        return { tokens, profile };
      } catch (error) {
        // The server made a session this device will not keep.
        this.#revoke(serverUrl, tokens.refresh_token);
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      listener.close();
    }
  }

  async #metadata(serverUrl: string, signal?: AbortSignal): Promise<PlatformMetadata> {
    let response: Response;
    try {
      response = await this.#fetch(`${serverUrl}${PLATFORM_METADATA_PATH}`, {
        headers: { [CLIENT_VERSION_HEADER]: this.#deps.appVersion },
        redirect: 'error',
        signal: requestSignal(signal),
      });
    } catch {
      signal?.throwIfAborted();
      throw new SignInFailed('server_unreachable');
    }
    if (!response.ok) throw new SignInFailed('server_unreachable');
    const metadata = (await response.json().catch(() => ({}))) as Partial<PlatformMetadata>;
    if (
      metadata.apiVersion !== PLATFORM_API_VERSION ||
      typeof metadata.authorizationEndpoint !== 'string' ||
      !Array.isArray(metadata.identityProviders)
    ) {
      throw new SignInFailed('server_incompatible');
    }
    // The browser is only ever sent to the server the person named.
    if (new URL(metadata.authorizationEndpoint).origin !== new URL(serverUrl).origin) {
      throw new SignInFailed('server_incompatible');
    }
    if (metadata.minimumClientVersion && !versionAtLeast(this.#deps.appVersion, metadata.minimumClientVersion)) {
      throw new SignInFailed('upgrade_required');
    }
    return metadata as PlatformMetadata;
  }

  async #profile(serverUrl: string, accessToken: string, signal: AbortSignal): Promise<OrgAccountProfile> {
    const response = await this.#fetch(`${serverUrl}/v1/me`, {
      headers: { authorization: `Bearer ${accessToken}`, [CLIENT_VERSION_HEADER]: this.#deps.appVersion },
      redirect: 'error',
      signal: requestSignal(signal),
    }).catch(() => {
      signal.throwIfAborted();
      throw new SignInFailed('server_unreachable');
    });
    if (!response.ok) throw new SignInFailed('provider_error');
    const me = (await response.json()) as PlatformMe;
    return {
      name: me.name,
      email: me.email,
      ...(me.avatarUrl ? { avatarUrl: me.avatarUrl } : {}),
      orgRole: me.orgRole,
    };
  }

  /** Codes and refresh tokens go to the server named, never on to wherever a redirect points. */
  #post(serverUrl: string, path: string, body: URLSearchParams, signal?: AbortSignal): Promise<Response> {
    return this.#fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        [CLIENT_VERSION_HEADER]: this.#deps.appVersion,
      },
      body,
      redirect: 'error',
      signal: requestSignal(signal),
    });
  }

  #clearSession(reason: OrgAccountError | undefined): void {
    this.#session = undefined;
    this.#access = undefined;
    this.#lastError = reason;
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
  }

  #armExpiry(): void {
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
    const session = this.#session;
    if (!session) return;
    this.#expiryTimer = setTimeout(
      () => {
        // By id: a refresh replaces the session object, not the sign-in.
        if (this.#session?.sessionId !== session.sessionId) return;
        this.#clearSession('sign_in_expired');
        void this.#persist().finally(() => {
          this.#emit();
          void this.refresh();
        });
      },
      Math.max(0, session.refreshExpiresAt - this.#now()),
    );
    this.#expiryTimer.unref?.();
  }

  async #persist(): Promise<void> {
    await this.#deps.store.save({
      serverUrl: this.#serverUrl,
      ...(this.#session ? { session: this.#session } : {}),
    });
  }

  #emit(): void {
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}
