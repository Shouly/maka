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

// The identity providers this deployment offers, built from configuration.

import type { ServerConfig } from '../config.js';
import { googleProvider } from './providers/google.js';
import { relxSsoProvider } from './providers/relx-sso.js';
import type { IdentityProvider } from './providers/types.js';

export function providersFromConfig(config: ServerConfig): Map<string, IdentityProvider> {
  const providers = new Map<string, IdentityProvider>();
  if (config.relxSso) {
    const provider = relxSsoProvider({
      ...config.relxSso,
      allowedDomains: config.allowedEmailDomains,
    });
    providers.set(provider.id, provider);
  }
  if (config.google) {
    const provider = googleProvider({
      ...config.google,
      allowedDomains: config.allowedEmailDomains,
    });
    providers.set(provider.id, provider);
  }
  return providers;
}
