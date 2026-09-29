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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeOrganizationAccountTokenResult } from '@maka/runtime-host/protocol';
import {
  OrgAccountUnavailable,
  type OrgAccountService,
} from '../org-account/org-account-service.js';
import { organizationAccountTokenService } from '../org-account/org-account-token-service.js';

const signal = new AbortController().signal;

function service(accessGrant: OrgAccountService['accessGrant'] | undefined) {
  return organizationAccountTokenService({
    account: () =>
      accessGrant ? Promise.resolve({ accessGrant } as unknown as OrgAccountService) : undefined,
    clientVersion: '0.2.0',
  });
}

describe('organizationAccountTokenService', () => {
  it('hands the Host a short-lived token with the server it is for, never the refresh token', async () => {
    const asked: Array<{ forceRefresh?: boolean }> = [];
    const offered = service(async (options = {}) => {
      asked.push(options);
      return { token: 'access-1', expiresAt: 5_000, serverUrl: 'https://maka.example.com' };
    });
    assert.equal(offered.serviceId, 'organization_account');
    assert.equal(offered.version, '1');
    const answer = await offered.call('access_token', { forceRefresh: true }, { signal });
    assert.deepEqual(decodeOrganizationAccountTokenResult(answer), {
      kind: 'token',
      accessToken: 'access-1',
      serverUrl: 'https://maka.example.com',
      clientVersion: '0.2.0',
    });
    assert.deepEqual(asked, [{ forceRefresh: true }]);
  });

  it("answers the account's refusals in the Host's terms", async () => {
    const refusing = (reason: OrgAccountUnavailable['reason']) =>
      service(async () => {
        throw new OrgAccountUnavailable(reason);
      });
    for (const [reason, expected] of [
      ['signed_out', 'signed_out'],
      ['sign_in_expired', 'sign_in_expired'],
      ['upgrade_required', 'upgrade_required'],
      ['server_unreachable', 'server_unreachable'],
      // A server that no longer speaks this app's platform cannot sign either.
      ['server_incompatible', 'server_unreachable'],
    ] as const) {
      assert.deepEqual(await refusing(reason).call('access_token', {}, { signal }), {
        kind: 'unavailable',
        reason: expected,
      });
    }
    // The account never started: nobody is signed in.
    assert.deepEqual(await service(undefined).call('access_token', {}, { signal }), {
      kind: 'unavailable',
      reason: 'signed_out',
    });
  });

  it('refuses a method or input it does not know', async () => {
    const offered = service(async () => ({ token: 't', expiresAt: 1, serverUrl: 'https://x.test' }));
    await assert.rejects(offered.call('refresh_token', {}, { signal }));
    await assert.rejects(offered.call('access_token', { forceRefresh: 'yes' }, { signal }));
  });
});
