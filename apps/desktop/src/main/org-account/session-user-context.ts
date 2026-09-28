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

import type { SessionUserContext } from '@maka/core/session';
import type { OrgAccountState } from '../../shared/org-account.js';

/**
 * What a Session the signed-in person starts is told about them: the name they
 * asked to be called (else their full name), their email, and their personal
 * preferences. Nothing while no one is signed in.
 */
export function sessionUserContext(
  state: OrgAccountState | undefined,
): SessionUserContext | undefined {
  if (state?.status !== 'signed_in') return undefined;
  const { profile } = state;
  const name = profile.nickname?.trim() || profile.name.trim();
  const email = profile.email.trim();
  if (!name || !email) return undefined;
  const preferences = profile.preferences?.trim();
  return { name, email, ...(preferences ? { preferences } : {}) };
}
