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

// The `e2eFixture` namespace of the preload bridge, wrapped.
//
// `getState()` resolves to null for every real user: main only fills it in
// under `MAKA_E2E_FIXTURE`. Everything downstream of this module therefore
// treats null as "this is a normal launch", never as an error.

import type { E2eFixtureState } from '@maka/core/e2e-fixture';

export async function getE2eFixtureState(): Promise<E2eFixtureState | null> {
  try {
    return (await window.maka?.e2eFixture?.getState?.()) ?? null;
  } catch {
    return null;
  }
}
