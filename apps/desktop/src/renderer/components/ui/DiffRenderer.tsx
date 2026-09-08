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

import { memo } from 'react';
import { useUiLocale } from '@maka/ui';
import { getUiCopy } from '../../locales/ui-copy';

interface DiffRendererProps {
  content: string | string[];
  className?: string;
}

// Diff 渲染组件
const DiffRenderer = memo(function DiffRenderer({ content, className = '' }: DiffRendererProps) {
  const noChanges = getUiCopy(useUiLocale()).noChanges;
  // 处理内容，确保是字符串数组
  const lines = Array.isArray(content) ? content : content.split('\n');

  const renderDiffLine = (line: string, index: number) => {
    const trimmedLine = line.trim();

    // 检测行类型
    if (trimmedLine.startsWith('+')) {
      // 添加的行
      return (
        <div key={index} className="flex">
          <span className="w-6 text-xs text-center text-accent bg-accent-fill/10 select-none flex items-center justify-center">
            +
          </span>
          <pre className="flex-1 px-3 py-1 bg-accent-fill/5 text-accent overflow-x-auto leading-5">
            {line.substring(1)} {/* 移除 + 前缀 */}
          </pre>
        </div>
      );
    } else if (trimmedLine.startsWith('-')) {
      // 删除的行
      return (
        <div key={index} className="flex">
          <span className="w-6 text-xs text-center text-danger bg-danger-fill/10 select-none flex items-center justify-center">
            -
          </span>
          <pre className="flex-1 px-3 py-1 bg-danger-fill/5 text-danger overflow-x-auto leading-5">
            {line.substring(1)} {/* 移除 - 前缀 */}
          </pre>
        </div>
      );
    } else {
      // 上下文行（未修改）
      return (
        <div key={index} className="flex">
          {/* 上下文行不上底色:+/- 靠色块跳出来,靠的就是它们之间这片留白 */}
          <span className="w-6 text-xs text-center text-text-muted select-none flex items-center justify-center"></span>
          <pre className="flex-1 px-3 py-1 text-text-secondary overflow-x-auto leading-5">
            {line.startsWith(' ') ? line.substring(1) : line} {/* 移除可能的空格前缀 */}
          </pre>
        </div>
      );
    }
  };

  return (
    <div className={`rounded overflow-hidden ${className}`}>
      {/* Diff 内容 */}
      <div className="font-mono font-normal text-sm max-h-96 overflow-y-auto">
        {lines.length > 0 ? (
          lines.map((line, index) => renderDiffLine(line, index))
        ) : (
          <div className="px-3 py-2 text-text-muted text-center">{noChanges}</div>
        )}
      </div>
    </div>
  );
});

export default DiffRenderer;
