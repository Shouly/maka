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

// Small pieces the pages share, in the Settings pages' own terms: the 28px
// secondary button, the status chip, the loading and failed rows, and a
// report of a change that did not go through.

import type { ReactNode } from 'react';
import { SettingsRow } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { Skeleton } from '@desktop/components/ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '@desktop/components/ui/status-chip.js';
import { cn } from '@desktop/lib/cn.js';
import { toast } from '@desktop/store/toast-store.js';
import { useConsole } from './context.js';

/** The 28px secondary the Preferences pages use: 14px text, 10px sides, radius 7. */
export const smallButton = {
  variant: 'secondary',
  size: 'sm',
  className: 'rounded-[7px] text-sm',
} as const;

export function Chip(props: {
  tone: Parameters<typeof statusChipToneClass>[0];
  children: ReactNode;
}) {
  return (
    <span className={cn(statusChipClass, statusChipToneClass(props.tone))}>{props.children}</span>
  );
}

export function LoadingRows(props: { rows?: number }) {
  const { copy } = useConsole();
  return (
    <div className="flex flex-col gap-2 py-3" role="status" aria-label={copy.common.loading}>
      {Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** A read that failed, as a row of the section it would have filled. */
export function LoadFailed(props: { error: Error; onRetry: () => void }) {
  const { copy } = useConsole();
  return (
    <SettingsRow
      title={copy.common.loadFailed}
      description={props.error.message}
      control={
        <Button {...smallButton} onClick={props.onRetry}>
          {copy.common.retry}
        </Button>
      }
    />
  );
}

/** Say a change failed, in the change's own words, with the server's reason. */
export function reportFailure(title: string, error: unknown): void {
  toast({
    title,
    description: `${title}: ${error instanceof Error ? error.message : String(error)}`,
    variant: 'destructive',
  });
}

/** A person's picture from their identity provider, or their initials. */
export function Avatar(props: { name: string; url?: string | undefined; size?: number }) {
  const size = props.size ?? 32;
  const initials = props.name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return props.url ? (
    <img
      src={props.url}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-alpha-2 text-xs font-medium text-text-secondary"
      style={{ width: size, height: size }}
    >
      {initials || '?'}
    </span>
  );
}

/** A page's heading inside a detail face: 15/20 semibold, as the sections are. */
export function DetailHeader(props: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-8 flex items-center gap-3">
      {props.children}
      {props.aside && <span className="ml-auto flex items-center gap-2">{props.aside}</span>}
    </div>
  );
}
