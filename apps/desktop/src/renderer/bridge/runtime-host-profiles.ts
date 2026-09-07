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

// The `runtimeHostProfiles` namespace of the preload bridge, wrapped.
//
// Which Runtime Hosts exist, which is default, and which is ready. Everything
// else in the bridge takes an optional `host?: DesktopRuntimeHostRef` — this is
// where that ref comes from.

import type {
  DesktopRuntimeHostProfileAddInput,
  DesktopRuntimeHostProfileAddResult,
  DesktopRuntimeHostProfileChangedEvent,
  DesktopRuntimeHostProfileSnapshot,
  DesktopRuntimeHostRef,
  MakaBridge,
} from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type RuntimeHostProfiles = MakaBridge['runtimeHostProfiles'];

export type {
  DesktopRuntimeHostProfileSnapshot,
  DesktopRuntimeHostProfileChangedEvent,
  DesktopRuntimeHostRef,
};

const profiles = (): RuntimeHostProfiles => requireNamespace('runtimeHostProfiles');

export function getRuntimeHostProfiles(): Promise<DesktopRuntimeHostProfileSnapshot> {
  return profiles().getSnapshot();
}

/** The Host every un-scoped read resolves against. */
export function getDefaultRuntimeHost(): Promise<DesktopRuntimeHostRef> {
  return profiles().getDefaultHost();
}

export function addRuntimeHostProfile(
  input: DesktopRuntimeHostProfileAddInput,
): Promise<DesktopRuntimeHostProfileAddResult> {
  return profiles().addAndEnable(input);
}

export function removeRuntimeHostProfile(
  profileId: string,
): Promise<DesktopRuntimeHostProfileSnapshot> {
  return profiles().remove(profileId);
}

export function setRuntimeHostProfileEnabled(
  profileId: string,
  enabled: boolean,
): Promise<DesktopRuntimeHostProfileSnapshot> {
  return profiles().setEnabled(profileId, enabled);
}

export function setDefaultRuntimeHostProfile(
  profileId: string,
): Promise<DesktopRuntimeHostProfileSnapshot> {
  return profiles().setDefault(profileId);
}

export function subscribeRuntimeHostProfileChanges(
  handler: (event: DesktopRuntimeHostProfileChangedEvent) => void,
): () => void {
  return toUnsubscribe(tryNamespace('runtimeHostProfiles')?.subscribeChanges(handler));
}
