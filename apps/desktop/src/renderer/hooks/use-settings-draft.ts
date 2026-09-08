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

// React binding for `lib/ported/optimistic-settings-draft.ts`.
//
// The controller is created once and reads its callbacks through refs, so a
// re-render never tears down an in-flight save; the only effect that touches
// it is the one that hands it a new persisted snapshot.

import { useEffect, useRef, useState } from 'react';
import {
  createOptimisticSettingsDraft,
  type OptimisticSettingsDraft,
} from '../lib/ported/optimistic-settings-draft.js';

export interface SettingsDraft<T> {
  readonly draft: T;
  readonly saving: boolean;
  readonly edit: (patch: Partial<T>) => void;
  readonly update: (patch: Partial<T>) => Promise<boolean>;
}

export function useSettingsDraft<T extends object>(
  persisted: T,
  commit: (patch: Partial<T>) => Promise<T>,
  onError?: (error: unknown) => void,
): SettingsDraft<T> {
  const [draft, setDraft] = useState<T>(persisted);
  const [saving, setSaving] = useState(false);
  const commitRef = useRef(commit);
  const errorRef = useRef(onError);
  commitRef.current = commit;
  errorRef.current = onError;
  const mounted = useRef(true);
  const controller = useRef<OptimisticSettingsDraft<T> | null>(null);
  if (controller.current === null) {
    controller.current = createOptimisticSettingsDraft<T>({
      initial: persisted,
      commit: (patch) => commitRef.current(patch),
      onDraftChange: setDraft,
      onSavingChange: setSaving,
      onError: (error) => errorRef.current?.(error),
      isActive: () => mounted.current,
    });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const instance = controller.current;
  useEffect(() => {
    instance.syncPersisted(persisted);
  }, [instance, persisted]);
  return {
    draft,
    saving,
    edit: (patch) => instance.edit(patch),
    update: (patch) => instance.update(patch),
  };
}
