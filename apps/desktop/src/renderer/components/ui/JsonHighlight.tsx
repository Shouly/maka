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

import Prism from 'prismjs';
import { memo, useMemo, useState } from 'react';
import { Anthropicon } from '../icons';

// 确保 JSON 语言支持已加载
import 'prismjs/components/prism-json';

interface JsonHighlightProps {
  content: string;
  title?: string;
  className?: string;
  compact?: boolean;
}

// 检测内容是否是 JSON
const isJsonContent = (content: string): boolean => {
  if (!content || typeof content !== 'string') return false;

  const trimmed = content.trim();
  if (!trimmed) return false;

  // 简单检测：以 { 或 [ 开头
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  return false;
};

const JsonHighlight = memo(
  function JsonHighlight({ content, title, className = '', compact = false }: JsonHighlightProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    };

    // 缓存JSON检测和高亮结果
    const highlightedContent = useMemo(() => {
      if (!content.trim()) {
        return { html: content || '', isJson: false };
      }

      const isJson = isJsonContent(content);

      if (!isJson) {
        // 非JSON内容也处理换行符
        const processedContent = content.replace(/\\n/g, '\n');
        return { html: processedContent, isJson: false };
      }

      try {
        // 首先在原始内容中处理换行符
        const preprocessedContent = content.replace(/\\n/g, '\n');

        // 格式化JSON以便更好地显示
        let formattedContent = preprocessedContent;
        try {
          const parsed = JSON.parse(preprocessedContent);
          formattedContent = JSON.stringify(parsed, null, 2);
        } catch {
          // 如果解析失败，使用预处理过的内容
          formattedContent = preprocessedContent;
        }

        // 使用 Prism 高亮 JSON
        const highlighted = Prism.highlight(formattedContent, Prism.languages.json, 'json');

        // 返回高亮后的HTML
        const processedHtml = highlighted;

        return { html: processedHtml, isJson: true };
      } catch (error) {
        // 高亮失败，返回原始内容
        console.warn('Prism JSON highlighting failed:', error);
        return { html: content, isJson: false };
      }
    }, [content]);

    return (
      <div
        className={`relative bg-surface-1 rounded-lg overflow-hidden custom-json-highlight ${className}`}
      >
        {/* 复制按钮 - 固定在右上角 */}
        <button
          type="button"
          onClick={handleCopy}
          className={`ui-control-squish ui-control-squish-ghost absolute top-2 right-2 z-10 inline-flex items-center justify-center rounded-md cursor-pointer text-text-muted outline-none transition-colors hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] ${compact ? 'p-1' : 'p-1.5'}`}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'Copied!' : 'Copy'}
        >
          <Anthropicon name={copied ? 'check' : 'copy'} size={16} />
        </button>

        {/* 标题 */}
        {title && (
          <div className={compact ? 'px-2 py-0.5' : 'px-3 py-1'}>
            <span
              className={`${compact ? 'text-[10px]' : 'text-[11px]'}  font-medium text-text-muted`}
            >
              {title}
            </span>
          </div>
        )}

        {highlightedContent.isJson ? (
          <pre
            className="font-mono font-normal whitespace-pre-wrap break-words language-json"
            style={{
              margin: 0,
              padding: compact ? '2px 8px' : '4px 12px',
              background: 'transparent',
              fontSize: compact ? '12px' : '14px',
              lineHeight: compact ? '1.3' : '1.4',
              wordBreak: 'break-word',
            }}
          >
            <code
              className="language-json"
              style={{ background: 'transparent', whiteSpace: 'pre-wrap' }}
              dangerouslySetInnerHTML={{ __html: highlightedContent.html }}
            />
          </pre>
        ) : (
          <pre
            className={`${compact ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'} text-text-secondary font-mono font-normal whitespace-pre-wrap break-words`}
          >
            {content}
          </pre>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数：只在内容、标题或类名变化时重渲染
    return (
      prevProps.content === nextProps.content &&
      prevProps.title === nextProps.title &&
      prevProps.className === nextProps.className &&
      prevProps.compact === nextProps.compact
    );
  },
);

JsonHighlight.displayName = 'JsonHighlight';

export default JsonHighlight;
