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
 * 内容井 —— 弹框/面板里"这块是内容,不是 chrome"的那层容器。
 *
 * 分区靠描边,不靠压深底色(surface-1 比弹框的 surface-3 浅,是"纸"不是"坑")。
 * ! border-[1px] 不是笔误:仓里裸 `border` 被改成 0.5px,内嵌块要 1px 才立得住。
 *
 * 只给**表面**,布局归调用点 —— 各家的高度约束差别很大:
 *   - root 写 max-h 的弹框:井不能写 min-h-0 flex-1(自动高容器里会塌成 0),
 *     让内容自己撑,超出后由 DialogContent 那层的 overflow-y-auto 接管;
 *   - root 写确定高度的(FilesPreviewDialog h-[85dvh]):井才能 min-h-0 flex-1。
 *
 * 原来这串 class 在 6 个文件里各抄了一遍(AttachmentViewer 里那份还带着完整
 * 的说明注释)。表面部分收在这里,改一次全都跟上。
 */
export const contentWellClass =
  'rounded-xl border-[1px] border-hairline bg-surface-1'
