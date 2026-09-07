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
 * 输入类控件的统一表面(CDS field 同构),Input / Textarea 共用。
 *
 * 描边走 box-shadow 的 1px inset ring,不用真 border —— 和弹框卡面同理:
 * 不占布局、不吃圆角、focus 时能和外发光叠在同一个属性上做过渡,不会出现
 * "边框跳一下 + 光晕再淡入"两段动画。
 *
 * hover 用 [&:hover:not(:focus)] 而不是 hover:,否则聚焦状态下移入鼠标会
 * 把聚焦环覆盖掉(Tailwind 里 hover 和 focus-visible 的优先级取决于变体
 * 顺序,不该赌)。
 */
export const fieldSurfaceClass = [
  "w-full rounded-lg text-sm",
  "bg-fill-field text-text-primary placeholder:text-text-muted",
  "shadow-[var(--field-shadow)]",
  "[&:hover:not(:focus):not(:disabled)]:shadow-[var(--field-shadow-hover)]",
  "outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] focus:shadow-[var(--sidebar-focus-shadow)]",
  "transition-shadow duration-[var(--dur-fast)] ease-out",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ")
