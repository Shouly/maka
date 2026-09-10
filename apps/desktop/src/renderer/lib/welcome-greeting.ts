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

// RELX's date/period/name selection, with injectable time and Desktop storage.
import type { UiLocale } from '@maka/core/ui-locale';
import { getGreetingCopy, type GreetingPeriod } from '../locales/greeting-copy.js';

export const WELCOME_VISIT_KEY = 'maka-welcome-visit-v1';
const MINUTE = 60_000;
export interface WelcomeVisit {
  lastVisitAt: number;
  returningUntil: number;
}

export function parseWelcomeVisit(raw: string | null): WelcomeVisit | undefined {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value && Number.isFinite(value.lastVisitAt) && Number.isFinite(value.returningUntil))
      return { lastVisitAt: value.lastVisitAt, returningUntil: value.returningUntil };
  } catch {}
  return undefined;
}

export function recordWelcomeVisit(now: number, previous?: WelcomeVisit): WelcomeVisit {
  const sameDay =
    previous && new Date(previous.lastVisitAt).toDateString() === new Date(now).toDateString();
  const returningUntil =
    previous && previous.returningUntil > now
      ? previous.returningUntil
      : sameDay && now - previous.lastVisitAt > 30 * MINUTE
        ? now + 40 * MINUTE
        : 0;
  return { lastVisitAt: now, returningUntil };
}

export function greetingPeriod(now: number): GreetingPeriod {
  const hour = new Date(now).getHours();
  if (hour < 6 || hour >= 22) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function nameHash(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

export function welcomeGreeting(
  locale: UiLocale,
  now: number,
  username?: string,
  returningUntil = 0,
): string {
  const name = username?.trim();
  const usableName = name && name !== 'there' ? name : undefined;
  const period = greetingPeriod(now);
  const anchor = new Date(now);
  if (period === 'night' && anchor.getHours() < 6) anchor.setDate(anchor.getDate() - 1);
  const copy = getGreetingCopy(locale);
  // The night belongs to its starting day, including its weekend pool.
  const weekend = anchor.getDay() === 0 || anchor.getDay() === 6;
  const pool =
    returningUntil > now
      ? copy.returning
      : [...copy.periods[period], ...(weekend ? copy.weekend : [])];
  const usable = usableName ? pool : pool.filter((line) => !line.includes('{name}'));
  const day = Math.round(
    (Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) -
      Date.UTC(anchor.getFullYear(), 0, 0)) /
      86_400_000,
  );
  const periodIndex = ['morning', 'afternoon', 'evening', 'night'].indexOf(period);
  const seed = nameHash(usableName ?? '') + day * 13 + periodIndex * 101;
  const line = usable[seed % usable.length]!;
  return usableName ? line.replace('{name}', () => usableName) : line;
}

export function nextGreetingRefresh(now: number, returningUntil: number): number {
  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  return Math.max(
    1,
    Math.min(nextHour.getTime() - now, returningUntil > now ? returningUntil - now : Infinity),
  );
}
