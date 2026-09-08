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

// One sentence for an OAuth action that did not succeed.
//
// The Host answers with a closed `reason` plus a message it generalized for
// display. The reason is what this reads: a reworded message or a new locale
// must not silently disable a branch, and the pre-rewrite version decided two
// of its three branches by regex over English prose — one of which sniffed the
// message for CJK to guess whether it was translatable, which is exactly what
// `check-locale-hygiene` bans.
//
// Everything unrecognised falls through to the shared error classifier, so a
// timeout still reads as a timeout rather than as the caller's fallback.

import { generalizedErrorMessageForLocale, redactSecrets } from '@maka/core/redaction';
import type { SubscriptionActionResult } from '@maka/core/oauth-subscription';
import { lookupCopy, type UiLocale } from '@maka/core/ui-locale';
import { getSettingsModelsCopy } from '../../locales/settings-models-copy.js';

type OAuthFailure = Exclude<SubscriptionActionResult, { readonly ok: true }>;

/**
 * The message for a failed OAuth action.
 *
 * `fallback` is what the caller wants said when nothing more specific is
 * known — "could not start sign-in", "could not open the browser" — because
 * only the caller knows which step it was.
 */
export function oauthFailureMessage(
  failure: Pick<OAuthFailure, 'reason' | 'message'> & { readonly code?: string },
  fallback: string,
  locale: UiLocale,
): string {
  const copy = getSettingsModelsCopy(locale).oauthFlow;
  // A coded outcome (#4551) is the most specific thing the Host can say; the
  // catalog owns its sentence per locale. `code` stays `string` on the wire so
  // a newer Host's code this build does not know falls through, never leaks.
  const coded = lookupCopy(copy.resultCodes, failure.code);
  if (coded) return coded;
  // The install's own kill-switch, not the provider refusing the account. The
  // copy has to say "Maka has not enabled this", or the user goes looking for
  // a problem with their subscription.
  if (failure.reason === 'experimental_disabled') return copy.enrollmentDisabled;
  if (failure.reason === 'authorization_pending') return copy.loginSuperseded;
  const raw = redactSecrets(failure.message ?? '').trim();
  if (!raw) return fallback;
  return generalizedErrorMessageForLocale(new Error(raw), fallback, locale);
}

/** The same, for a thrown error rather than a returned envelope. */
export function oauthErrorMessage(error: unknown, fallback: string, locale: UiLocale): string {
  return generalizedErrorMessageForLocale(error, fallback, locale);
}
