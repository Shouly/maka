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


import React from 'react';
import { TextShimmer } from './text-shimmer';

interface ShimmerTitleProps {
  title: string;
  isLoading?: boolean;
  className?: string;
  duration?: number;
  spread?: number;
  as?: React.ElementType;
}

// 专门用于工具标题的shimmer组件
export const ShimmerTitle = React.memo(function ShimmerTitle({
  title,
  isLoading = true,
  className = "text-sm flex-1 min-w-0 truncate",
  duration = 2,
  spread = 3,
  as = 'span'
}: ShimmerTitleProps) {
  if (!isLoading) {
    const Component = as;
    return (
      // 和 TextShimmer 的基色同为 text-secondary:加载结束时标题不该换颜色。
      // 原来这里是 text-muted-foreground、扫光基色却是 accent-foreground,
      // 两者差一档,"Thinking…" 停下的瞬间会跳一下。
      <Component className={`${className} text-text-secondary`}>
        {title}
      </Component>
    );
  }

  return (
    <TextShimmer
      duration={duration}
      spread={spread}
      className={className}
      as={as}
    >
      {title}
    </TextShimmer>
  );
}, (prevProps, nextProps) => {
  // 🎯 自定义比较：只比较真正影响渲染的属性
  return (
    prevProps.title === nextProps.title &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.className === nextProps.className &&
    prevProps.duration === nextProps.duration &&
    prevProps.spread === nextProps.spread &&
    prevProps.as === nextProps.as
  );
});