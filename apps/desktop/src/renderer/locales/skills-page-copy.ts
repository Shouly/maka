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

// What the Skills page says that `@maka/ui`'s `skills-copy.ts` does not.
//
// Deliberately thin, for the same reason `modules-copy.ts` is: the pre-rewrite
// Skills vocabulary survived the rewrite intact, so the page reads scope
// names, category names, status words, the review dialog's whole vocabulary
// and every failure reason from `getSkillsCopy(locale)`. What is left over is
// of three kinds:
//
//   - the toolbar this page did not have when it was a panel (the filter
//     menu, the sort menu);
//   - the two facts a row used to hide — where the skill lives on disk and
//     which tools it declares by NAME;
//   - the one failure reason that exists on `skills.previewUpdate` and
//     nowhere else in the namespace (`read_failed`), plus the titles for the
//     two calls `modules-copy.ts` never had to name.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface SkillsPageCopy {
  filters: {
    /** The sliders icon's accessible name. */
    trigger: string;
    /** The menu's muted heading. */
    heading: string;
    /** The Yours dimension: who made the skill. */
    origin: string;
    /** The Discover dimension. */
    category: string;
    /** The option that clears a dimension. `categoryAll` in skills-copy is the market's. */
    all: string;
  };
  /** The toolbar's primary: Add ▾, opening the ways a skill can arrive. */
  add: {
    label: string;
    importFile: string;
    browse: string;
  };
  sort: {
    /** The sort menu's heading, and the icon button's accessible name. */
    trigger: string;
    name: string;
    /** Skills that are asking for something first: updates, reviews, errors. */
    updates: string;
    /** The order the Host answered in — discovery order, and the default. */
    source: string;
  };
  detail: {
    /** `Read, Bash` — the names, after the count has said how many there are. */
    tools: (names: string) => string;
    /** The tail of a clipped tool list on the row's meta line. */
    moreTools: (count: number) => string;
  };
  capability: {
    /** Why a host-incompatible skill is out of context, in the chip's tooltip. */
    tooltip: string;
  };
  /** Section headings on the Yours list, and the origin filter's options. */
  origins: Record<'workspace' | 'bundled' | 'managed', string>;
  use: {
    /** Starts a new task with this skill already invoked in the composer. */
    action: string;
  };
  update: {
    /** The ⋯ entry, while the preview is being read. */
    reviewing: string;
    reviewFailed: string;
    failed: string;
    applying: string;
    updated: (name: string) => string;
    /** `skills.previewUpdate`'s own reason: the source file could not be read. */
    readFailed: string;
  };
}

const SKILLS_PAGE_COPY = {
  'zh-CN': {
    filters: {
      trigger: '筛选',
      heading: '筛选条件',
      origin: '来源',
      category: '分类',
      all: '全部',
    },
    origins: {
      workspace: '你创建的',
      bundled: '内置',
      managed: '来自技能源',
    },
    add: {
      label: '添加',
      importFile: '上传技能',
      browse: '浏览内置技能',
    },
    sort: {
      trigger: '排序方式',
      name: '名称',
      updates: '待处理优先',
      source: '来源顺序',
    },
    detail: {
      tools: (names) => `声明工具：${names}`,
      moreTools: (count) => `等 ${count} 个`,
    },
    capability: {
      tooltip: '当前 Host 无法提供这个技能要求的工具或能力，所以它不会进入任务的技能上下文。',
    },
    use: {
      action: '在对话中试用',
    },
    update: {
      reviewing: '读取更新中…',
      reviewFailed: '读取技能更新失败',
      failed: '更新技能失败',
      applying: '更新中…',
      updated: (name) => `已更新 ${name}`,
      readFailed: '来源库里的 SKILL.md 无法读取。',
    },
  },
  'zh-TW': {
    filters: {
      trigger: '篩選',
      heading: '篩選條件',
      origin: '來源',
      category: '分類',
      all: '全部',
    },
    origins: {
      workspace: '你建立的',
      bundled: '內建',
      managed: '來自技能來源',
    },
    add: {
      label: '新增',
      importFile: '上傳技能',
      browse: '瀏覽內建技能',
    },
    sort: {
      trigger: '排序方式',
      name: '名稱',
      updates: '待處理優先',
      source: '來源順序',
    },
    detail: {
      tools: (names) => `宣告工具：${names}`,
      moreTools: (count) => `等 ${count} 個`,
    },
    capability: {
      tooltip: '目前 Host 無法提供這個技能要求的工具或能力，所以它不會進入任務的技能上下文。',
    },
    use: {
      action: '在對話中試用',
    },
    update: {
      reviewing: '讀取更新中…',
      reviewFailed: '讀取技能更新失敗',
      failed: '更新技能失敗',
      applying: '更新中…',
      updated: (name) => `已更新 ${name}`,
      readFailed: '來源庫裡的 SKILL.md 無法讀取。',
    },
  },
  en: {
    filters: {
      trigger: 'Filter',
      heading: 'Filter by',
      origin: 'Created by',
      category: 'Category',
      all: 'All',
    },
    origins: {
      workspace: 'Created by you',
      bundled: 'Built in',
      managed: 'From a skill source',
    },
    add: {
      label: 'Add',
      importFile: 'Upload skill',
      browse: 'Browse built-in skills',
    },
    sort: {
      trigger: 'Sort by',
      name: 'Name',
      updates: 'Needs attention first',
      source: 'Source order',
    },
    detail: {
      tools: (names) => `Declared tools: ${names}`,
      moreTools: (count) => `+${count} more`,
    },
    capability: {
      tooltip:
        'This Host cannot provide the tools or capabilities the skill requires, so it stays out of the task’s skill context.',
    },
    use: {
      action: 'Try in chat',
    },
    update: {
      reviewing: 'Reading the update…',
      reviewFailed: 'Could not read the skill update',
      failed: 'Could not update the skill',
      applying: 'Updating…',
      updated: (name) => `Updated ${name}`,
      readFailed: 'The SKILL.md in the source library could not be read.',
    },
  },
} satisfies UiCatalog<SkillsPageCopy>;

export function getSkillsPageCopy(locale: UiLocale): SkillsPageCopy {
  return SKILLS_PAGE_COPY[locale];
}
