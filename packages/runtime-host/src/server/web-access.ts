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

// The Host's way to the web: the organisation server, signed with the
// person's account and reached through their network proxy. WebSearch and
// WebFetch both go this way and nowhere else.

import {
  createProxiedFetchTransport,
  type ProxiedFetchProxy,
  type ProxiedFetchTransport,
} from '@maka/runtime/network/scoped-fetch-transport';
import { OrganizationAccountUnavailableError } from '@maka/runtime/organization-model-fetch';
import type { OrganizationAccountSource } from '@maka/runtime/organization-web';
import type { RuntimePolicyOperationCoordinator } from '@maka/storage/runtime-policy-stores';
import type { HostOrganizationSession } from './organization-session.js';
import { toRuntimePolicyProxy } from './runtime-policy-proxy.js';

export interface HostWebAccessInput {
  /** The signed-in account's session; throws when no app hands one out. */
  readonly organizationSession: () => HostOrganizationSession;
  readonly policy: Pick<RuntimePolicyOperationCoordinator, 'resolveHostOutboundExecution'>;
  readonly createFetchTransport?: (proxy: ProxiedFetchProxy | null) => ProxiedFetchTransport;
}

export type HostWebAccess =
  | {
      readonly ok: true;
      readonly account: OrganizationAccountSource;
      readonly fetchFn: typeof fetch;
      close(): Promise<void>;
    }
  | {
      readonly ok: false;
      readonly reason: 'not_signed_in' | 'network_error';
      readonly message: string;
    };

/** The account and a transport for one call; the caller closes it. */
export async function openHostWebAccess(input: HostWebAccessInput): Promise<HostWebAccess> {
  let session: HostOrganizationSession;
  try {
    session = input.organizationSession();
  } catch (error) {
    if (!(error instanceof OrganizationAccountUnavailableError)) throw error;
    return {
      ok: false,
      reason: 'not_signed_in',
      message: 'The web needs the Maka app, signed in to the organization account.',
    };
  }
  const outbound = await input.policy.resolveHostOutboundExecution();
  if (outbound.kind !== 'ready') {
    return {
      ok: false,
      reason: 'network_error',
      message: 'Configure the network proxy credential before using the web.',
    };
  }
  const transport = (input.createFetchTransport ?? createProxiedFetchTransport)(
    toRuntimePolicyProxy(outbound.networkProxy, outbound.secretMaterial.networkProxy?.secret),
  );
  return {
    ok: true,
    account: (options) => session.account(options),
    fetchFn: transport.fetch,
    close: () => transport.close(),
  };
}
