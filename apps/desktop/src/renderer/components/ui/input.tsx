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
 * 单行输入框。与 Textarea 共用一套 field 外观(见 fieldSurfaceClass)。
 */

import * as React from "react"
import { cn } from "../../lib/cn"
import { fieldSurfaceClass } from "./field-surface"

// 空接口继承等价于 type 别名 —— 用 type 才不会被 lint 判成"声明了个啥都没加的接口"
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // 高度跟 Button 同步:桌面端 32(CDS h-control),移动端留一档触控余量
        className={cn(fieldSurfaceClass, "h-9 md:h-8 px-3", className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
