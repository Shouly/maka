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
import { test } from 'node:test';
import type { OrgAccountProfile, OrgAccountState } from '../../shared/org-account.js';
import { sessionUserContext } from '../org-account/session-user-context.js';

const signedIn = (profile: Partial<OrgAccountProfile>): OrgAccountState =>
  ({
    status: 'signed_in',
    serverUrl: 'https://org.example',
    profile: { name: 'Ada Lovelace', email: 'ada@example.com', orgRole: 'member', ...profile },
  }) as OrgAccountState;

test('a new session is told the name they asked to be called, else their full name', () => {
  assert.deepEqual(sessionUserContext(signedIn({})), {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  });
  assert.deepEqual(sessionUserContext(signedIn({ nickname: '  Ada ', preferences: ' Be brief. ' })), {
    name: 'Ada',
    email: 'ada@example.com',
    preferences: 'Be brief.',
  });
  // Blank preferences are no preferences.
  assert.equal('preferences' in sessionUserContext(signedIn({ preferences: '   ' }))!, false);
});

test('no one signed in, no user context', () => {
  assert.equal(sessionUserContext(undefined), undefined);
  assert.equal(
    sessionUserContext({ status: 'signed_out', serverUrl: null } as OrgAccountState),
    undefined,
  );
});
