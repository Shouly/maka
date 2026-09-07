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
 * 多行输入框。与 Input 共用同一套 field 外观 —— 之前仓里没有这个组件,
 * 20 处 <textarea> 各自手抄样式,是弹框内输入框长得不一样的主因。
 */

import * as React from "react"
import { cn } from "../../lib/cn"
import { fieldSurfaceClass } from "./field-surface"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        // py-2 而不是 Input 的定高:多行高度由 rows/min-h 决定
        className={cn(fieldSurfaceClass, "px-3 py-2 resize-y", className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
