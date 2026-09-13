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

// The two atoms every bot surface shares: the platform's brand tile and the
// readiness chip. The brand mark is the real logo (`@maka/ui` ships the
// SVGs), the same way the model list shows real provider marks.

import { BotBrandLogo } from '@maka/ui';
import type { BotProvider } from '@maka/core/bot-chat-settings';
import { cn } from '../../../lib/cn.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';

export type BotChipTone = 'success' | 'attention' | 'error' | 'neutral';

export function BotBrandTile(props: { provider: BotProvider; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden',
        props.size === 'lg' ? 'size-12 rounded-xl' : 'size-8 rounded-lg',
      )}
      data-provider={props.provider}
      aria-hidden="true"
    >
      <BotBrandLogo provider={props.provider} width="100%" height="100%" aria-hidden />
    </span>
  );
}

export function ReadinessChip(props: { tone: BotChipTone; label: string; className?: string }) {
  return (
    <span className={cn(statusChipClass, statusChipToneClass(props.tone), props.className)}>
      {props.label}
    </span>
  );
}
