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

import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon';
import { cn } from '../../lib/cn';

/**
 * 分段控件。两档尺寸,实测都在用:
 *
 *            轨道           分段(纯图标时正方)   圆角
 *   default  32 · p-px      30×30              轨道 8 / 段 6
 *   sm       28 · p-px      26×26              轨道 7 / 段 5
 *
 * 图标两档都是 20px —— 缩的是键不是字。
 *   轨道底   bg-alpha-1
 *   选中     bg-surface-3 + --field-shadow,和输入框共用同一条 ring
 *   未选中   透明 · text-muted,hover 提到 text-primary
 *
 * 选中样式直接画在段上,不做滑动 thumb —— 少一层绝对定位元素和一次布局测量。
 */
const TRACK_CLASS = {
  default: 'h-8 rounded-lg',
  sm: 'h-7 rounded-[7px]',
} as const;

const SEGMENT_CLASS = {
  default: 'rounded-md',
  sm: 'rounded-[5px]',
} as const;

export interface SegmentedOption<T extends string> {
  value: T;
  /** 纯图标时作为 aria-label,带文字时作为可见文案 */
  label: string;
  icon?: AnthropiconName;
  /** 有图标时是否同时显示文字(默认只显示图标) */
  showLabel?: boolean;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'default',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  ariaLabel: string;
  size?: keyof typeof TRACK_CLASS;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-fit shrink-0 items-stretch bg-alpha-1 p-px',
        TRACK_CLASS[size],
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        const iconOnly = Boolean(option.icon) && !option.showLabel;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconOnly ? option.label : undefined}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative inline-flex h-full cursor-pointer select-none items-center justify-center gap-1.5 border-0 text-sm leading-5 outline-none transition-colors focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50',
              SEGMENT_CLASS[size],
              iconOnly ? 'aspect-square px-0' : 'px-2.5',
              checked
                ? 'bg-surface-3 text-text-primary shadow-[var(--field-shadow)]'
                : 'bg-transparent text-text-muted hover:text-text-primary',
            )}
          >
            {option.icon && <Anthropicon name={option.icon} size={20} />}
            {!iconOnly && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
