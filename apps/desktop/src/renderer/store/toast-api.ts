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

// The `ToastApi` shape the ported session/turn logic was written against,
// bound to the design system's toast store.
//
// The old shell threaded an object with `info/success/error(title,
// description, diagnosticDetails, diagnosticTarget)` through every action
// factory. The last two arguments fed the "copy diagnostic report" affordance
// on an error toast, which Phase 2 rebuilds as a toast action; they are
// accepted and carried here so the ported call sites keep their exact shape
// and nothing has to be re-plumbed when the action lands.

import { toast, dismissToastById } from './toast-store.js';

export interface ToastDiagnosticTarget {
  sessionId?: string;
  turnId?: string;
  eventId?: string;
  profileId?: string;
}

export interface ToastApi {
  info(title: string, description?: string): void;
  success(title: string, description?: string): void;
  error(
    title: string,
    description?: string,
    diagnosticDetails?: string,
    diagnosticTarget?: ToastDiagnosticTarget,
  ): void;
  /** A toast whose lifetime the caller owns (compaction's running notice). */
  open(input: { title: string; description?: string; variant?: 'info'; duration?: number }): string;
  dismiss(id: string): void;
}

/** The most recent diagnostic payload per toast id, for Phase 2's copy action. */
const diagnostics = new Map<string, { details?: string; target?: ToastDiagnosticTarget }>();

/** What an error toast carried with it. Phase 2's copy action reads this. */
export function readToastDiagnostics(
  id: string,
): { details?: string; target?: ToastDiagnosticTarget } | undefined {
  return diagnostics.get(id);
}

export const toastApi: ToastApi = {
  info(title, description) {
    toast({ title, ...(description === undefined ? {} : { description }), variant: 'info' });
  },
  success(title, description) {
    toast({ title, ...(description === undefined ? {} : { description }), variant: 'success' });
  },
  error(title, description, diagnosticDetails, diagnosticTarget) {
    const handle = toast({
      title,
      ...(description === undefined ? {} : { description }),
      variant: 'destructive',
    });
    if (diagnosticDetails !== undefined || diagnosticTarget !== undefined) {
      if (diagnostics.size >= 32) diagnostics.delete(diagnostics.keys().next().value!);
      diagnostics.set(handle.id, {
        ...(diagnosticDetails === undefined ? {} : { details: diagnosticDetails }),
        ...(diagnosticTarget === undefined ? {} : { target: diagnosticTarget }),
      });
    }
  },
  open(input) {
    return toast({
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.variant === undefined ? {} : { variant: input.variant }),
      ...(input.duration === undefined ? {} : { duration: input.duration }),
    }).id;
  },
  dismiss(id) {
    dismissToast(id);
  },
};

function dismissToast(id: string): void {
  diagnostics.delete(id);
  // `toast()` returns its own dismiss, but a caller holding only an id (the
  // compaction presentation) needs one keyed by id; re-opening with `open:
  // false` is how the reducer's DISMISS path is reached from outside.
  dismissToastById(id);
}
