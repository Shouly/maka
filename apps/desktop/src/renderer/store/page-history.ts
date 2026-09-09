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

import { createStore } from 'zustand/vanilla';
import type { NavSelection } from '@maka/ui';
import type { DesktopNewTaskTarget } from '../bridge/new-tasks.js';
import type { SettingsSection } from '@maka/core/settings';

export type PageLocation =
  | { view: 'session'; sessionId: string }
  | { view: 'settings'; section: SettingsSection; sessionId?: string; selection?: NavSelection }
  | { view: 'welcome'; target?: DesktopNewTaskTarget; sessionId?: undefined }
  | { view: 'skills' | 'mcp' | 'automations' | 'debug'; sessionId?: string };

export function createPageHistory(limit = 100) {
  const store = createStore<{ entries: readonly PageLocation[]; index: number }>(() => ({
    entries: [],
    index: -1,
  }));
  const destination = (direction: -1 | 1, available: (page: PageLocation) => boolean) => {
    const { entries, index } = store.getState();
    for (let next = index + direction; next >= 0 && next < entries.length; next += direction) {
      if (available(entries[next]!)) return next;
    }
    return undefined;
  };
  return {
    ...store,
    visit(page: PageLocation) {
      const { entries, index } = store.getState();
      if (JSON.stringify(entries[index]) === JSON.stringify(page)) return;
      // Changing the welcome workspace updates that page, not the navigation stack.
      if (entries[index]?.view === 'welcome' && page.view === 'welcome') {
        store.setState({
          entries: entries.map((entry, position) => (position === index ? page : entry)),
        });
        return;
      }
      const next = [...entries.slice(0, index + 1), page].slice(-limit);
      store.setState({ entries: next, index: next.length - 1 });
    },
    canGo(direction: -1 | 1, available: (page: PageLocation) => boolean) {
      return destination(direction, available) !== undefined;
    },
    go(direction: -1 | 1, available: (page: PageLocation) => boolean): PageLocation | undefined {
      const index = destination(direction, available);
      if (index === undefined) return undefined;
      store.setState({ index });
      return store.getState().entries[index];
    },
  };
}
