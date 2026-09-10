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

// Installing a downloaded update, from either place that offers it.
//
// The About page has a button and the sidebar footer has a chip, and they must
// not be two different behaviours. Before this, the chip went through
// `updateStore.install()`, whose `run()` keeps only results carrying a `state`
// field — and a refusal is `{ ok: false, reason }`, not a status. Pressing the
// chip while a task was running therefore did nothing at all: no restart, no
// message, nothing to press next.
//
// The refusal is the interesting answer, so it gets a question: `active_tasks`
// opens a confirmation, and confirming re-issues the request with
// `allowInterruptActiveTasks`, which retires the local Runtime Host the way
// quitting does. Every other refusal is a sentence in a toast.

import { useState, type ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import { installUpdate, type AppUpdateInstallResult } from '../bridge/app.js';
import { ConfirmDialog } from '../components/ui/confirm-dialog.js';
import { toast } from '../store/toast-store.js';
import { getShellCopy, localizedShellErrorMessage } from '../locales/shell-copy.js';

/** Every way the Host can say no. */
export type UpdateInstallRefusal = Extract<AppUpdateInstallResult, { ok: false }>['reason'];

export type UpdateInstallOutcome =
  | { readonly kind: 'restarting' }
  | { readonly kind: 'ask-to-interrupt' }
  | { readonly kind: 'refused'; readonly reason: UpdateInstallRefusal };

/**
 * What to do with the Host's answer — the one decision this hook exists for,
 * pulled out where a test can hold it.
 *
 * `active_tasks` is a QUESTION, not a failure, and only the first time: the
 * user has not been asked yet. After they answer it, the same refusal means
 * the interrupt itself did not take, and that is a sentence, not a second
 * question.
 */
export function updateInstallOutcome(
  result: AppUpdateInstallResult,
  askedToInterrupt: boolean,
): UpdateInstallOutcome {
  if (result.ok) return { kind: 'restarting' };
  if (result.reason === 'active_tasks' && !askedToInterrupt) return { kind: 'ask-to-interrupt' };
  return { kind: 'refused', reason: result.reason };
}

export interface UpdateInstall {
  /** Ask for the restart. Safe to call twice; the second press is ignored. */
  readonly install: () => void;
  /** A request is in flight, or the app is already on its way down. */
  readonly installing: boolean;
  /**
   * The confirmation, for the caller to render. It is nothing until a refusal
   * opens it, and it belongs to whichever surface asked — so the question
   * appears where the user pressed.
   */
  readonly confirmation: ReactNode;
}

export function useUpdateInstall(): UpdateInstall {
  const locale = useUiLocale();
  const shell = getShellCopy(locale);
  const copy = shell.app;
  const [installing, setInstalling] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const request = (allowInterruptActiveTasks: boolean) => {
    setInstalling(true);
    void installUpdate({ allowInterruptActiveTasks })
      .then((result) => {
        const outcome = updateInstallOutcome(result, allowInterruptActiveTasks);
        // `restarting` means the app is on its way down; nothing left to say.
        if (outcome.kind === 'restarting') return;
        if (outcome.kind === 'ask-to-interrupt') {
          setConfirming(true);
          return;
        }
        toast({
          title: copy.updateInstallFailedTitle,
          description: copy.updateInstallReasons[outcome.reason],
          variant: 'destructive',
        });
      })
      .catch((error: unknown) =>
        toast({
          title: copy.updateInstallFailedTitle,
          description: localizedShellErrorMessage(error, shell.actions.retry, locale),
          variant: 'destructive',
        }),
      )
      .finally(() => setInstalling(false));
  };

  return {
    install: () => {
      if (installing) return;
      request(false);
    },
    installing,
    confirmation: (
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={copy.updateInterruptTitle}
        description={copy.updateInterruptDescription}
        confirmText={copy.updateInterruptConfirm}
        variant="destructive"
        onConfirm={() => request(true)}
      />
    ),
  };
}
