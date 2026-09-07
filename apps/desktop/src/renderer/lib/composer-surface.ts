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
 * Composer 白面的三态投影,单聊 / 群聊 / 私聊共用。
 *
 * hover 那档带 `:not(:has(button:hover,…))`:鼠标停在框内控件上时不点亮整框描边,
 * 否则按钮自己的 hover 和整框的环会叠成两层反馈。拖拽态是互斥的另一档,调用方自己选。
 */
export const COMPOSER_SHADOW_CLASS =
  'shadow-[var(--composer-shadow)] hover:[&:not(:where(:has(button:hover,a:hover,[role=button]:hover,label:hover)))]:shadow-[var(--composer-shadow-hover)] focus-within:shadow-[var(--composer-shadow-focus)]';

/**
 * meta 行的 chip,Project / Agents 共用 —— 同一行同一档,各写各的迟早分叉。
 * 24 高 / 13px / 圆角 6 / px-2 / 无图标,有值时换实心 accent。
 *
 * ! 填充只能走 squish 的变体类:`.ui-control-squish` 的 background 和
 * `--control-fill` 都不在 @layer 里,`bg-*` 和 `[--control-fill:…]` 都赢不了它。
 */
export const COMPOSER_META_CHIP =
  'ui-control-squish inline-flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-md border-0 px-2 text-[13px] leading-[1.4] outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-60';

export const COMPOSER_META_CHIP_IDLE = 'ui-control-squish-ghost text-text-secondary';

export const COMPOSER_META_CHIP_ACTIVE = 'ui-control-squish-accent text-accent';

/** meta 行左侧没有任何 chip 时的补位文案 —— 不是常驻信息,也不会为它单独撑出一行。 */
export const COMPOSER_DISCLAIMER =
  'Copilot can make mistakes. Please double-check important information.';

export const COMPOSER_DISCLAIMER_CLASS =
  'min-w-0 truncate text-[13px] leading-[1.4] text-text-muted';
