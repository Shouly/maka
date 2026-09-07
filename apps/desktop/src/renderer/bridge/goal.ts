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

// The `goal` namespace of the preload bridge, wrapped.

import type { GoalArmRequest, GoalArmOutcome } from '../../shared/goal-arm.js';
import type { GoalState } from '@maka/runtime/goal-state';
import { requireNamespace } from './bridge.js';

export type { GoalState, GoalArmRequest, GoalArmOutcome };

export function getGoal(sessionId: string): Promise<GoalState | null> {
  return requireNamespace('goal').get(sessionId);
}

export function armGoal(sessionId: string, goal: GoalArmRequest): Promise<GoalArmOutcome> {
  return requireNamespace('goal').arm(sessionId, goal);
}

export function clearGoal(sessionId: string): Promise<void> {
  return requireNamespace('goal').clear(sessionId);
}

export function pauseGoal(sessionId: string): Promise<void> {
  return requireNamespace('goal').pause(sessionId);
}

export function resumeGoal(sessionId: string): Promise<void> {
  return requireNamespace('goal').resume(sessionId);
}
