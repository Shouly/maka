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

// The `onboarding` namespace of the preload bridge, wrapped.
//
// `getSnapshot` is an expensive composite read (sessions + connections + chat
// model choices + per-session send readiness), which is why `main.tsx` used to
// prefetch it 2.5s after mount rather than on the critical path — see
// `store/onboarding-store.ts`.

import type { OnboardingMilestoneId } from '@maka/core/onboarding';
import type { DesktopRuntimeHostRef, OnboardingSnapshot } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

export type { OnboardingSnapshot };

export function getOnboardingSnapshot(): Promise<OnboardingSnapshot> {
  return requireNamespace('onboarding').getSnapshot();
}

export function setOnboardingMilestone(
  id: OnboardingMilestoneId,
  status: 'completed' | 'skipped',
  host?: DesktopRuntimeHostRef,
): Promise<OnboardingSnapshot> {
  return requireNamespace('onboarding').setMilestone(id, status, host);
}
