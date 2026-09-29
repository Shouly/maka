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

// Numbers and times as the reader writes them.

import type { ConsoleLocale } from './copy.js';

export function formatNumber(locale: ConsoleLocale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  google: 'Google',
  'relx-sso': 'RELX SSO',
};

/** An identity provider as people know it. */
export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}

/** Large counts short: 1.2M, 120万. */
export function formatCompact(locale: ConsoleLocale, value: number): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatDate(locale: ConsoleLocale, epochMs: number): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(epochMs);
}

export function formatDateTime(locale: ConsoleLocale, epochMs: number): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(epochMs);
}
