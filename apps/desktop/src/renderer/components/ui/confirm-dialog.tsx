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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { useUiLocale } from '@maka/ui';
import { Button } from './button';
import { getUiCopy } from '../../locales/ui-copy';
import { cn } from '../../lib/cn';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  closeLabel?: string;
  variant?: 'default' | 'destructive' | 'secondary';
  onConfirm: () => void | Promise<void>;
  waitForConfirm?: boolean;
  restoreFocus?: boolean;
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  closeLabel,
  variant = 'default',
  onConfirm,
  waitForConfirm = false,
  restoreFocus = false,
  fallbackFocusRef,
}: ConfirmDialogProps) {
  const uiCopy = getUiCopy(useUiLocale());
  const resolvedConfirmText = confirmText ?? uiCopy.confirm;
  const resolvedCancelText = cancelText ?? uiCopy.cancel;
  const resolvedCloseLabel = closeLabel ?? uiCopy.close;
  const [isConfirming, setIsConfirming] = React.useState(false);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) setIsConfirming(false);
  }, [open]);

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isConfirming) return;

    if (!waitForConfirm) {
      onConfirm();
      onOpenChange(false);
      return;
    }

    setIsConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Confirmation action failed:', error);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isConfirming) return;
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isConfirming) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="md:max-w-[425px]"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={
          restoreFocus
            ? () => {
                const activeElement = document.activeElement;
                if (activeElement instanceof HTMLElement) {
                  returnFocusRef.current = activeElement;
                }
              }
            : undefined
        }
        onCloseAutoFocus={
          restoreFocus
            ? (event) => {
                event.preventDefault();
                const target = returnFocusRef.current;
                const fallbackTarget = fallbackFocusRef?.current;
                returnFocusRef.current = null;
                window.requestAnimationFrame(() => {
                  if (target?.isConnected) {
                    target.focus();
                  } else if (fallbackTarget?.isConnected) {
                    fallbackTarget.focus();
                  }
                });
              }
            : undefined
        }
      >
        <DialogHeader
          closeLabel={resolvedCloseLabel}
          className={cn(
            restoreFocus && '[&>button:focus-visible]:shadow-[var(--sidebar-focus-shadow)]',
          )}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* 间距交给 DialogFooter 的 gap-3(两个方向都生效)。这里原来是
            gap-2 md:gap-0 —— 桌面端靠基元的 md:space-x-2 补,基元换成 gap 后
            md:gap-0 会让按钮贴在一起。 */}
        <DialogFooter className="md:mt-1">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isConfirming}
            className={cn(
              'w-full md:w-auto',
              restoreFocus && 'focus-visible:shadow-[var(--sidebar-focus-shadow)]',
            )}
          >
            {resolvedCancelText}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={isConfirming}
            aria-busy={isConfirming}
            className={cn(
              'w-full md:w-auto',
              restoreFocus && 'focus-visible:shadow-[var(--sidebar-focus-shadow)]',
            )}
          >
            {resolvedConfirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
