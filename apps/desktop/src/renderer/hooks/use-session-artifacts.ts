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

import { useEffect } from 'react';
import { useStore } from 'zustand';
import {
  selectSessionArtifacts,
  sessionArtifactsStore,
  type SessionArtifactsEntry,
} from '../store/session-artifacts-store.js';

/**
 * This task's output files, live for as long as this component is mounted.
 *
 * `active` is for a face that stays mounted while hidden: the pane keeps every
 * open face in the tree so a terminal does not drop its PTY, and a hidden face
 * has no reason to hold a read open.
 */
export function useSessionArtifacts(sessionId: string, active = true): SessionArtifactsEntry {
  useEffect(() => {
    if (!active) return;
    return sessionArtifactsStore.retain(sessionId);
  }, [active, sessionId]);
  return useStore(sessionArtifactsStore, (state) => selectSessionArtifacts(state, sessionId));
}
