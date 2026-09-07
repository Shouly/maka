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

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  /**
   * icon 是**方形图标键**:32×32,两端断点同尺寸、无横向内距。
   * iconSm 是它小一档:28×28 —— 面板 header 那排动作键、密排工具条用这个。
   *
   * 别再用 `size="sm"`+`size-8`凑 —— sm 是`h-8 md:h-7 px-2.5`,那个`md:h-7`
   * 是响应式变体,twMerge 覆盖不掉,桌面端会变成 28×32 的扁键。全仓 28 处踩过。
   */
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'iconSm';
  fullWidth?: boolean;
}

/**
 * 按钮的表面(填充/hover/按压)一律交给 .ui-control-squish —— 它把 CDS 的
 * cds-btn-squish 复刻成一层 ::before：填充画在伪元素上,按下时只有这层缩
 * 0.975,文字和命中区不动。所以这里不要再写 bg-x 或 hover:bg-x,那会盖在
 * squish 层上面、把按压反馈遮掉。
 *
 * hover 一律用**独立的一档颜色**(--fill-*-hover),不是 /90 透明度淡出：
 * 实心按钮压透明度会露出底色变浅,在白底上看着像禁用。
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      asChild = false,
      fullWidth = false,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg select-none cursor-pointer outline-none',
          'focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:opacity-50 disabled:pointer-events-none',
          variant !== 'link' && 'ui-control-squish',
          {
            // 实心黑(CDS fill-primary)。原来是 bg-primary —— 那是品牌橙
            // rgb(217,119,87),和新体系的主按钮完全不是一个东西。
            'ui-control-squish-primary text-on-primary font-medium': variant === 'default',
            // secondary 就是 CDS 的 field 外观:白 10% 填充 + 1px inset 描边,
            // 不是实色暖米底(#e8e6dc)加一圈真边框。outline 在新体系里和它
            // 同一张脸,保留变体名只为不改 92 个调用点的 API。
            'text-text-primary font-normal': variant === 'secondary' || variant === 'outline',
            'ui-control-squish-danger text-on-danger font-medium': variant === 'destructive',
            'ui-control-squish-ghost text-text-primary font-normal': variant === 'ghost',
            'text-text-primary underline-offset-4 hover:underline font-normal': variant === 'link',

            // 高度对齐 CDS 的 h-control = 32px。移动端仍留一档触控余量
            // (36px),桌面端严格 32。原来是 40/36,横向 padding 也多 4px。
            'h-9 md:h-8 px-3 text-sm': size === 'default',
            'h-8 md:h-7 px-2.5 text-xs': size === 'sm',
            'h-10 md:h-9 px-4 text-sm': size === 'lg',
            // 方形图标键:不带 px,两端断点都是 32
            'size-8 p-0 text-sm': size === 'icon',
            // 圆角跟着键缩一档(8→7):实测上游 32 的键 r8、28 的键 r7,
            // 同一个 r8 套在小一圈的键上会显得钝。
            'size-7 rounded-[7px] p-0 text-sm': size === 'iconSm',

            'w-full': fullWidth,
          },
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button };
