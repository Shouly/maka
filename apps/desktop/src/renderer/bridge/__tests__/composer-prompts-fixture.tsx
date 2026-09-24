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

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '@maka/ui';
import type { ActiveInteractionRequestEvent } from '@maka/core/events';
import type { MakaBridge } from '../../../preload/bridge-contract.js';
import { activeSessionStore, sessionsStore } from '../../store/index.js';
import { useShellHotkeys } from '../../hooks/use-hotkeys.js';
import { InteractionPrompts } from '../../components/composer/InteractionPrompts.js';
const FIXTURE_SESSION = { id: 'fixture', runtimeHostId: 'local', profileId: 'default' };
const submissions: { kind: string; response: unknown }[] = [];
let failNext = false;
const respond = async (kind: string, response: unknown) => {
  if (failNext) {
    failNext = false;
    throw new Error('temporary response failure');
  }
  submissions.push({ kind, response });
  activeSessionStore.setState({ interactions: {} });
};
window.maka = {
  // The Host the fixture session runs on, for the permission card's `~`.
  app: { info: async () => ({ homePath: '/Users/tester' }) },
  sessions: {
    // The fixture session and the Host it runs on, which the permission card
    // asks for its home directory. A store reload keeps it.
    listWithCoverage: async () => ({ sessions: [FIXTURE_SESSION], completeHostIds: ['local'] }),
    respondToSandboxBoundary: (_id: string, response: unknown) => respond('sandbox', response),
    respondToClientCapability: (_id: string, response: unknown) => respond('capability', response),
    respondToUserQuestion: (_id: string, response: unknown) => respond('question', response),
    respondToUserForm: (_id: string, response: unknown) => respond('form', response),
  },
} as unknown as MakaBridge;
Object.assign(window, {
  promptFixture: {
    submissions,
    failNext() {
      failNext = true;
    },
    show(request: ActiveInteractionRequestEvent) {
      activeSessionStore.setState({ sessionId: 'fixture', interactions: { fixture: [request] } });
    },
  },
});
sessionsStore.setState({ sessions: [FIXTURE_SESSION] } as never);

// The shell's hotkeys, as `AppShell` registers them: Escape is claimed at the
// document whether or not anything closes. The permission card must still
// hear it.
function ShellHotkeys() {
  useShellHotkeys({ escape: () => {} });
  return null;
}

createRoot(document.getElementById('root')!).render(
  createElement(LocaleProvider, {
    locale: 'en',
    children: [
      createElement(ShellHotkeys, { key: 'hotkeys' }),
      // A text field outside the card, standing in for the composer: keys typed
      // there must never answer the card.
      createElement('input', { key: 'field', 'aria-label': 'Fixture field' }),
      createElement(InteractionPrompts, {
        key: 'prompts',
        sessionId: 'fixture',
        // The shell's toast is not mounted here; this harness drives the
        // answer paths, and a stop failure has no surface to land on.
        onError: () => {},
      }),
    ],
  }),
);
