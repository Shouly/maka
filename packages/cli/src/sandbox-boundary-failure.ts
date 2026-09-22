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

import type { SessionEvent } from '@maka/core/events';

type SandboxBoundaryFailureReason = 'sandbox_boundary_required' | 'requires_bypass';

/**
 * Read from the failure envelope, not from the result body.
 *
 * The body is what a live frame omits, so the old content-based read answered
 * only for a locally executed run and returned nothing for the same denial
 * arriving over the Host wire.
 */
export function sessionEventSandboxBoundaryFailureReason(
  event: SessionEvent,
): SandboxBoundaryFailureReason | undefined {
  if (event.type !== 'tool_result' || !event.isError || event.failure?.kind !== 'denied') {
    return undefined;
  }
  return normalizeSandboxBoundaryFailureReason(event.failure.class);
}

function normalizeSandboxBoundaryFailureReason(
  reason: unknown,
): SandboxBoundaryFailureReason | undefined {
  return reason === 'sandbox_boundary_required' || reason === 'requires_bypass'
    ? reason
    : undefined;
}
