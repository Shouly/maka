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

// 设置页的分区 / 行骨架,来自参照设计的 `components/settings/settings-row.tsx`,
// 逐字照抄(它是纯展示组件,只把 `@/lib/utils` 换成本仓的 `lib/cn`)。
//
//   分区      下边距 40px,标题 15/20 · 580,到首行 12px
//   行        padding 12px 0 · 左右列间距 28px
//   行标题     14/20 · 400        行说明 13/18 · text-secondary
//   分隔线     1px alpha-1,只画在相邻两行之间,首行上面没有
//
// 排版是「左说明、右控件」的横排,不是「标签在上、输入框在下」的竖排表单 ——
// 设置页和弹框表单最大的形态差别,别混用。
//
// ! 分隔线用 `border-t` 不是 `border`:仓里 `@utility border` 被改成 0.5px,
// 只影响裸 `border`,`border-t` 仍是 1px。

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  ...rest
}: {
  /** 不传就只有一组行,不画标题(纯跳转入口那种分组) */
  title?: string;
  description?: ReactNode;
  /** 分区级动作,贴在标题行右侧(New / Register 这类) */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
} & Pick<HTMLAttributes<HTMLElement>, 'id'>) {
  return (
    <section className={cn('mb-10 last:mb-0', className)} {...rest}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-7">
          <div className="flex min-w-0 flex-col gap-1">
            {/* `.` 作用域下 font-semibold 解析成 580 */}
            {title && (
              <h2 className="text-[15px] font-semibold leading-5 text-text-primary">{title}</h2>
            )}
            {description && (
              <p className="text-[13px] leading-[18px] text-text-secondary">{description}</p>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center">{action}</div>}
        </div>
      )}
      <div className="[&>*:not(:first-child)]:border-t [&>*:not(:first-child)]:border-alpha-1">
        {children}
      </div>
    </section>
  );
}

/**
 * 一行设置项。默认横排(左文右控件);`layout="stacked"` 用于控件本身要占满
 * 整行的场景(多行文本、卡片组),此时说明文字在上、控件在下。
 */
export function SettingsRow({
  title,
  description,
  control,
  children,
  layout = 'inline',
  htmlFor,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** 横排时右侧的控件 */
  control?: ReactNode;
  /** 竖排时下方的内容 */
  children?: ReactNode;
  layout?: 'inline' | 'stacked';
  /** 传了就把标题渲染成 <label>,点标题能聚焦控件 */
  htmlFor?: string;
  className?: string;
}) {
  const TitleTag = htmlFor ? 'label' : 'span';

  const head = (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <div className="text-sm leading-5 text-text-primary">
        <TitleTag
          {...(htmlFor ? { htmlFor } : {})}
          className={cn('inline-block', htmlFor && 'cursor-pointer')}
        >
          {title}
        </TitleTag>
      </div>
      {description && (
        <p className="text-[13px] leading-[18px] text-text-secondary">{description}</p>
      )}
    </div>
  );

  if (layout === 'stacked') {
    return (
      <div className={cn('flex flex-col gap-2 py-3', className)}>
        {head}
        {children}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-between gap-7 py-3', className)}>
      {head}
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  );
}

/** 设置行里文本输入的固定宽度,224px */
export const settingsFieldWidthClass = 'w-56';

/** 设置页里的面板(用量卡、权重表这类):hairline 描边,底色与页面同档 */
export const settingsPanelClass = 'rounded-xl border border-hairline bg-surface-1';

/**
 * 行右侧的「跳转到别处」动作:文案 + 12px caret,ghost squish 底。
 * -mr-2.5 抵掉自己的 px-2.5,让文案右沿和同列的开关/按钮对齐。
 */
export const settingsRowLinkClass =
  'ui-control-squish ui-control-squish-ghost -mr-2.5 inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-sm leading-5 text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]';
