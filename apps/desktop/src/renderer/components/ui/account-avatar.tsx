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

// The signed-in person's avatar, one component wherever it shows — the
// sidebar's account row and Settings › Account › Profile. What it draws, in
// order: the generated avatar they picked (a seed, drawn by `UserAvatar` in
// the warm palette, the relx-copilot avatar), else the picture their identity
// provider supplied, else their initials on a 10% disc.
//
// Decorative: the name always stands beside it or labels its control.

import { useState } from 'react';
import { UserAvatar } from './user-avatar.js';
import { cn } from '../../lib/cn.js';

export interface AccountAvatarProfile {
  readonly name: string;
  readonly email: string;
  readonly avatarUrl?: string;
  readonly avatarSeed?: string;
}

export function AccountAvatar(props: {
  profile: AccountAvatarProfile;
  size: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const { profile, size } = props;
  if (profile.avatarSeed) {
    return (
      <span aria-hidden="true" className={cn('inline-flex shrink-0', props.className)}>
        <UserAvatar
          user={{ full_name: profile.name, email: profile.email, avatar_seed: profile.avatarSeed }}
          size={size}
        />
      </span>
    );
  }
  if (profile.avatarUrl && !broken) {
    return (
      <img
        src={profile.avatarUrl}
        alt=""
        aria-hidden="true"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className={cn('shrink-0 select-none rounded-full object-cover', props.className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.375, lineHeight: 1.5 }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-alpha-2 font-medium text-sidebar-text-primary',
        props.className,
      )}
    >
      {initialsOf(profile.name || profile.email)}
    </span>
  );
}

export function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  const word = words[0] ?? '';
  return (word.includes('@') ? word.split('@')[0]! : word).slice(0, 2).toUpperCase();
}
