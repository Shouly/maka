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

// Envelope encryption for every secret the server keeps at rest: signing
// keys, upstream model credentials, provider secrets. Each value gets its own
// data key; only the data key is wrapped by the master key. The master key
// lives behind this interface so a cloud KMS or Vault can replace the local
// one without touching callers (§3.1).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretBox {
  /** Encrypt `plaintext`; `context` is bound in and must match on open. */
  seal(plaintext: string, context: string): string;
  open(sealed: string, context: string): string;
}

const VERSION = 'v1';

function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function decrypt(key: Uint8Array, encoded: string, aad: string): Buffer {
  const raw = Buffer.from(encoded, 'base64url');
  if (raw.length < 28) throw new Error('Sealed value is truncated');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

/** A master key held by the server process itself: for small installs (§3.1). */
export function localSecretBox(masterKey: Uint8Array): SecretBox {
  if (masterKey.length !== 32) throw new Error('The master key must be 32 bytes');
  return {
    seal(plaintext, context) {
      const dataKey = randomBytes(32);
      const wrappedKey = encrypt(masterKey, dataKey, `key:${context}`);
      const body = encrypt(dataKey, Buffer.from(plaintext, 'utf8'), context);
      return `${VERSION}.${wrappedKey}.${body}`;
    },
    open(sealed, context) {
      const [version, wrappedKey, body] = sealed.split('.');
      if (version !== VERSION || !wrappedKey || !body) throw new Error('Unknown sealed format');
      const dataKey = decrypt(masterKey, wrappedKey, `key:${context}`);
      return decrypt(dataKey, body, context).toString('utf8');
    },
  };
}
