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

// Server configuration, read once from the environment. Every value that
// differs between deployments lives here; nothing else reads process.env.

import { z } from 'zod';

const list = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );

const optional = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const environmentSchema = z.object({
  MAKA_SERVER_PUBLIC_URL: z.string().min(1),
  MAKA_SERVER_HOST: z.string().default('0.0.0.0'),
  MAKA_SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  /** Base64 of 32 random bytes; wraps every secret the server stores (§10). */
  MAKA_MASTER_KEY: z.string().min(1),
  MAKA_ALLOWED_EMAIL_DOMAINS: list,
  MAKA_BOOTSTRAP_ADMIN_EMAILS: list,
  MAKA_MIN_CLIENT_VERSION: optional,
  /**
   * The reverse proxies whose X-Forwarded-For is believed: a hop count or a
   * comma-separated list of addresses/CIDRs. Unset, the peer address is the
   * client — otherwise anyone could write any address into the audit log.
   */
  MAKA_TRUST_PROXY: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RELX_SSO_CLIENT_ID: optional,
  RELX_SSO_CLIENT_SECRET: optional,
  RELX_SSO_AUTHORIZE_URL: optional,
  RELX_SSO_TOKEN_URL: optional,
  RELX_SSO_USERINFO_URL: optional,
  /**
   * The callback address registered with each identity provider. Defaults to
   * <public URL>/login/<provider>/callback; set it to reuse an address already
   * registered (for example relx-copilot's /auth/google/callback).
   */
  GOOGLE_REDIRECT_URI: optional,
  RELX_SSO_REDIRECT_URI: optional,
});

export interface GoogleProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl?: string;
}

export interface RelxSsoProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly userinfoUrl: string;
  readonly callbackUrl?: string;
}

export interface ServerConfig {
  /** Where people and the desktop app reach this server; the OAuth issuer and every callback derive from it. */
  readonly publicUrl: string;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly masterKey: Uint8Array;
  /**
   * Optional extra fence: when non-empty, only these email domains may sign
   * in. The identity providers already decide who can (§4.1); this is for a
   * Google OAuth client of the External type, which admits any Google account.
   */
  readonly allowedEmailDomains: readonly string[];
  /** These people become organization admins the first time they sign in. */
  readonly bootstrapAdminEmails: readonly string[];
  readonly minimumClientVersion?: string;
  /** Fastify's `trustProxy`: false, a hop count, or addresses/CIDRs. */
  readonly trustProxy: false | number | string;
  readonly google?: GoogleProviderConfig;
  readonly relxSso?: RelxSsoProviderConfig;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** An http(s) address; plain http only on this machine. */
function webUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new Error(`${name} must be an https address (plain http only for localhost)`);
}

/** All of a provider's settings, or none of them: half a provider is a typo, not a choice. */
function providerSettings<K extends string>(
  provider: string,
  values: Record<K, string | undefined>,
): Record<K, string> | undefined {
  const missing = Object.entries(values)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (missing.length === Object.keys(values).length) return undefined;
  if (missing.length > 0) {
    throw new Error(`${provider} is partly configured; also set ${missing.join(', ')}`);
  }
  return values as Record<K, string>;
}

function trustProxy(value: string | undefined): false | number | string {
  if (!value || value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/** A provider callback must come back to this server: same origin as the public URL. */
function callbackOnThisServer(name: string, value: string | undefined, publicUrl: string) {
  if (!value) return {};
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (url.origin !== new URL(publicUrl).origin || url.search || url.hash) {
    throw new Error(
      `${name} must be an address on MAKA_SERVER_PUBLIC_URL, without query or fragment`,
    );
  }
  return { callbackUrl: `${url.origin}${url.pathname}` };
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const parsed = environmentSchema.parse(env);
  const masterKey = Buffer.from(parsed.MAKA_MASTER_KEY, 'base64');
  if (masterKey.length !== 32) {
    throw new Error('MAKA_MASTER_KEY must be the base64 encoding of exactly 32 bytes');
  }
  const publicUrl = webUrl('MAKA_SERVER_PUBLIC_URL', parsed.MAKA_SERVER_PUBLIC_URL).href.replace(
    /\/+$/,
    '',
  );
  const googleSettings = providerSettings('Google', {
    GOOGLE_CLIENT_ID: parsed.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: parsed.GOOGLE_CLIENT_SECRET,
  });
  const google = googleSettings
    ? {
        clientId: googleSettings.GOOGLE_CLIENT_ID,
        clientSecret: googleSettings.GOOGLE_CLIENT_SECRET,
        ...callbackOnThisServer('GOOGLE_REDIRECT_URI', parsed.GOOGLE_REDIRECT_URI, publicUrl),
      }
    : undefined;
  const relxSettings = providerSettings('RELX SSO', {
    RELX_SSO_CLIENT_ID: parsed.RELX_SSO_CLIENT_ID,
    RELX_SSO_CLIENT_SECRET: parsed.RELX_SSO_CLIENT_SECRET,
    RELX_SSO_AUTHORIZE_URL: parsed.RELX_SSO_AUTHORIZE_URL,
    RELX_SSO_TOKEN_URL: parsed.RELX_SSO_TOKEN_URL,
    RELX_SSO_USERINFO_URL: parsed.RELX_SSO_USERINFO_URL,
  });
  const relxSso = relxSettings
    ? {
        clientId: relxSettings.RELX_SSO_CLIENT_ID,
        clientSecret: relxSettings.RELX_SSO_CLIENT_SECRET,
        authorizeUrl: webUrl('RELX_SSO_AUTHORIZE_URL', relxSettings.RELX_SSO_AUTHORIZE_URL).href,
        tokenUrl: webUrl('RELX_SSO_TOKEN_URL', relxSettings.RELX_SSO_TOKEN_URL).href,
        userinfoUrl: webUrl('RELX_SSO_USERINFO_URL', relxSettings.RELX_SSO_USERINFO_URL).href,
        ...callbackOnThisServer('RELX_SSO_REDIRECT_URI', parsed.RELX_SSO_REDIRECT_URI, publicUrl),
      }
    : undefined;
  if (!google && !relxSso) {
    throw new Error('Configure at least one identity provider (Google or RELX SSO)');
  }
  return {
    publicUrl,
    host: parsed.MAKA_SERVER_HOST,
    port: parsed.MAKA_SERVER_PORT,
    databaseUrl: parsed.DATABASE_URL,
    masterKey: new Uint8Array(masterKey),
    allowedEmailDomains: parsed.MAKA_ALLOWED_EMAIL_DOMAINS,
    bootstrapAdminEmails: parsed.MAKA_BOOTSTRAP_ADMIN_EMAILS,
    ...(parsed.MAKA_MIN_CLIENT_VERSION
      ? { minimumClientVersion: parsed.MAKA_MIN_CLIENT_VERSION }
      : {}),
    trustProxy: trustProxy(parsed.MAKA_TRUST_PROXY),
    ...(google ? { google } : {}),
    ...(relxSso ? { relxSso } : {}),
  };
}
