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

// Where a company sign-in survives a restart: `org-account.json` in the user
// data directory. The refresh token is encrypted with Electron safeStorage —
// the OS keychain — and never written in the clear; without a keychain the
// sign-in is kept in memory only.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OrgAccountProfile } from '../../shared/org-account.js';

export interface KeychainCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Electron's safeStorage as this store's keychain — except on Linux with no
 * keyring, where it falls back to `basic_text`: obfuscation under a key built
 * into Chromium, which is no protection for a refresh token. That counts as
 * no keychain, and the sign-in then lasts only while the app runs.
 */
export function osKeychain(
  safeStorage: KeychainCipher & { getSelectedStorageBackend?(): string },
  platform: NodeJS.Platform,
): KeychainCipher {
  return {
    isEncryptionAvailable: () =>
      safeStorage.isEncryptionAvailable() &&
      !(platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (sealed) => safeStorage.decryptString(sealed),
  };
}

export interface StoredSession {
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly refreshExpiresAt: number;
  readonly profile: OrgAccountProfile;
}

export interface StoredOrgAccount {
  readonly serverUrl: string | null;
  readonly session?: StoredSession;
}

interface FileShape {
  readonly version: 1;
  readonly serverUrl: string | null;
  readonly session?: {
    readonly sealedRefreshToken: string;
    readonly sessionId: string;
    readonly refreshExpiresAt: number;
    readonly profile: OrgAccountProfile;
  };
}

export class OrgAccountStore {
  /** Saves run one after another, in the order asked: the last word is what stays on disk. */
  #saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly keychain: KeychainCipher,
  ) {}

  get remembers(): boolean {
    return this.keychain.isEncryptionAvailable();
  }

  async load(): Promise<StoredOrgAccount> {
    let file: FileShape;
    try {
      file = JSON.parse(await readFile(this.path, 'utf8')) as FileShape;
    } catch {
      return { serverUrl: null };
    }
    // Anything but the expected object (`null`, an array, a newer shape) is
    // no sign-in at all, not a reason for the account to fail to start.
    if (typeof file !== 'object' || file === null || file.version !== 1) return { serverUrl: null };
    const serverUrl = typeof file.serverUrl === 'string' ? file.serverUrl : null;
    if (!file.session || typeof file.session !== 'object' || !this.remembers) return { serverUrl };
    try {
      const refreshToken = this.keychain.decryptString(Buffer.from(file.session.sealedRefreshToken, 'base64'));
      return {
        serverUrl,
        session: {
          refreshToken,
          sessionId: file.session.sessionId,
          refreshExpiresAt: file.session.refreshExpiresAt,
          profile: file.session.profile,
        },
      };
    } catch {
      // A keychain that no longer opens the token (another OS user, a reset
      // keychain): the sign-in is gone, the server address is not.
      return { serverUrl };
    }
  }

  save(account: StoredOrgAccount): Promise<void> {
    const next = this.#saving.then(() => this.#write(account));
    this.#saving = next.catch(() => {});
    return next;
  }

  async #write(account: StoredOrgAccount): Promise<void> {
    const session =
      account.session && this.remembers
        ? {
            sealedRefreshToken: this.keychain.encryptString(account.session.refreshToken).toString('base64'),
            sessionId: account.session.sessionId,
            refreshExpiresAt: account.session.refreshExpiresAt,
            profile: account.session.profile,
          }
        : undefined;
    const file: FileShape = { version: 1, serverUrl: account.serverUrl, ...(session ? { session } : {}) };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
