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

import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from './Markdown';

/** 一批文字的攒批窗口:窗口内到达的 delta 合并成一批同时开始淡入。 */
const FLUSH_INTERVAL_MS = 180;

/** 尾部渐显动画时长,经 CSS 变量 --stream-pop-duration 注入(.stream-pop
 *  只写 fallback)。不变量:必须远大于 FLUSH_INTERVAL_MS,让尾部同时挂着
 *  4~5 批处于不同透明度的文字,渐隐尾迹才连续;两值接近会退化成一块块闪。 */
const FADE_MS = 800;

/**
 * 流式"尾部渐显"版 Markdown(claude.ai cowork 式),单聊/群聊 AI 流式期共用。
 *
 * 与旧版单聊 smooth stream(流层切碎 delta + 逐块延迟的打字机)不同:这里
 * 不改流,只在渲染层攒批 —— children(store 里逐 delta 长大的全文)每
 * ~180ms 才刷一次进 Markdown,配合 streamPop(rehype-stream-pop)把新
 * 内容切成 token span,新挂载的 span 播放 0.8s 纯 opacity 渐入 → 最新
 * 文字淡淡浮现、逐渐凝实,尾部呈一条渐隐尾迹。
 *
 * 只在流式期用本组件;定稿后换回普通 <Markdown>(无 span、无节流),
 * 未刷出的尾巴随之立刻补齐。noPadding/variant 与 Markdown 同义透传。
 *
 * 已知且有意的入场行为:挂载瞬间的初始内容(会话切走再切回、刷新续流等
 * 场景下可能是整条已有消息)会整体淡入一次。这是"内容进入视野"的自然
 * 入场;想只动画增量需要 源文本偏移→渲染文本偏移 的映射,markdown 语法
 * 剥离使其不可靠,且任何容器级 CSS 开关都会在下一帧重触发动画,故不做。
 */
export default function StreamPopMarkdown({
  children,
  className,
  noPadding = false,
  variant,
  onOpenExternal,
}: {
  children: string;
  className?: string;
  noPadding?: boolean;
  variant?: 'default' | 'muted';
  onOpenExternal?: (url: string) => void;
}) {
  const [display, setDisplay] = useState(children);
  const latestRef = useRef(children);
  const lastFlushRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestRef.current = children;

  useEffect(() => {
    if (children === display) return;
    const elapsed = Date.now() - lastFlushRef.current;
    if (elapsed >= FLUSH_INTERVAL_MS) {
      lastFlushRef.current = Date.now();
      setDisplay(children);
      return;
    }
    // 窗口未到:挂一个定时器等窗口关闭再刷(已挂则复用,到点取 latestRef
    // 拿最新全文,窗口内后续 delta 自然并入同一批)
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastFlushRef.current = Date.now();
      setDisplay(latestRef.current);
    }, FLUSH_INTERVAL_MS - elapsed);
  }, [children, display]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // element 引用按 display memo:delta 逐条打进来只重渲染本组件(节流判断),
  // ReactMarkdown 的完整 parse 只发生在每次 flush —— 这也是把"逐 delta 全量
  // 重解析"的开销压到每窗口一次的关键。
  // display:contents 外壳不参与布局,只为把 FADE_MS 作为 CSS 变量送达
  // .stream-pop(TS 侧单一事实源,见 FADE_MS 注释)。
  return useMemo(
    () => (
      <div
        style={
          { display: 'contents', '--stream-pop-duration': `${FADE_MS}ms` } as React.CSSProperties
        }
      >
        {/* 尾迹只由逐 token 的 opacity 渐入表达。原来还叠了一层容器级底部遮罩
            (.stream-tail-mask,固定 1.75em 淡到 45%),已删:它按**位置**压暗而不是
            按时间 —— 早就到的字只要落在底部那一行也照样虚着,流式一卡顿就一直虚;
            在只有两三行的小块里更是吃掉下半段。 */}
        <Markdown
          noPadding={noPadding}
          streamPop
          className={className}
          variant={variant}
          onOpenExternal={onOpenExternal}
        >
          {display}
        </Markdown>
      </div>
    ),
    [display, className, noPadding, variant, onOpenExternal],
  );
}
