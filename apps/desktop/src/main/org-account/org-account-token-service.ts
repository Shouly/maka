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

import {
  decodeOrganizationAccountTokenRequest,
  ORGANIZATION_ACCOUNT_SERVICE_ID,
  ORGANIZATION_ACCOUNT_SERVICE_VERSION,
  type OrganizationAccountTokenResult,
  type OrganizationAccountUnavailableReason,
} from '@maka/runtime-host/protocol';
import type { DesktopCapabilityService } from '../runtime-host-native-capabilities.js';
import { OrgAccountUnavailable, type OrgAccountService } from './org-account-service.js';

/**
 * The organisation account's access token, offered to the Runtime Host for
 * the model calls and catalog reads it sends to the organisation server
 * (design §5.3). The refresh token never leaves this process: the Host gets
 * a token that lives minutes, with the server it is for.
 */
export function organizationAccountTokenService(input: {
  readonly account: () => Promise<OrgAccountService> | undefined;
  readonly clientVersion: string;
}): DesktopCapabilityService {
  return {
    serviceId: ORGANIZATION_ACCOUNT_SERVICE_ID,
    version: ORGANIZATION_ACCOUNT_SERVICE_VERSION,
    async call(method, request) {
      const { forceRefresh } = decodeOrganizationAccountTokenRequest(method, request);
      const account = await input.account()?.catch(() => undefined);
      if (!account) return unavailable('signed_out');
      try {
        const grant = await account.accessGrant({ forceRefresh });
        return {
          kind: 'token',
          accessToken: grant.token,
          serverUrl: grant.serverUrl,
          clientVersion: input.clientVersion,
        } satisfies OrganizationAccountTokenResult;
      } catch (error) {
        if (error instanceof OrgAccountUnavailable) return unavailable(unavailableReason(error.reason));
        throw error;
      }
    },
  };
}

function unavailable(reason: OrganizationAccountUnavailableReason): Record<string, unknown> {
  return { kind: 'unavailable', reason } satisfies OrganizationAccountTokenResult;
}

/** The account's refusals in the terms a model call can report. */
function unavailableReason(
  reason: OrgAccountUnavailable['reason'],
): OrganizationAccountUnavailableReason {
  switch (reason) {
    case 'signed_out':
    case 'sign_in_expired':
    case 'upgrade_required':
      return reason;
    default:
      // A server that cannot be reached, or no longer speaks this app's
      // platform version, cannot sign anything either.
      return 'server_unreachable';
  }
}
