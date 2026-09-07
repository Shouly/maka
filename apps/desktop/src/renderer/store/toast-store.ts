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
import type { ToastActionElement, ToastProps } from '../components/ui/toast';

/**
 * 同屏最多几条。不设上限是危险的:批量操作里每失败一项 toast 一次(仓里
 * 就有 `list.map(... catch → toast(...))` 这种写法),十几条能糊掉半个屏。
 * 参照实现同样是有上限的 —— 它给超出的那些挂 `data-limited` 直接压成
 * opacity:0,那就是"看得见的只有前 N 条"。
 */
const TOAST_LIMIT = 3;

/**
 * 关闭到从数组里摘掉之间的延时 —— 只是给退场动画留的时间,不是显示时长。
 * 原来是 10000,等于每条 toast 关掉之后还在数组里挂 10 秒。
 * 退场动画 200ms,留到 400 足够。
 */
const TOAST_REMOVE_DELAY = 400;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

const actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  UPDATE_TOAST: 'UPDATE_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | {
      type: ActionType['ADD_TOAST'];
      toast: ToasterToast;
    }
  | {
      type: ActionType['UPDATE_TOAST'];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType['DISMISS_TOAST'];
      toastId?: ToasterToast['id'];
    }
  | {
      type: ActionType['REMOVE_TOAST'];
      toastId?: ToasterToast['id'];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: 'REMOVE_TOAST',
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD_TOAST': {
      // 超出上限的**标记关闭**,让它把退场动画走完再被 REMOVE 摘掉;
      // 原来是 `.slice(0, LIMIT)` 直接从数组里切走,元素当场消失,
      // 退场动画根本没机会播 —— LIMIT=1 时表现就是新的一来旧的硬闪没。
      const next = [action.toast, ...state.toasts];
      next.slice(TOAST_LIMIT).forEach((t) => addToRemoveQueue(t.id));
      return {
        ...state,
        toasts: next.map((t, i) => (i >= TOAST_LIMIT ? { ...t, open: false } : t)),
      };
    }

    case 'UPDATE_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case 'DISMISS_TOAST': {
      const { toastId } = action;

      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, 'id'>;

function toast({ ...props }: Toast) {
  const id = genId();

  const update = (props: ToasterToast) =>
    dispatch({
      type: 'UPDATE_TOAST',
      toast: { ...props, id },
    });
  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id });

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  // 这里原来还挂了一个 `setTimeout(dismiss, 10000)` 的手写自动关闭,存进了
  // toastTimeouts —— 和 addToRemoveQueue 用的是**同一个 map**。后果:
  // dismiss 触发时 addToRemoveQueue 看到 `has(id)` 为真就提前 return,
  // REMOVE 永远排不上队,每条 toast 关掉后都永久留在数组里;
  // LIMIT=1 时被 slice 顺手挤掉才没暴露,一旦放开条数就会无限堆积。
  //
  // 而且它也从来没生效过:显示时长由 Radix 的 duration 管(ToastProvider 上
  // 已显式声明),5 秒就会先触发 onOpenChange(false)。

  return {
    id: id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  };
}

export { useToast, toast };
export function dismissToastById(toastId: string): void {
  dispatch({ type: 'DISMISS_TOAST', toastId });
}
