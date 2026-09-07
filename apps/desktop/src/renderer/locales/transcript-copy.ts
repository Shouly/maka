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

// What the transcript says, in three languages.
//
// Only what is NEW in Phase 3a lives here. The turn footer, the lineage
// badges, the health notice and the revision banner already have their words
// in `conversation-copy.ts`; the tool result vocabulary (exit codes,
// truncation, background status, subagent status, sandbox diagnostics) already
// has its words in `@maka/ui` `tool-activity/copy.ts`. Adding a second
// spelling of any of those here is how two surfaces start disagreeing about
// the same fact, so this catalog deliberately stops where those begin.

import type { ToolActivityKind } from '@maka/core/events';
import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

/** One tool group's summary phrase, by how many calls of that kind it holds. */
export interface ToolSummaryLabel {
  readonly one: string;
  readonly other: (count: number) => string;
}

export interface TranscriptCopy {
  readonly feed: {
    readonly ariaLabel: string;
    readonly loading: string;
    readonly empty: string;
    readonly streaming: string;
    readonly jumpToLatest: string;
  };
  readonly history: {
    readonly ariaLabel: string;
    readonly earlier: string;
    readonly later: string;
    readonly latest: string;
    readonly loading: string;
    readonly beginning: string;
  };
  readonly turn: {
    readonly actionsLabel: string;
    readonly edit: string;
    readonly editTitle: string;
    readonly editHint: string;
    readonly save: string;
    readonly cancel: string;
    readonly showMore: string;
    readonly showLess: string;
    readonly collapsed: string;
    readonly attachmentsLabel: string;
    readonly openAttachment: (name: string) => string;
    readonly closeAttachment: string;
    readonly attachmentUnavailable: string;
    readonly directoryReferences: string;
    readonly inlineReferences: string;
    readonly quotes: string;
    readonly skills: string;
    readonly hostOrigin: string;
  };
  readonly thinking: {
    readonly label: string;
    readonly active: string;
    readonly truncated: string;
    readonly duration: (seconds: number) => string;
  };
  readonly tools: {
    readonly groupLabel: string;
    readonly stepsLabel: string;
    readonly working: string;
    readonly thinkingOnly: string;
    readonly thinkingActive: string;
    readonly summary: Record<ToolActivityKind, ToolSummaryLabel>;
    readonly active: Record<ToolActivityKind, string>;
    readonly join: (phrases: readonly string[]) => string;
    readonly expand: (name: string) => string;
    readonly collapse: (name: string) => string;
  };
  readonly result: {
    readonly command: string;
    readonly workingDirectory: string;
    readonly output: string;
    readonly arguments: string;
    readonly diff: string;
    readonly linesAdded: (count: number) => string;
    readonly linesRemoved: (count: number) => string;
    readonly imageAlt: (tool: string) => string;
    readonly archived: string;
    readonly archivedDetail: (reason: string, bytes: string) => string;
    readonly openChildSession: string;
    readonly childSessionUnavailable: string;
    readonly swarmItems: (count: number) => string;
    readonly failureClass: (value: string) => string;
    readonly pending: string;
  };
  readonly sandbox: {
    readonly blockedLabel: string;
    readonly action: string;
    readonly pending: string;
    readonly failedTitle: string;
  };
  readonly queue: {
    readonly title: string;
    readonly ariaLabel: string;
    readonly promote: string;
    readonly edit: string;
    readonly delete: string;
    readonly save: string;
    readonly cancel: string;
    readonly moveUp: string;
    readonly moveDown: string;
    readonly position: (index: number, total: number) => string;
    readonly empty: string;
    readonly pendingSend: string;
    readonly failedTitle: string;
  };
  readonly model: {
    readonly label: string;
    readonly none: string;
    readonly empty: string;
    readonly changeFailedTitle: string;
  };
  readonly context: {
    readonly label: string;
    readonly share: (percent: number) => string;
    readonly used: (used: string, total: string) => string;
    readonly usedNoWindow: (used: string) => string;
    readonly unavailable: string;
    readonly compact: string;
    readonly compacting: string;
  };
  readonly notices: {
    readonly ariaLabel: string;
    readonly chooseModel: string;
    readonly openSettings: string;
    readonly retry: string;
    readonly dismiss: string;
    readonly streamDegraded: string;
    readonly streamStalled: string;
    readonly resumeTitle: string;
    readonly resumeDescription: string;
    readonly resumeAction: string;
    readonly compactionDone: string;
    readonly compactionUnchanged: (reason: string) => string;
    readonly compactionFailed: (reason: string) => string;
  };
  readonly quote: {
    readonly action: string;
    readonly added: string;
  };
}

const ZH_CN_ACTIVITY_SUMMARY: Record<ToolActivityKind, ToolSummaryLabel> = {
  computer: { one: '操作了电脑', other: (n) => `操作电脑 ${n} 次` },
  read: { one: '读取了文件', other: (n) => `读取 ${n} 个文件` },
  search: { one: '搜索了代码', other: (n) => `搜索 ${n} 次` },
  websearch: { one: '搜索了网页', other: (n) => `搜索网页 ${n} 次` },
  webfetch: { one: '抓取了网页', other: (n) => `抓取 ${n} 个网页` },
  edit: { one: '修改了文件', other: (n) => `修改 ${n} 个文件` },
  command: { one: '执行了命令', other: (n) => `执行 ${n} 条命令` },
  explore: { one: '浏览了目录', other: (n) => `浏览 ${n} 个目录` },
  browser: { one: '操作了浏览器', other: (n) => `操作浏览器 ${n} 次` },
  tool: { one: '调用了工具', other: (n) => `调用 ${n} 次工具` },
};

const ZH_CN_ACTIVITY_ACTIVE: Record<ToolActivityKind, string> = {
  computer: '正在操作电脑',
  read: '正在读取文件',
  search: '正在搜索',
  websearch: '正在搜索网页',
  webfetch: '正在抓取网页',
  edit: '正在修改文件',
  command: '正在执行命令',
  explore: '正在浏览目录',
  browser: '正在操作浏览器',
  tool: '正在调用工具',
};

const ZH_TW_ACTIVITY_SUMMARY: Record<ToolActivityKind, ToolSummaryLabel> = {
  computer: { one: '操作了電腦', other: (n) => `操作電腦 ${n} 次` },
  read: { one: '讀取了檔案', other: (n) => `讀取 ${n} 個檔案` },
  search: { one: '搜尋了程式碼', other: (n) => `搜尋 ${n} 次` },
  websearch: { one: '搜尋了網頁', other: (n) => `搜尋網頁 ${n} 次` },
  webfetch: { one: '擷取了網頁', other: (n) => `擷取 ${n} 個網頁` },
  edit: { one: '修改了檔案', other: (n) => `修改 ${n} 個檔案` },
  command: { one: '執行了指令', other: (n) => `執行 ${n} 條指令` },
  explore: { one: '瀏覽了目錄', other: (n) => `瀏覽 ${n} 個目錄` },
  browser: { one: '操作了瀏覽器', other: (n) => `操作瀏覽器 ${n} 次` },
  tool: { one: '呼叫了工具', other: (n) => `呼叫 ${n} 次工具` },
};

const ZH_TW_ACTIVITY_ACTIVE: Record<ToolActivityKind, string> = {
  computer: '正在操作電腦',
  read: '正在讀取檔案',
  search: '正在搜尋',
  websearch: '正在搜尋網頁',
  webfetch: '正在擷取網頁',
  edit: '正在修改檔案',
  command: '正在執行指令',
  explore: '正在瀏覽目錄',
  browser: '正在操作瀏覽器',
  tool: '正在呼叫工具',
};

const EN_ACTIVITY_SUMMARY: Record<ToolActivityKind, ToolSummaryLabel> = {
  computer: { one: 'Used the computer', other: (n) => `Used the computer ${n} times` },
  read: { one: 'Read a file', other: (n) => `Read ${n} files` },
  search: { one: 'Searched the code', other: (n) => `Ran ${n} searches` },
  websearch: { one: 'Searched the web', other: (n) => `Ran ${n} web searches` },
  webfetch: { one: 'Fetched a page', other: (n) => `Fetched ${n} pages` },
  edit: { one: 'Edited a file', other: (n) => `Edited ${n} files` },
  command: { one: 'Ran a command', other: (n) => `Ran ${n} commands` },
  explore: { one: 'Explored a directory', other: (n) => `Explored ${n} directories` },
  browser: { one: 'Used the browser', other: (n) => `Used the browser ${n} times` },
  tool: { one: 'Called a tool', other: (n) => `Called ${n} tools` },
};

const EN_ACTIVITY_ACTIVE: Record<ToolActivityKind, string> = {
  computer: 'Using the computer',
  read: 'Reading a file',
  search: 'Searching the code',
  websearch: 'Searching the web',
  webfetch: 'Fetching a page',
  edit: 'Editing a file',
  command: 'Running a command',
  explore: 'Exploring a directory',
  browser: 'Using the browser',
  tool: 'Calling a tool',
};

/**
 * Serial-comma joining, English only. The Chinese locales use the ideographic
 * comma and never lower-case a following phrase, so their join is a plain
 * concatenation — running the English rule over Chinese would insert " and "
 * into a Chinese sentence.
 */
function joinEnglishPhrases(phrases: readonly string[]): string {
  const lowered = phrases.map((phrase, index) =>
    index === 0 ? phrase : `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`,
  );
  if (lowered.length <= 1) return lowered[0] ?? '';
  if (lowered.length === 2) return `${lowered[0]} and ${lowered[1]}`;
  return `${lowered.slice(0, -1).join(', ')}, and ${lowered[lowered.length - 1]}`;
}

const TRANSCRIPT_COPY = {
  'zh-CN': {
    feed: {
      ariaLabel: '对话记录',
      loading: '正在加载对话…',
      empty: '这个任务还没有消息。',
      streaming: '正在生成回复…',
      jumpToLatest: '回到最新',
    },
    history: {
      ariaLabel: '历史记录导航',
      earlier: '加载更早的记录',
      later: '加载更新的记录',
      latest: '跳到最新',
      loading: '正在加载…',
      beginning: '已经是对话开头',
    },
    turn: {
      actionsLabel: '消息操作',
      edit: '编辑',
      editTitle: '编辑并重新发送',
      editHint: '编辑会创建这个任务的新版本，原版本仍然保留。',
      save: '保存',
      cancel: '取消',
      showMore: '展开',
      showLess: '收起',
      collapsed: '消息已折叠',
      attachmentsLabel: '附件',
      openAttachment: (name) => `打开附件 ${name}`,
      closeAttachment: '关闭附件预览',
      attachmentUnavailable: '附件不可用',
      directoryReferences: '引用目录',
      inlineReferences: '引用文件',
      quotes: '引用内容',
      skills: '技能',
      hostOrigin: '由运行服务发起',
    },
    thinking: {
      label: '思考过程',
      active: '正在思考…',
      truncated: '已截断',
      duration: (seconds) => `${seconds} 秒`,
    },
    tools: {
      groupLabel: '工具调用',
      stepsLabel: '步骤',
      working: '正在处理…',
      thinkingOnly: '思考过程',
      thinkingActive: '正在思考…',
      summary: ZH_CN_ACTIVITY_SUMMARY,
      active: ZH_CN_ACTIVITY_ACTIVE,
      join: (phrases) => phrases.join('、'),
      expand: (name) => `展开 ${name}`,
      collapse: (name) => `收起 ${name}`,
    },
    result: {
      command: '命令',
      workingDirectory: '工作目录',
      output: '输出',
      arguments: '参数',
      diff: '改动',
      linesAdded: (count) => `+${count}`,
      linesRemoved: (count) => `-${count}`,
      imageAlt: (tool) => `${tool} 返回的图片`,
      archived: '结果已归档',
      archivedDetail: (reason, bytes) => `${reason} · 原始大小 ${bytes}`,
      openChildSession: '打开子任务',
      childSessionUnavailable: '子任务不可用',
      swarmItems: (count) => `${count} 个子任务`,
      failureClass: (value) => `失败原因：${value}`,
      pending: '等待结果…',
    },
    sandbox: {
      blockedLabel: '被沙箱拦截',
      action: '切换到完全访问并重试',
      pending: '正在切换…',
      failedTitle: '切换权限模式失败',
    },
    queue: {
      title: '排队中的消息',
      ariaLabel: '排队中的消息',
      promote: '插到最前',
      edit: '编辑',
      delete: '删除',
      save: '保存',
      cancel: '取消',
      moveUp: '上移',
      moveDown: '下移',
      position: (index, total) => `第 ${index} 条，共 ${total} 条`,
      empty: '没有排队中的消息。',
      pendingSend: '正在发送…',
      failedTitle: '队列操作失败',
    },
    model: {
      label: '模型',
      none: '未选择模型',
      empty: '添加模型',
      changeFailedTitle: '切换模型失败',
    },
    context: {
      label: '上下文用量',
      share: (percent) => `${percent}%`,
      used: (used, total) => `${used} / ${total}`,
      usedNoWindow: (used) => `已用 ${used}`,
      unavailable: '暂无上下文数据',
      compact: '压缩上下文',
      compacting: '正在压缩…',
    },
    notices: {
      ariaLabel: '会话提示',
      chooseModel: '选择模型',
      openSettings: '打开设置',
      retry: '重试',
      dismiss: '知道了',
      streamDegraded: '事件流不稳定，显示的内容可能滞后。',
      streamStalled: '事件流已中断，正在重新连接。',
      resumeTitle: '上一轮被中断',
      resumeDescription: '可以安全地从中断处继续。',
      resumeAction: '继续',
      compactionDone: '上下文已压缩。',
      compactionUnchanged: (reason) => `上下文未变化：${reason}`,
      compactionFailed: (reason) => `上下文压缩失败：${reason}`,
    },
    quote: {
      action: '引用到输入框',
      added: '已加入引用',
    },
  },
  'zh-TW': {
    feed: {
      ariaLabel: '對話記錄',
      loading: '正在載入對話…',
      empty: '這個任務還沒有訊息。',
      streaming: '正在產生回覆…',
      jumpToLatest: '回到最新',
    },
    history: {
      ariaLabel: '歷史記錄導覽',
      earlier: '載入更早的記錄',
      later: '載入更新的記錄',
      latest: '跳到最新',
      loading: '正在載入…',
      beginning: '已經是對話開頭',
    },
    turn: {
      actionsLabel: '訊息操作',
      edit: '編輯',
      editTitle: '編輯並重新送出',
      editHint: '編輯會建立這個任務的新版本，原版本仍會保留。',
      save: '儲存',
      cancel: '取消',
      showMore: '展開',
      showLess: '收合',
      collapsed: '訊息已折疊',
      attachmentsLabel: '附件',
      openAttachment: (name) => `開啟附件 ${name}`,
      closeAttachment: '關閉附件預覽',
      attachmentUnavailable: '附件無法使用',
      directoryReferences: '引用目錄',
      inlineReferences: '引用檔案',
      quotes: '引用內容',
      skills: '技能',
      hostOrigin: '由執行服務發起',
    },
    thinking: {
      label: '思考過程',
      active: '正在思考…',
      truncated: '已截斷',
      duration: (seconds) => `${seconds} 秒`,
    },
    tools: {
      groupLabel: '工具呼叫',
      stepsLabel: '步驟',
      working: '正在處理…',
      thinkingOnly: '思考過程',
      thinkingActive: '正在思考…',
      summary: ZH_TW_ACTIVITY_SUMMARY,
      active: ZH_TW_ACTIVITY_ACTIVE,
      join: (phrases) => phrases.join('、'),
      expand: (name) => `展開 ${name}`,
      collapse: (name) => `收合 ${name}`,
    },
    result: {
      command: '指令',
      workingDirectory: '工作目錄',
      output: '輸出',
      arguments: '參數',
      diff: '變更',
      linesAdded: (count) => `+${count}`,
      linesRemoved: (count) => `-${count}`,
      imageAlt: (tool) => `${tool} 回傳的圖片`,
      archived: '結果已封存',
      archivedDetail: (reason, bytes) => `${reason} · 原始大小 ${bytes}`,
      openChildSession: '開啟子任務',
      childSessionUnavailable: '子任務無法使用',
      swarmItems: (count) => `${count} 個子任務`,
      failureClass: (value) => `失敗原因：${value}`,
      pending: '等待結果…',
    },
    sandbox: {
      blockedLabel: '被沙箱攔截',
      action: '切換到完全存取並重試',
      pending: '正在切換…',
      failedTitle: '切換權限模式失敗',
    },
    queue: {
      title: '排隊中的訊息',
      ariaLabel: '排隊中的訊息',
      promote: '插到最前',
      edit: '編輯',
      delete: '刪除',
      save: '儲存',
      cancel: '取消',
      moveUp: '上移',
      moveDown: '下移',
      position: (index, total) => `第 ${index} 則，共 ${total} 則`,
      empty: '沒有排隊中的訊息。',
      pendingSend: '正在送出…',
      failedTitle: '佇列操作失敗',
    },
    model: {
      label: '模型',
      none: '未選擇模型',
      empty: '新增模型',
      changeFailedTitle: '切換模型失敗',
    },
    context: {
      label: '脈絡用量',
      share: (percent) => `${percent}%`,
      used: (used, total) => `${used} / ${total}`,
      usedNoWindow: (used) => `已用 ${used}`,
      unavailable: '暫無脈絡資料',
      compact: '壓縮脈絡',
      compacting: '正在壓縮…',
    },
    notices: {
      ariaLabel: '工作階段提示',
      chooseModel: '選擇模型',
      openSettings: '開啟設定',
      retry: '重試',
      dismiss: '知道了',
      streamDegraded: '事件流不穩定，顯示的內容可能落後。',
      streamStalled: '事件流已中斷，正在重新連線。',
      resumeTitle: '上一輪被中斷',
      resumeDescription: '可以安全地從中斷處繼續。',
      resumeAction: '繼續',
      compactionDone: '脈絡已壓縮。',
      compactionUnchanged: (reason) => `脈絡沒有變化：${reason}`,
      compactionFailed: (reason) => `脈絡壓縮失敗：${reason}`,
    },
    quote: {
      action: '引用到輸入框',
      added: '已加入引用',
    },
  },
  en: {
    feed: {
      ariaLabel: 'Conversation transcript',
      loading: 'Loading the conversation…',
      empty: 'This task has no messages yet.',
      streaming: 'Generating a reply…',
      jumpToLatest: 'Jump to latest',
    },
    history: {
      ariaLabel: 'History navigation',
      earlier: 'Load earlier history',
      later: 'Load later history',
      latest: 'Jump to latest',
      loading: 'Loading…',
      beginning: 'Start of the conversation',
    },
    turn: {
      actionsLabel: 'Message actions',
      edit: 'Edit',
      editTitle: 'Edit and resend',
      editHint: 'Editing starts a new version of this task; the original is kept.',
      save: 'Save',
      cancel: 'Cancel',
      showMore: 'Show more',
      showLess: 'Show less',
      collapsed: 'Message collapsed',
      attachmentsLabel: 'Attachments',
      openAttachment: (name) => `Open attachment ${name}`,
      closeAttachment: 'Close attachment preview',
      attachmentUnavailable: 'Attachment unavailable',
      directoryReferences: 'Referenced directories',
      inlineReferences: 'Referenced files',
      quotes: 'Quoted text',
      skills: 'Skills',
      hostOrigin: 'Started by the runtime',
    },
    thinking: {
      label: 'Thought process',
      active: 'Thinking…',
      truncated: 'Truncated',
      duration: (seconds) => `${seconds}s`,
    },
    tools: {
      groupLabel: 'Tool activity',
      stepsLabel: 'Steps',
      working: 'Working on it…',
      thinkingOnly: 'Thought process',
      thinkingActive: 'Thinking…',
      summary: EN_ACTIVITY_SUMMARY,
      active: EN_ACTIVITY_ACTIVE,
      join: joinEnglishPhrases,
      expand: (name) => `Expand ${name}`,
      collapse: (name) => `Collapse ${name}`,
    },
    result: {
      command: 'Command',
      workingDirectory: 'Working directory',
      output: 'Output',
      arguments: 'Arguments',
      diff: 'Changes',
      linesAdded: (count) => `+${count}`,
      linesRemoved: (count) => `-${count}`,
      imageAlt: (tool) => `Image returned by ${tool}`,
      archived: 'Result archived',
      archivedDetail: (reason, bytes) => `${reason} · original size ${bytes}`,
      openChildSession: 'Open subtask',
      childSessionUnavailable: 'Subtask unavailable',
      swarmItems: (count) => `${count} subtasks`,
      failureClass: (value) => `Failure: ${value}`,
      pending: 'Waiting for the result…',
    },
    sandbox: {
      blockedLabel: 'Blocked by sandbox',
      action: 'Switch to full access and retry',
      pending: 'Switching…',
      failedTitle: 'Could not change the permission mode',
    },
    queue: {
      title: 'Queued messages',
      ariaLabel: 'Queued messages',
      promote: 'Send next',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      moveUp: 'Move up',
      moveDown: 'Move down',
      position: (index, total) => `${index} of ${total}`,
      empty: 'Nothing is queued.',
      pendingSend: 'Sending…',
      failedTitle: 'Queue action failed',
    },
    model: {
      label: 'Model',
      none: 'No model selected',
      empty: 'Add a model',
      changeFailedTitle: 'Could not change the model',
    },
    context: {
      label: 'Context usage',
      share: (percent) => `${percent}%`,
      used: (used, total) => `${used} / ${total}`,
      usedNoWindow: (used) => `${used} used`,
      unavailable: 'No context data yet',
      compact: 'Compact context',
      compacting: 'Compacting…',
    },
    notices: {
      ariaLabel: 'Session notices',
      chooseModel: 'Choose model',
      openSettings: 'Open settings',
      retry: 'Retry',
      dismiss: 'Dismiss',
      streamDegraded: 'The event stream is unsteady; what you see may lag behind.',
      streamStalled: 'The event stream dropped; reconnecting.',
      resumeTitle: 'The last run was interrupted',
      resumeDescription: 'It is safe to continue from where it stopped.',
      resumeAction: 'Continue',
      compactionDone: 'Context compacted.',
      compactionUnchanged: (reason) => `Context unchanged: ${reason}`,
      compactionFailed: (reason) => `Context compaction failed: ${reason}`,
    },
    quote: {
      action: 'Quote into the composer',
      added: 'Added to quotes',
    },
  },
} satisfies UiCatalog<TranscriptCopy>;

export function getTranscriptCopy(locale: UiLocale): TranscriptCopy {
  return TRANSCRIPT_COPY[locale];
}
