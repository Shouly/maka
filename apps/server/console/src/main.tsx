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

// The admin console's entry: follow the system's light or dark, pick the
// reader's language, then draw the sign-in page — or read the session (a
// missing one sends the browser to sign in) and draw the console. An address
// outside /admin is the server's 404, drawn by this page.

import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@desktop/components/ui/button.js';
import { LocaleProvider } from '@maka/ui';
import { ConsoleApiError, loadSession } from './api.js';
import { App } from './app.js';
import { type ConsoleCopy, consoleLocale, getCopy } from './copy.js';
import { LoginPage } from './pages/login.js';
import { NotFoundPage } from './pages/not-found.js';
import { followSystemTheme } from './theme.js';
import { smallButton } from './ui.js';
import './styles.css';

followSystemTheme();
const locale = consoleLocale();
const root = createRoot(document.getElementById('root')!);
const copy = getCopy(locale);
const path = window.location.pathname;

function render(page: ReactNode) {
  root.render(
    <StrictMode>
      <LocaleProvider locale={locale}>{page}</LocaleProvider>
    </StrictMode>,
  );
}

/** The session could not be read, and not because it is over: say so, and try again. */
function Unavailable(props: { copy: ConsoleCopy; reason: string; onRetry: () => void }) {
  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-surface-1 px-6 text-center">
      <h1 className="text-[15px] font-semibold leading-5 text-text-primary">
        {props.copy.common.consoleUnavailable}
      </h1>
      <p className="max-w-[26rem] text-sm leading-5 text-text-muted">{props.reason}</p>
      <Button {...smallButton} className={`${smallButton.className} mt-2`} onClick={props.onRetry}>
        {props.copy.common.retry}
      </Button>
    </main>
  );
}

function open() {
  loadSession().then(
    (session) => render(<App locale={locale} copy={copy} session={session} />),
    (error: unknown) => {
      // A 401 is already on its way to the sign-in page.
      if (error instanceof ConsoleApiError && error.status === 401) return;
      const reason = error instanceof Error ? error.message : String(error);
      render(<Unavailable copy={copy} reason={reason} onRetry={open} />);
    },
  );
}

if (path !== '/admin' && !path.startsWith('/admin/')) {
  render(<NotFoundPage copy={copy} />);
} else if (path === '/admin/login') {
  render(<LoginPage copy={copy} />);
} else {
  open();
}
