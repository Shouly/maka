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

// The `permissions`, `capabilities` and `health` namespaces of the preload
// bridge, wrapped.
//
// One module because they are one settings page: OS permissions, the
// capability grants the agent asked for, and the readiness report that
// explains why a grant is not usable.

import type { CapabilitySnapshotCollection, PermissionSnapshot } from '@maka/core/capabilities';
import type { HealthSnapshot } from '@maka/core/health';
import type {
  DesktopRuntimeHostRef,
  PermissionActionResult,
  PermissionOverlayStartResult,
} from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

export type { PermissionSnapshot, CapabilitySnapshotCollection, HealthSnapshot };

export function getPermissionSnapshot(host?: DesktopRuntimeHostRef): Promise<PermissionSnapshot> {
  return requireNamespace('permissions').getSnapshot(host);
}

export function openPermissionSystemSettings(
  permissionId: string,
  host?: DesktopRuntimeHostRef,
): Promise<PermissionActionResult> {
  return requireNamespace('permissions').openSystemSettings(permissionId, host);
}

export function requestPermissionAccess(
  permissionId: string,
  host?: DesktopRuntimeHostRef,
): Promise<PermissionActionResult> {
  return requireNamespace('permissions').requestAccess(permissionId, host);
}

export function startPermissionDragOnboarding(
  permissionId: string,
  host?: DesktopRuntimeHostRef,
): Promise<PermissionOverlayStartResult> {
  return requireNamespace('permissions').startDragOnboarding(permissionId, host);
}

export function getCapabilitySnapshot(
  host?: DesktopRuntimeHostRef,
): Promise<CapabilitySnapshotCollection> {
  return requireNamespace('capabilities').getSnapshot(host);
}

export function getHealthSnapshot(host?: DesktopRuntimeHostRef): Promise<HealthSnapshot> {
  return requireNamespace('health').getSnapshot(host);
}
