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

import { useCallback, useLayoutEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createPageHistory, type PageLocation } from '../store/page-history.js';

export interface PageHistoryControls {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack(): void;
  goForward(): void;
}

export function usePageHistory(
  page: PageLocation,
  ready: boolean,
  available: (page: PageLocation) => boolean,
  restore: (page: PageLocation) => void,
): PageHistoryControls {
  const [history] = useState(() => createPageHistory());
  useStore(history);
  useLayoutEffect(() => {
    if (ready) history.visit(page);
  }, [history, page, ready]);
  const go = useCallback(
    (direction: -1 | 1) => {
      const target = history.go(direction, available);
      if (target) restore(target);
    },
    [history, available, restore],
  );
  return {
    canGoBack: ready && history.canGo(-1, available),
    canGoForward: ready && history.canGo(1, available),
    goBack: () => go(-1),
    goForward: () => go(1),
  };
}
