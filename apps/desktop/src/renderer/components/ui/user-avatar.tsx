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

/**
 * UserAvatar — single source of truth for avatar rendering across the
 * entire app (sidebar / DM / group chat / project members / admin /
 * settings / member dialogs).
 *
 * Behavior:
 *  - `isSelf` → Bookmark tile (Notes-to-self surfaces only).
 *  - `avatar_seed` non-null → Avvvatars 形状(形状选择逻辑原封不动,用户形状
 *    与历史一致),但配色由外层接管:低饱和暖色对(与奶油主题同族,对照
 *    Claude 生成头像的气质)。实现 = CSS !important 压掉库的内置配色:
 *    底色透明化(由容器画暖底),形状填色经 CSS 变量注入暖前景。
 *  - else → initials 圆盘(原版中性灰,不参与暖色系)。
 *
 * Use this everywhere. Do NOT inline `<div bg-muted-foreground rounded-full>`
 * snippets — drift kills consistency and we lose the avatar_seed signal.
 */

import Avvvatars from 'avvvatars-react';

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons';
import { getUiCopy } from '../../locales/ui-copy';
import { cn } from '../../lib/cn';
import { AVATAR_WARM_PAIRS, hashAvatarSeed } from '../../lib/avatar-warm-palette';

interface UserLike {
  id?: string;
  email?: string | null;
  nickname?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  avatar_seed?: string | null;
}

interface UserAvatarProps {
  user: UserLike;
  size?: number;
  /** Render the Notes-to-self tile (Bookmark icon on neutral bg). */
  isSelf?: boolean;
  className?: string;
}

function deriveInitials(user: UserLike): string {
  const nickname = user.nickname?.trim();
  if (nickname) return nickname.slice(0, 2).toUpperCase();
  // The reference design calls `getUserAvatarInitials`, which takes relx's
  // REST `User` shape. Maka has no such record, so the same rules are applied
  // to the fields this component already declares.
  const fullName = user.full_name?.trim();
  if (fullName) {
    if (fullName.length <= 3 && /^[A-Z]+$/.test(fullName)) return fullName;
    const words = fullName.split(/\s+/).filter(Boolean);
    if (words.length >= 2)
      return words
        .slice(0, 2)
        .map((word) => word[0].toUpperCase())
        .join('');
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  }
  const email = user.email?.trim();
  if (email) return email.split('@')[0].slice(0, 2).toUpperCase();
  return '';
}

export function UserAvatar({ user, size = 36, isSelf = false, className }: UserAvatarProps) {
  const notesToSelf = getUiCopy(useUiLocale()).notesToSelf;
  const displayName = user.nickname || user.full_name || user.email || '';

  if (isSelf) {
    return (
      <div
        className={cn(
          'rounded-full bg-fill-primary text-on-primary flex items-center justify-center flex-shrink-0',
          className,
        )}
        style={{ width: size, height: size }}
        aria-label={notesToSelf}
        title={notesToSelf}
      >
        {/* Anthropicon 没有 bookmark,"Notes to self" 取语义最近的 note */}
        <Anthropicon name="note" size={size >= 32 ? 20 : 16} />
      </div>
    );
  }

  if (user.avatar_seed) {
    const [bg, fg] = AVATAR_WARM_PAIRS[hashAvatarSeed(user.avatar_seed) % AVATAR_WARM_PAIRS.length];
    return (
      <div
        className={cn(
          'flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center',
          // 压掉 Avvvatars 的内置配色:内层 wrapper 底透明(暖底由本容器画),
          // 形状的 fill 统一改为 CSS 变量注入的暖前景
          '[&_div]:!bg-transparent [&_div]:!shadow-none',
          '[&_path]:!fill-[var(--avv-fg)] [&_rect]:!fill-[var(--avv-fg)]',
          '[&_circle]:!fill-[var(--avv-fg)] [&_polygon]:!fill-[var(--avv-fg)]',
          '[&_ellipse]:!fill-[var(--avv-fg)]',
          className,
        )}
        style={{
          width: size,
          height: size,
          backgroundColor: bg,
          ['--avv-fg' as string]: fg,
        }}
        aria-label={displayName}
        title={displayName}
      >
        <Avvvatars value={user.avatar_seed} size={size} style="shape" radius={size} />
      </div>
    );
  }

  const initials = deriveInitials(user) || '?';

  return (
    <div
      className={cn(
        'rounded-full bg-fill-primary text-on-primary flex items-center justify-center font-semibold flex-shrink-0 select-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.4)),
      }}
      aria-label={displayName}
      title={displayName}
    >
      {initials}
    </div>
  );
}
