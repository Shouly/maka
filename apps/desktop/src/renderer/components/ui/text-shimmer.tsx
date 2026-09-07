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

import React, { useMemo } from 'react';
import { cn } from '../../lib/cn';

interface TextShimmerProps {
  children: string;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

export const TextShimmer = React.memo(
  function TextShimmer({
    children,
    as: Component = 'span',
    className,
    duration = 2,
    spread = 2,
  }: TextShimmerProps) {
    const dynamicSpread = useMemo(() => {
      return (children?.length ?? 0) * spread;
    }, [children, spread]);

    if (!children) {
      return null;
    }

    // 🎯 使用 CSS 动画代替 motion，避免被 React 重新渲染打断
    return (
      <Component
        className={cn(
          'relative inline-block bg-[length:250%_100%,auto] bg-clip-text',
          // 基色 = 文字次要档;扫光那一档取页面底色,所以光扫过时字会"化"进背景。
          // 两个变量原来取自已废弃的 accent-foreground / background。
          'text-transparent [--base-color:var(--text-secondary)] [--base-gradient-color:var(--surface-1)]',
          '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
          'animate-shimmer',
          className,
        )}
        style={
          {
            '--spread': `${dynamicSpread}px`,
            '--shimmer-duration': `${duration}s`,
            backgroundImage: `var(--bg), linear-gradient(var(--base-color), var(--base-color))`,
          } as React.CSSProperties
        }
      >
        {children}
      </Component>
    );
  },
  (prevProps, nextProps) => {
    // 🎯 自定义比较：只比较真正影响渲染的属性
    return (
      prevProps.children === nextProps.children &&
      prevProps.className === nextProps.className &&
      prevProps.duration === nextProps.duration &&
      prevProps.spread === nextProps.spread &&
      prevProps.as === nextProps.as
    );
  },
);
