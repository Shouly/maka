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
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Anthropicon } from '../icons';
import { cn } from '../../lib/cn';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    data-app-dialog-overlay=""
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-dialog-overlay backdrop-blur-[2px]', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      // 模态对话框的稳定标记。Radix 的 Popover 内容同样带 role="dialog",
      // 靠角色分不出"真模态"和"浮层",需要识别时认这个属性。
      data-app-dialog=""
      className={cn(
        // 两层结构(Cowork 同构):
        //   root  = 定位 + 尺寸 + 卡面,**不写 padding**,被视口高度封顶
        //   inner = 唯一的滚动容器,也是唯一写 padding 的地方
        // 这样"内容到边框 24px"是结构保证的,不靠每个弹框自觉;而且内容少时
        // flex-1 贴合内容、内容多时内部滚动,一套结构覆盖两种情况 —— 不需要
        // 再给基元加"可滚动变体",也不该有人再写 p-0 gap-0 关掉基元自己搭。
        //
        // className 落在 **root** 上。要改内边距/间距请改基元,不要在调用点
        // 传 p-* / gap-*,那会落到 root 上、对不上内容(root 没有 padding)。
        'fixed left-[50%] top-[50%] z-50 flex flex-col w-full max-w-[calc(100%-2rem)] md:max-w-md translate-x-[-50%] translate-y-[-50%] max-h-[calc(100dvh-2rem)] bg-surface-3 rounded-xl shadow-[var(--dialog-shadow)]',
        className,
      )}
      {...props}
    >
      <div className="isolate flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-[inherit] p-6">
        {children}
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  hideCloseButton?: boolean;
  closeLabel?: string;
}

const DialogHeader = ({
  className,
  children,
  hideCloseButton = false,
  closeLabel = 'Close',
  ...props
}: DialogHeaderProps) => (
  <div className={cn('flex items-start justify-between gap-4', className)} {...props}>
    {/* gap-1 = 4px:Cowork 的标题↔描述间距 */}
    <div className="flex flex-col gap-1 text-left flex-1 min-w-0">{children}</div>
    {/* 关闭按钮静止态就是文字主色(Cowork 实测 rgb(11,11,11)),hover 只加 5%
        底、不变色 —— 关闭是弹框里唯一的常驻操作,不该默认压成次要灰。 */}
    {!hideCloseButton && (
      <DialogPrimitive.Close className="shrink-0 rounded-lg text-text-primary transition-colors hover:bg-sidebar-menu-hover focus:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none h-8 w-8 flex items-center justify-center -mr-1 -mt-1 cursor-pointer">
        <Anthropicon name="x" size={20} />
        <span className="sr-only">{closeLabel}</span>
      </DialogPrimitive.Close>
    )}
  </div>
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // gap-3 = 12px(Cowork 实测)。原来是 space-x-2 = 8px,且 space-x 在
      // flex-col-reverse 的移动端布局下不生效,gap 两个方向都对。
      'flex flex-col-reverse gap-3 md:flex-row md:justify-end',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      // 22/28 + semibold(580),三项都是 Cowork 实测值。
      // 本仓的字重刻度已按 CDS 定成 medium 500 / semibold 580 / bold 600,
      // 所以这里的 font-semibold 直接就是 580,不用再写死数值。
      'text-[22px] font-semibold leading-7 text-text-primary',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-5 text-text-secondary', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
