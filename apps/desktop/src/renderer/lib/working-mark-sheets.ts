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

export type WorkingMarkActivity = 'default' | 'think' | 'search' | 'read' | 'code' | 'write';
export type WorkingMarkPhase = 'in' | 'loop' | 'out';

export interface WorkingMarkSheet {
  readonly src: string;
  readonly frames: number;
  readonly frameMs: number;
  readonly rest?: number;
}

export const WORKING_MARK_SHEETS: Readonly<
  Record<`${WorkingMarkActivity}.${WorkingMarkPhase}`, WorkingMarkSheet>
> = {
  'code.in': {
    src: new URL('../assets/working-mark/code-in.png', import.meta.url).href,
    frames: 16,
    frameMs: 33.3333,
  },
  'code.loop': {
    src: new URL('../assets/working-mark/code-loop.png', import.meta.url).href,
    frames: 75,
    frameMs: 33.3333,
    rest: 74,
  },
  'code.out': {
    src: new URL('../assets/working-mark/code-out.png', import.meta.url).href,
    frames: 9,
    frameMs: 33.3333,
  },
  'default.in': {
    src: new URL('../assets/working-mark/default-in.png', import.meta.url).href,
    frames: 16,
    frameMs: 33.3333,
  },
  'default.loop': {
    src: new URL('../assets/working-mark/default-loop.png', import.meta.url).href,
    frames: 40,
    frameMs: 33.3333,
    rest: 38,
  },
  'default.out': {
    src: new URL('../assets/working-mark/default-out.png', import.meta.url).href,
    frames: 14,
    frameMs: 33.3333,
  },
  'read.in': {
    src: new URL('../assets/working-mark/read-in.png', import.meta.url).href,
    frames: 21,
    frameMs: 33.3333,
  },
  'read.loop': {
    src: new URL('../assets/working-mark/read-loop.png', import.meta.url).href,
    frames: 60,
    frameMs: 33.3333,
    rest: 44,
  },
  'read.out': {
    src: new URL('../assets/working-mark/read-out.png', import.meta.url).href,
    frames: 19,
    frameMs: 33.3333,
  },
  'search.in': {
    src: new URL('../assets/working-mark/search-in.png', import.meta.url).href,
    frames: 16,
    frameMs: 33.3333,
  },
  'search.loop': {
    src: new URL('../assets/working-mark/search-loop.png', import.meta.url).href,
    frames: 20,
    frameMs: 33.3333,
    rest: 4,
  },
  'search.out': {
    src: new URL('../assets/working-mark/search-out.png', import.meta.url).href,
    frames: 14,
    frameMs: 33.3333,
  },
  'think.in': {
    src: new URL('../assets/working-mark/think-in.png', import.meta.url).href,
    frames: 16,
    frameMs: 33.3333,
  },
  'think.loop': {
    src: new URL('../assets/working-mark/think-loop.png', import.meta.url).href,
    frames: 110,
    frameMs: 33.3333,
    rest: 95,
  },
  'think.out': {
    src: new URL('../assets/working-mark/think-out.png', import.meta.url).href,
    frames: 15,
    frameMs: 33.3333,
  },
  'write.in': {
    src: new URL('../assets/working-mark/write-in.png', import.meta.url).href,
    frames: 31,
    frameMs: 33.3333,
  },
  'write.loop': {
    src: new URL('../assets/working-mark/write-loop.png', import.meta.url).href,
    frames: 60,
    frameMs: 33.3333,
    rest: 36,
  },
  'write.out': {
    src: new URL('../assets/working-mark/write-out.png', import.meta.url).href,
    frames: 14,
    frameMs: 33.3333,
  },
};
