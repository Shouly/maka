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

import { useToast } from '../../store/toast-store'
import {
  Toast,
  ToastClose,
  ToastProvider,
  ToastViewport,
  ToastIcon,
} from './toast'

export function Toaster() {
  const { toasts } = useToast()

  return (
    // 卡片落在右下角,手势方向也跟着改成向下划走(默认是 right)。
    // duration 显式写出来:显示时长一直是 Radix 在管(默认就是 5s),
    // useToast 里那个手写的 10 秒定时器从来没赢过它,已经删掉。
    <ToastProvider swipeDirection="down" duration={5000}>
      {toasts.map(function ({ id, title, description, action, variant = 'default', ...props }) {
        return (
          <Toast key={id} variant={variant} {...props}>
            {/* items-start:两行以上的文案时,图标和关闭键贴第一行,不跟着居中飘。
                px-4 py-3 + 20 行高 = 单行 44px,与参照实测一致。 */}
            <div className="flex items-start gap-2 px-4 py-3">
              <ToastIcon variant={variant} />
              <div className="min-w-0 flex-1 text-sm font-medium leading-5">
                {description || title}
              </div>
              {action}
              {/* 负外边距把 32 的点击区收回到 20 的视觉行里,不额外撑高卡片 */}
              <ToastClose className="-mr-1 -mt-0.5 -mb-1" />
            </div>
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
