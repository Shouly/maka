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

// The one door to `window.maka`.
//
// Every other module under `bridge/` reaches the preload API through
// `requireNamespace`, so there is exactly one definition of what "the bridge
// is missing" means and exactly one error type for it. `window.maka` is
// undefined outside Electron (node --test, a plain browser), and the
// architecture check (`validateBridgeOwnership`) keeps every consumer of it
// inside this directory.
//
// The failure mode is deliberate: a missing namespace THROWS
// `BridgeUnavailableError` rather than resolving to a quiet `undefined`, so a
// store wired against a bridge that is not there fails loudly at the first
// call instead of rendering an empty product. The three pre-existing modules
// (`app-window`, `e2e-fixture`, `diagnostics`) keep their swallowing
// behaviour: they are fire-and-forget document/chrome effects with nothing to
// report.

import type { MakaBridge } from '../../preload/bridge-contract.js';

/** Thrown when the preload bridge — or one of its namespaces — is absent. */
export class BridgeUnavailableError extends Error {
  readonly namespace: string;

  constructor(namespace: string) {
    super(`window.maka.${namespace} is unavailable in this renderer`);
    this.name = 'BridgeUnavailableError';
    this.namespace = namespace;
  }
}

type BridgeHost = { maka?: MakaBridge };

/** The bridge if it exists. `undefined` outside Electron. */
export function optionalBridge(): MakaBridge | undefined {
  // Read through `globalThis` rather than the bare identifier: in Node the
  // identifier is not merely undefined, it is a ReferenceError.
  return (globalThis as { window?: BridgeHost }).window?.maka;
}

/** True when the preload bridge is present. */
export function isBridgeAvailable(): boolean {
  return optionalBridge() !== undefined;
}

/** One namespace of the bridge, or `BridgeUnavailableError`. */
export function requireNamespace<K extends keyof MakaBridge>(name: K): MakaBridge[K] {
  const namespace = optionalBridge()?.[name];
  if (!namespace) throw new BridgeUnavailableError(String(name));
  return namespace;
}

/** The same, without throwing — for subscriptions, which degrade to a no-op. */
export function tryNamespace<K extends keyof MakaBridge>(name: K): MakaBridge[K] | undefined {
  return optionalBridge()?.[name];
}

/**
 * Normalizes a preload subscription into an unsubscribe that is always safe to
 * call: absent bridge, absent method, double release.
 */
export function toUnsubscribe(unsubscribe: (() => void) | undefined): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe?.();
  };
}
