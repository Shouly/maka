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

// The few words the `components/ui/*` primitives say on their own: the
// default labels a caller may omit (a dialog's close button, a confirm
// dialog's two buttons) and the one-line states of leaf widgets. Everything a
// feature surface says lives in that surface's catalog; this one exists so a
// primitive never ships an English literal as its accessible name.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface UiCopy {
  readonly close: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly moreActions: string;
  readonly noChanges: string;
  readonly notesToSelf: string;
}

const UI_COPY = {
  'zh-CN': {
    close: '关闭',
    cancel: '取消',
    confirm: '确认',
    moreActions: '更多操作',
    noChanges: '没有改动',
    notesToSelf: '给自己的笔记',
  },
  'zh-TW': {
    close: '關閉',
    cancel: '取消',
    confirm: '確認',
    moreActions: '更多操作',
    noChanges: '沒有變更',
    notesToSelf: '給自己的筆記',
  },
  en: {
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    moreActions: 'More actions',
    noChanges: 'No changes',
    notesToSelf: 'Notes to self',
  },
} satisfies UiCatalog<UiCopy>;

export function getUiCopy(locale: UiLocale): UiCopy {
  return UI_COPY[locale];
}
