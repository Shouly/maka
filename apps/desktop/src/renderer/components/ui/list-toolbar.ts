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

// The list-toolbar control class strings. In the reference design system these
// live inside `ui/list-page-header.tsx`, which is a Next.js page component
// (it reaches for the app's sidebar toggle) and is not ported; `sort-select`
// only ever wanted the class strings, so they are re-homed here as a
// class-string module alongside the others.

/** Secondary toolbar control: 32 high, ghost fill, no border. */
export const listToolbarButtonClass =
  // 不要加 [font-variation-settings:'wght' N]:它直接控制可变字体的字重轴,
  // 优先级高过 font-normal,字重交给 font-* 类就行。
  'ui-control-squish h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-lg border-0 px-3 text-sm font-normal leading-5 text-text-primary outline-none transition-shadow focus-visible:shadow-[var(--sidebar-focus-shadow)]';
