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
 * 统一的加载旋转器组件。
 *
 * 尺寸限定在 AnthropiconSize 刻度上,32 是上限:图标字体的 wght 轴是 400–700,
 * 20px 以上没法再靠减字重补偿"字号变大 = 描边变粗",再大描边会明显发胖。
 * 原来默认 80、调用点传 48,那是 phosphor 时代的量级,现在一律封顶 32。
 */

import { Anthropicon, type AnthropiconSize } from '../icons';

interface LoadingSpinnerProps {
  size?: AnthropiconSize;
  className?: string;
  fullScreen?: boolean;
}

export function LoadingSpinner({
  size = 24,
  className = 'text-text-muted',
  fullScreen = true,
}: LoadingSpinnerProps) {
  const spinner = (
    <Anthropicon name="spinner" size={size} className={`animate-spin ${className}`} />
  );

  if (fullScreen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-1">{spinner}</div>
    );
  }

  // fullScreen={false} 时也提供居中容器
  return <div className="flex items-center justify-center">{spinner}</div>;
}
