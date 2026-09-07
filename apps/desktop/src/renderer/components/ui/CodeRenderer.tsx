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

import React, { useRef, useEffect, useMemo } from 'react';
import Prism from 'prismjs';

// 按需导入语言支持
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markup'; // HTML/XML
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-mermaid';

interface CodeRendererProps {
  content: string;
  language?: string;
  className?: string;
  autoScroll?: boolean; // 是否自动滚动
  scrollToText?: string; // 滚动到指定文本位置（用于update操作）
  showLineNumbers?: boolean; // 是否显示行号
  fontSize?: string; // 自定义字号，默认 '14px'
  fontFamily?: string; // 自定义字体栈，默认系统 --font-mono(anthropic-mono)
}

// 映射到 Prism 支持的语言
const mapToPrismLanguage = (content: string, providedLanguage?: string): string => {
  if (providedLanguage && providedLanguage !== 'auto') {
    // 映射常见语言名到 Prism 语言名
    const langMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      html: 'markup',
      xml: 'markup',
      sh: 'bash',
      shell: 'bash',
      mermaid: 'mermaid',
    };
    return langMap[providedLanguage] || providedLanguage;
  }

  const trimmed = content.trim();

  // 自动检测语言
  if (trimmed.includes('import ') && (trimmed.includes('from ') || trimmed.includes('export '))) {
    if (trimmed.includes('useState') || trimmed.includes('useEffect') || trimmed.includes('jsx')) {
      return 'jsx';
    }
    return 'javascript';
  }

  if (trimmed.includes('def ') || (trimmed.includes('import ') && trimmed.includes('python'))) {
    return 'python';
  }

  if (trimmed.includes('<html') || trimmed.includes('<!DOCTYPE')) {
    return 'markup';
  }

  if (trimmed.includes('SELECT ') || trimmed.includes('FROM ') || trimmed.includes('WHERE ')) {
    return 'sql';
  }

  // 默认使用 javascript 高亮，能识别常见的关键字、字符串、注释等
  return 'javascript';
};

const CodeRenderer = React.memo(
  ({
    content,
    language = 'auto',
    className = '',
    autoScroll = false,
    scrollToText,
    showLineNumbers = true,
    fontSize = '14px',
    fontFamily,
  }: CodeRendererProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!autoScroll && !scrollToText) return;

      if (containerRef.current) {
        const scrollContainer = containerRef.current.closest('.overflow-y-auto');
        if (scrollContainer) {
          requestAnimationFrame(() => {
            // 如果指定了要滚动到的文本，优先滚动到该位置
            if (scrollToText) {
              const textContent = content || '';
              const textIndex = textContent.indexOf(scrollToText);

              if (textIndex !== -1) {
                // 估算文本位置的像素偏移
                const lines = textContent.substring(0, textIndex).split('\n');
                const lineHeight = 21; // 实际行高：14px * 1.5 = 21px
                const codeTop = (lines.length - 1) * lineHeight;

                // 加上父容器的 padding (p-4 = 16px)
                const containerPadding = 16;
                const approximateTop = codeTop + containerPadding;

                // 滚动到目标位置，让更新内容显示在视口上方（约1/4位置）
                const targetScrollTop = Math.max(
                  0,
                  approximateTop - scrollContainer.clientHeight / 4,
                );
                scrollContainer.scrollTop = targetScrollTop;
                return;
              }
            }

            // 默认行为：滚动到底部
            if (autoScroll) {
              scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
          });
        }
      }
    }, [content, autoScroll, scrollToText]);

    const prismLanguage = mapToPrismLanguage(content, language);

    // 高亮整个内容，然后按行分割
    const highlightedLines = useMemo(() => {
      if (!content) return [''];

      try {
        const highlighted = Prism.highlight(
          content,
          Prism.languages[prismLanguage] || Prism.languages.javascript,
          prismLanguage,
        );
        // 按换行符分割高亮后的HTML
        return highlighted.split('\n');
      } catch (error) {
        console.warn('Prism highlighting failed:', error);
        return content.split('\n');
      }
    }, [content, prismLanguage]);

    return (
      <div ref={containerRef} className={`overflow-hidden custom-code-highlight ${className}`}>
        <div
          className={`font-normal language-${prismLanguage}`}
          style={{ fontSize, lineHeight: '1.5', fontFamily: fontFamily ?? 'var(--font-mono)' }}
        >
          {highlightedLines.map((lineHtml, index) => (
            <div key={index} className="flex">
              {showLineNumbers && (
                <span
                  className="inline-block select-none text-right flex-shrink-0 font-normal"
                  style={{
                    minWidth: '2.5rem',
                    paddingRight: '1em',
                    // 行号跟代码块同一套配色 token(见 globals.css 的 --code-*),
                    // 原来写死 #a0a1a7,深色下不跟主题翻
                    color: 'var(--code-comment)',
                    opacity: 0.667,
                  }}
                >
                  {index + 1}
                </span>
              )}
              <code
                className="flex-1 whitespace-pre-wrap break-words"
                // fontFamily inherit:压过 Tailwind preflight 对 code 元素的 mono 设置,跟随外层包装的字体
                style={{ background: 'transparent', fontFamily: 'inherit' }}
                dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  },
);

CodeRenderer.displayName = 'CodeRenderer';

export default CodeRenderer;
