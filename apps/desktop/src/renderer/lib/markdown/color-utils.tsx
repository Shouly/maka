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
 * 颜色处理工具类
 * 用于检测和渲染文本中的颜色值
 */

import React, { ReactNode, ReactElement } from 'react';

// 预编译正则表达式（性能优化：避免重复创建）
const COLOR_REGEX = /#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g;
const COLOR_TEST_REGEX = /#[0-9A-Fa-f]{3,8}\b/;

/** 渲染选项。bare = 外层已经是行内代码壳了,只出色点+文字,不要再自带一层壳。 */
export interface ColorRenderOptions {
  bare?: boolean;
}

/** 行内代码壳。claude.ai 实测:含色值时在同一个 <code> 上追加
 *  inline-flex + items-center + h-5(20px 定高)—— 靠壳自己定高居中,
 *  不是在壳里再塞一个 flex 子容器(那样色点会偏上 2px/5px 不对称)。
 *  非色值的行内代码不带这三个类,保持原有 21px 行高。 */
export const INLINE_CODE_CLASS =
  'px-1 py-px rounded-[0.4rem] border border-hairline bg-alpha-1 text-[0.9rem] ' +
  'leading-[1.5] font-mono font-normal text-danger whitespace-pre-wrap';
export const INLINE_CODE_COLOR_CLASS = 'inline-flex items-center h-5';

/** 色点。claude.ai 实测值:12×12、圆角 4px、0.5px alpha-20% 描边、shadow-sm、
 *  右外边距 4px。rounded-sm 与 border-border-strong 在本仓实测就是 4px /
 *  alpha 20%(globals.css 重定义过),所以用仓内 token 而非 claude 的字面值。
 *  ! 投影不能写 shadow-sm:上游那个 shadow-sm 是 6%/8% 两层,本仓的
 *  shadow-sm 是 Tailwind 默认的 10% 两层,同名不同值。--card-shadow 才是
 *  上游那一组,而且深色下会正确翻到 12%/18%。 */
const ColorDot = ({ color }: { color: string }) => (
  <span
    className="inline-block w-3 h-3 rounded-sm border border-border-strong flex-shrink-0 shadow-[var(--card-shadow)] mr-1 align-middle"
    style={{ backgroundColor: color }}
  />
);

// 颜色值检测和渲染组件
export const ColorSwatch = ({ color, bare = false }: { color: string; bare?: boolean }) => {
  // 壳由调用方(Markdown.tsx 的行内代码分支)提供:只出色点 + 裸文本,
  // 让色点成为 <code> 的直接子节点,与 claude.ai 的 DOM 结构一致。
  if (bare) {
    return (
      <>
        <ColorDot color={color} />
        {color}
      </>
    );
  }

  // 裸文本里的色值(没有反引号)自带一份同款壳。
  return (
    <code className={`${INLINE_CODE_CLASS} ${INLINE_CODE_COLOR_CLASS}`} title={`Color: ${color}`}>
      <ColorDot color={color} />
      {color}
    </code>
  );
};

/** react-markdown 把原始 mdast 节点透传成 node prop。代码节点(行内 code /
 *  代码块)里的色值由 code 渲染器自己处理 —— 外层 p/li/td 再钻进去包一次,
 *  就会先把 children 换成 React 元素(害 code 渲染器的 String(children) 变成
 *  "[object Object]"),再套出双层背景框。 */
const isCodeElement = (element: ReactElement<any>): boolean => {
  const tagName = element.props?.node?.tagName ?? element.type;
  return tagName === 'code' || tagName === 'pre';
};

/**
 * 快速检查文本中是否包含颜色值（性能优化）
 */
export const hasColorValue = (text: string): boolean => {
  return COLOR_TEST_REGEX.test(text);
};

/**
 * 检测文本中的颜色值并渲染为带色块的组件
 * @param text 待处理的文本
 * @returns 处理后的 ReactNode
 */
export const processColorValues = (text: string, options: ColorRenderOptions = {}): ReactNode => {
  // 重置正则表达式的 lastIndex（因为使用全局 regex）
  COLOR_REGEX.lastIndex = 0;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = COLOR_REGEX.exec(text)) !== null) {
    // 添加颜色值前的文本
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}-${match.index}`}>{text.slice(lastIndex, match.index)}</span>,
      );
    }

    // 添加颜色值和色块
    const colorValue = match[0];
    parts.push(
      <ColorSwatch
        key={`color-${match.index}-${colorValue}`}
        color={colorValue}
        bare={options.bare}
      />,
    );

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}-end`}>{text.slice(lastIndex)}</span>);
  }

  // 如果有处理过的内容（包括单个颜色值），返回处理后的结果。
  // bare 模式用 Fragment:不额外生成 DOM 节点,色点直接挂在 <code> 下。
  if (parts.length === 0) return text;
  return options.bare ? <>{parts}</> : <span>{parts}</span>;
};

/**
 * 处理 ReactNode 数组中的颜色值（支持递归处理嵌套元素）
 * @param children 子元素数组
 * @returns 处理后的子元素数组
 */
export const processChildrenColorValues = (
  children: ReactNode,
  options: ColorRenderOptions = {},
): ReactNode => {
  // 处理数组
  if (Array.isArray(children)) {
    let hasProcessed = false;
    const processed = children.map((child, index) => {
      if (typeof child === 'string') {
        if (hasColorValue(child)) {
          hasProcessed = true;
          // 在数组中需要 key，使用 cloneElement 添加
          const colorResult = processColorValues(child, options);
          if (React.isValidElement(colorResult)) {
            return React.cloneElement(colorResult, { key: `color-text-${index}` });
          }
          return colorResult;
        }
        return child;
      }
      // 递归处理 React 元素
      if (React.isValidElement(child)) {
        const element = child as ReactElement<any>;
        if (isCodeElement(element)) return child;
        const processedChildren = processChildrenColorValues(element.props.children, options);

        // 只有在子元素被处理过时才克隆
        if (processedChildren !== element.props.children) {
          hasProcessed = true;
          return React.cloneElement(
            element,
            { key: element.key || `child-${index}` },
            processedChildren,
          );
        }
        return child;
      }
      return child;
    });

    // 只有在确实处理了内容时才返回新数组
    return hasProcessed ? processed : children;
  }

  // 处理字符串
  if (typeof children === 'string') {
    return hasColorValue(children) ? processColorValues(children, options) : children;
  }

  // 处理单个 React 元素
  if (React.isValidElement(children)) {
    const element = children as ReactElement<any>;
    if (isCodeElement(element)) return children;
    const processedChildren = processChildrenColorValues(element.props.children, options);

    // 只有在子元素被处理过时才克隆
    if (processedChildren !== element.props.children) {
      return React.cloneElement(element, {}, processedChildren);
    }
    return children;
  }

  return children;
};

/**
 * 验证是否为有效的十六进制颜色值
 * @param color 颜色字符串
 * @returns 是否为有效颜色值
 */
export const isValidHexColor = (color: string): boolean => {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color);
};

/**
 * 提取文本中的所有颜色值
 * @param text 待处理的文本
 * @returns 颜色值数组
 */
export const extractColors = (text: string): string[] => {
  COLOR_REGEX.lastIndex = 0;
  const colors: string[] = [];
  let match;

  while ((match = COLOR_REGEX.exec(text)) !== null) {
    colors.push(match[0]);
  }

  return colors;
};
