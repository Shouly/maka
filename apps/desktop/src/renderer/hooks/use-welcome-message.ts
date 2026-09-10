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

import { useEffect, useState } from 'react';
import type { UiLocale } from '@maka/core/ui-locale';
import { safeLocalStorageGet, safeLocalStorageSet } from '../lib/ported/browser-storage.js';
import {
  WELCOME_VISIT_KEY,
  nextGreetingRefresh,
  parseWelcomeVisit,
  recordWelcomeVisit,
  welcomeGreeting,
} from '../lib/welcome-greeting.js';

export function useWelcomeMessage(locale: UiLocale, username?: string): string {
  const [state, setState] = useState(() => {
    const now = Date.now();
    return {
      now,
      visit: recordWelcomeVisit(now, parseWelcomeVisit(safeLocalStorageGet(WELCOME_VISIT_KEY))),
    };
  });
  useEffect(() => {
    safeLocalStorageSet(WELCOME_VISIT_KEY, JSON.stringify(state.visit));
    const visibility = () => {
      const now = Date.now();
      const previous = parseWelcomeVisit(safeLocalStorageGet(WELCOME_VISIT_KEY));
      if (document.visibilityState === 'hidden') {
        safeLocalStorageSet(
          WELCOME_VISIT_KEY,
          JSON.stringify({ lastVisitAt: now, returningUntil: previous?.returningUntil ?? 0 }),
        );
        return;
      }
      const visit = recordWelcomeVisit(now, previous);
      safeLocalStorageSet(WELCOME_VISIT_KEY, JSON.stringify(visit));
      setState({ now, visit });
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      const previous = parseWelcomeVisit(safeLocalStorageGet(WELCOME_VISIT_KEY));
      safeLocalStorageSet(
        WELCOME_VISIT_KEY,
        JSON.stringify({ lastVisitAt: Date.now(), returningUntil: previous?.returningUntil ?? 0 }),
      );
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => setState((current) => ({ ...current, now: Date.now() })),
      nextGreetingRefresh(state.now, state.visit.returningUntil),
    );
    return () => clearTimeout(timer);
  }, [state.now, state.visit.returningUntil]);
  return welcomeGreeting(locale, state.now, username, state.visit.returningUntil);
}
