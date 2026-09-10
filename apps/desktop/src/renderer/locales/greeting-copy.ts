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

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';
interface GreetingCopy {
  periods: Record<GreetingPeriod, readonly string[]>;
  returning: readonly string[];
  weekend: readonly string[];
}

const COPY = {
  'zh-CN': {
    periods: {
      morning: [
        '早上好，{name}',
        '早安，{name}',
        '新的一天，{name}',
        '今天先做点什么？',
        '我们从哪里开始？',
      ],
      afternoon: ['下午好，{name}', '你好，{name}', '今天一起做点什么？', '一起完成点事情吧'],
      evening: ['晚上好，{name}', '晚上好呀，{name}', '还有什么想完成的？', '一起完成点事情吧'],
      night: ['还没睡，{name}？', '夜深了，{name}', '这么晚在忙什么？', '我们上次聊到哪了？'],
    },
    returning: ['继续吧，{name}', '欢迎回来，{name}', '接着上次的事情继续吧', '我们上次聊到哪了？'],
    weekend: ['周末愉快，{name}', '周末好，{name}', '今天可以慢慢来'],
  },
  'zh-TW': {
    periods: {
      morning: [
        '早上好，{name}',
        '早安，{name}',
        '新的一天，{name}',
        '今天先做點什麼？',
        '我們從哪裡開始？',
      ],
      afternoon: ['下午好，{name}', '你好，{name}', '今天一起做點什麼？', '一起完成點事情吧'],
      evening: ['晚上好，{name}', '晚上好呀，{name}', '還有什麼想完成的？', '一起完成點事情吧'],
      night: ['還沒睡，{name}？', '夜深了，{name}', '這麼晚在忙什麼？', '我們上次聊到哪了？'],
    },
    returning: ['繼續吧，{name}', '歡迎回來，{name}', '接著上次的事情繼續吧', '我們上次聊到哪了？'],
    weekend: ['週末愉快，{name}', '週末好，{name}', '今天可以慢慢來'],
  },
  en: {
    periods: {
      morning: [
        'Good morning, {name}',
        'Morning, {name}',
        'New day, {name}',
        "What's first today?",
        'Where do we start?',
      ],
      afternoon: [
        'Good afternoon, {name}',
        'Hey there, {name}',
        'What are we working on?',
        "Let's get something done",
      ],
      evening: [
        'Good evening, {name}',
        'Evening, {name}',
        'What shall we wrap up?',
        "Let's get something done",
      ],
      night: ['Still up, {name}?', 'Late night, {name}?', 'What keeps you up?', 'Where were we?'],
    },
    returning: [
      'Back at it, {name}',
      'Welcome back, {name}',
      'Picking up where we left off',
      'Where were we?',
    ],
    weekend: ['Happy weekend, {name}', 'Weekend mode, {name}', 'No rush today'],
  },
} satisfies UiCatalog<GreetingCopy>;

export const getGreetingCopy = (locale: UiLocale): GreetingCopy => COPY[locale];
