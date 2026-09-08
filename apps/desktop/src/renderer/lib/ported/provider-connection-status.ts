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

// What one connection's status chip says, and what colour it is.
//
// Both come out of the same branch so the colour can never disagree with the
// words: the pre-rewrite code split label and tone into two helpers and they
// drifted — a disabled connection that had last errored kept the failure copy
// and lost the destructive tone.
//
// Pure, and outside the component, because the priority order below is the
// whole behaviour and it is worth testing without rendering anything.

import type { LlmConnection } from '@maka/core/llm-connections';
import { isRetiredProvider } from '@maka/core/provider-registry';
import type { StatusSemantic, UiLocale } from '@maka/ui';
import { getSettingsModelsCopy } from '../../locales/settings-models-copy.js';

export interface ConnectionChipStatus {
  readonly label: string;
  readonly tone: StatusSemantic;
}

/**
 * The chip for a connection row, or `null` when there is nothing to report —
 * a working connection is the quiet case and earns no badge.
 *
 * Priority order, and why:
 * - **retired** outranks everything: the provider is gone from this build, so
 *   every repair-shaped status below would send the user to a sign-in that no
 *   longer exists. `error`, not `attention`: the row can never work again.
 * - **needs_reauth** outranks disabled. A lapsed OAuth login arrives as
 *   `enabled: false` + `needs_reauth`; that is "sign in again", not "you
 *   turned this off", and must never read as disabled.
 * - **disabled + error** keeps both facts. A failed Host connection effect can
 *   persist `enabled: false` with `lastTestStatus: 'error'`, and dropping the
 *   failure would leave the user with no reason for the state.
 * - **disabled** alone is neutral even when the last test verified: a stale
 *   green light on an unusable connection is worse than no light.
 * - **verified** is deliberately silent. It proves the credential validated,
 *   not that a turn will run, so it does not earn a "ready" badge.
 */
export function connectionChipStatus(
  connection: Pick<LlmConnection, 'providerType' | 'enabled' | 'lastTestStatus'>,
  locale: UiLocale,
): ConnectionChipStatus | null {
  const copy = getSettingsModelsCopy(locale).shared.connectionStatuses;
  if (isRetiredProvider(connection.providerType)) return { label: copy.retired, tone: 'error' };
  if (connection.lastTestStatus === 'needs_reauth') {
    return { label: copy.reauth, tone: 'attention' };
  }
  if (!connection.enabled) {
    return connection.lastTestStatus === 'error'
      ? { label: copy.disabledFailed, tone: 'error' }
      : { label: copy.disabled, tone: 'neutral' };
  }
  return connection.lastTestStatus === 'error' ? { label: copy.failed, tone: 'error' } : null;
}
