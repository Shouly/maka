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
 * 结构化最小 hast 节点类型,供本目录的 rehype 插件共用
 * (rehype-strip-break-newlines / rehype-stream-pop)。
 *
 * 不 import 'hast':@types/hast 只是 react-markdown 的传递依赖、未在本项目
 * package.json 声明,包管理器换严格解析就会挂。
 */
export interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  value?: string
  children?: HastNode[]
}
