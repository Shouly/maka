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

// What the composer says that `@maka/ui`'s `conversation-copy` does not.
//
// The composer's core vocabulary — placeholder, send/stop, permission modes,
// thinking levels, mention menus, the ＋ menu's entries — already exists in
// `getConversationCopy(locale).composer / .model / .permissions / .mentions`,
// and is read straight from there. This catalog carries only what the desktop
// surface adds: the drop overlay and its announcements, the attachment strip
// and lightbox, the desktop slash commands, the bypass confirmation, the goal
// dialog, the revision notice, and the send-blocked hints.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type DesktopSlashCommandId = 'compact' | 'side' | 'graph' | 'swarm';

export interface ComposerCopy {
  readonly surfaceLabel: string;
  /** The empty editor's prompt: one line on the welcome surface, another in a task. */
  readonly placeholder: {
    readonly welcome: string;
    readonly session: string;
    /** While an ask-user question is open: a send is that question's free-text answer. */
    readonly replyToQuestion: string;
  };
  /**
   * Shown once, in turn, over the empty welcome editor after it mounts — the
   * reference's carousel of what `/` and `@` do — then the placeholder returns.
   */
  readonly hints: readonly string[];
  readonly drop: {
    readonly overlay: string;
    readonly announceEnter: string;
    readonly rejectedWhileRunning: string;
  };
  readonly attachments: {
    readonly regionLabel: string;
    readonly remove: (name: string) => string;
    readonly open: (name: string) => string;
    readonly lightboxLabel: (name: string) => string;
    readonly close: string;
    readonly added: (name: string) => string;
    readonly removed: (name: string) => string;
    readonly pickFailedTitle: string;
    readonly previewUnavailable: string;
  };
  readonly directories: {
    readonly regionLabel: string;
    readonly remove: (path: string) => string;
    readonly limitReached: string;
    readonly pickFailedTitle: string;
  };
  readonly quotes: {
    readonly regionLabel: string;
    readonly remove: (excerpt: string) => string;
  };
  readonly menu: {
    readonly orchestrationStandard: string;
    readonly orchestrationSwarm: string;
    readonly orchestrationGraph: string;
    /** The ＋ menu's two import rows: staged file attachments, a referenced folder. */
    readonly addFiles: string;
    readonly addFolder: string;
    /** The Skills submenu's own row in the ＋ menu. */
    readonly skills: string;
    /** The Skills submenu's pinned last row: opens the Skills page. */
    readonly manageSkills: string;
    /** The model menu's effort (thinking level) submenu and the chip's readout. */
    readonly effort: string;
    /** The effort readout when the level is the model's own default. */
    readonly effortDefault: string;
    /** The model menu's last row: the other connections' models, in a submenu. */
    readonly moreModels: string;
    /** The effort submenu's one-line explanation, above the levels. */
    readonly effortHelp: string;
    /** Tooltip on the Auto level: what leaving the choice to the model means. */
    readonly effortAutoHelp: string;
    /** The Skills submenu while the catalog is still being read. */
    readonly loadingSkills: string;
  };
  readonly slash: {
    readonly command: Record<
      DesktopSlashCommandId,
      { readonly label: string; readonly description: string }
    >;
    readonly notYet: string;
  };
  readonly permission: {
    readonly disabledRunning: string;
    readonly bypassTitle: string;
    readonly bypassDescription: string;
    readonly bypassConfirm: string;
    readonly bypassCancel: string;
    readonly changeFailedTitle: string;
  };
  readonly goal: {
    readonly title: string;
    readonly description: string;
    readonly conditionLabel: string;
    readonly conditionPlaceholder: string;
    readonly iterationsLabel: string;
    readonly budgetLabel: string;
    readonly budgetHint: string;
    readonly submit: string;
    readonly cancel: string;
    readonly conditionRequired: string;
    readonly iterationsInvalid: string;
    readonly budgetInvalid: string;
    readonly armedTitle: string;
    readonly failedTitle: string;
  };
  readonly revision: {
    readonly title: string;
    readonly description: string;
    readonly cancel: string;
  };
  /** The ask-user wizard pinned above the composer (relx `AskUserPanel`). */
  readonly questions: {
    readonly progress: (index: number, total: number) => string;
    readonly skip: string;
    readonly closeWithoutAnswering: string;
    readonly somethingElse: string;
    readonly confirmNext: string;
    readonly confirmSubmit: string;
  };
  readonly send: {
    readonly currentTurn: string;
    readonly nextTurn: string;
    readonly blockedNoWorkspace: string;
    readonly blockedNoModel: string;
    readonly blockedReadiness: string;
    readonly failedTitle: string;
    readonly failedFallback: string;
    readonly skillFailedTitle: string;
    readonly skillFailedFallback: string;
    readonly outcomeUnknownTitle: string;
    readonly outcomeUnknownDescription: string;
    readonly steeredTitle: string;
    readonly steeredDescription: string;
  };
}

const COMPOSER_COPY = {
  'zh-CN': {
    surfaceLabel: '消息输入区',
    placeholder: {
      welcome: '今天想做点什么？',
      session: '输入消息…',
      replyToQuestion: '或直接回复…',
    },
    hints: ['输入 / 选择技能', '输入 @ 引用文件'],
    drop: {
      overlay: '拖到这里作为附件',
      announceEnter: '松开即可添加附件',
      rejectedWhileRunning: '当前回答进行中，暂时无法添加附件。',
    },
    attachments: {
      regionLabel: '已添加的附件',
      remove: (name) => `移除 ${name}`,
      open: (name) => `预览 ${name}`,
      lightboxLabel: (name) => `图片预览：${name}`,
      close: '关闭',
      added: (name) => `已添加附件 ${name}`,
      removed: (name) => `已移除附件 ${name}`,
      pickFailedTitle: '附件添加失败',
      previewUnavailable: '无法预览这个文件',
    },
    directories: {
      regionLabel: '引用的文件夹',
      remove: (path) => `移除文件夹引用 ${path}`,
      limitReached: '最多只能引用 4 个文件夹。',
      pickFailedTitle: '文件夹引用失败',
    },
    quotes: { regionLabel: '引用片段', remove: (excerpt) => `移除引用：${excerpt}` },
    menu: {
      orchestrationStandard: '标准',
      addFiles: '添加文件',
      addFolder: '添加文件夹',
      skills: '技能',
      effort: 'Effort',
      effortDefault: '自动',
      moreModels: '更多模型',
      effortHelp: '档位越高，回答越周全，但更慢、也更快用掉额度。',
      effortAutoHelp: '不指定档位，由模型按问题难度决定思考深度。',
      orchestrationSwarm: '群体',
      orchestrationGraph: '图',
      manageSkills: '管理技能',
      loadingSkills: '正在读取技能…',
    },
    slash: {
      command: {
        compact: { label: '/compact', description: '压缩上下文，为后续对话腾出窗口。' },
        side: { label: '/side', description: '开一段侧边对话。' },
        graph: { label: '/graph', description: '用智能体图执行。' },
        swarm: { label: '/swarm', description: '用智能体群执行。' },
      },
      notYet: '这个命令还未在新界面上线。',
    },
    permission: {
      disabledRunning: '当前回答进行中，结束后再切换权限模式。',
      bypassTitle: '切换到完全权限？',
      bypassDescription:
        '完全权限下，任务可以直接读写文件与访问网络，不再逐项询问。只在你信任这次任务时使用。',
      bypassConfirm: '切换到完全权限',
      bypassCancel: '取消',
      changeFailedTitle: '权限模式切换失败',
    },
    goal: {
      title: '设定目标',
      description: '达成条件之前，任务会自动继续。达到轮数或令牌上限时停止。',
      conditionLabel: '达成条件',
      conditionPlaceholder: '例如：所有测试通过',
      iterationsLabel: '最多轮数',
      budgetLabel: '令牌预算',
      budgetHint: '留空表示不限制。',
      submit: '开始',
      cancel: '取消',
      conditionRequired: '请填写达成条件。',
      iterationsInvalid: '轮数需要是 1 到 100 之间的整数。',
      budgetInvalid: '令牌预算需要是正整数。',
      armedTitle: '目标已设定',
      failedTitle: '目标设定失败',
    },
    revision: {
      title: '正在编辑并重发',
      description: '发送后会基于这条消息之前的内容新建一个版本。',
      cancel: '取消编辑',
    },
    questions: {
      progress: (index, total) => `第 ${index} 题，共 ${total} 题`,
      skip: '跳过',
      closeWithoutAnswering: '不回答，直接关闭',
      somethingElse: '其他答案',
      confirmNext: '下一题',
      confirmSubmit: '提交答案',
    },
    send: {
      currentTurn: '补充本轮',
      nextTurn: '下一轮发送',
      blockedNoWorkspace: '先选择一个工作区。',
      blockedNoModel: '先配置一个模型连接。',
      blockedReadiness: '当前环境暂时无法接受新任务。',
      failedTitle: '消息发送失败',
      failedFallback: '未能发送这条消息。',
      skillFailedTitle: '技能调用失败',
      skillFailedFallback: '这条消息里的技能未能加载，消息没有发出。',
      outcomeUnknownTitle: '发送结果未知',
      outcomeUnknownDescription: '没有收到确认。消息可能已经送达，草稿已为你保留。',
      steeredTitle: '已作为补充说明送入当前回答',
      steeredDescription: '当前回答仍在进行，这条消息已并入其中。',
    },
  },
  'zh-TW': {
    surfaceLabel: '訊息輸入區',
    placeholder: {
      welcome: '今天想做點什麼？',
      session: '輸入訊息…',
      replyToQuestion: '或直接回覆…',
    },
    hints: ['輸入 / 選擇技能', '輸入 @ 引用檔案'],
    drop: {
      overlay: '拖到這裡作為附件',
      announceEnter: '放開即可加入附件',
      rejectedWhileRunning: '目前回答進行中，暫時無法加入附件。',
    },
    attachments: {
      regionLabel: '已加入的附件',
      remove: (name) => `移除 ${name}`,
      open: (name) => `預覽 ${name}`,
      lightboxLabel: (name) => `圖片預覽：${name}`,
      close: '關閉',
      added: (name) => `已加入附件 ${name}`,
      removed: (name) => `已移除附件 ${name}`,
      pickFailedTitle: '附件加入失敗',
      previewUnavailable: '無法預覽這個檔案',
    },
    directories: {
      regionLabel: '引用的資料夾',
      remove: (path) => `移除資料夾引用 ${path}`,
      limitReached: '最多只能引用 4 個資料夾。',
      pickFailedTitle: '資料夾引用失敗',
    },
    quotes: { regionLabel: '引用片段', remove: (excerpt) => `移除引用：${excerpt}` },
    menu: {
      orchestrationStandard: '標準',
      addFiles: '新增檔案',
      addFolder: '新增資料夾',
      skills: '技能',
      effort: 'Effort',
      effortDefault: '自動',
      moreModels: '更多模型',
      effortHelp: '檔位越高，回答越周全，但更慢、也更快用掉額度。',
      effortAutoHelp: '不指定檔位，由模型按問題難度決定思考深度。',
      orchestrationSwarm: '群體',
      orchestrationGraph: '圖',
      manageSkills: '管理技能',
      loadingSkills: '正在讀取技能…',
    },
    slash: {
      command: {
        compact: { label: '/compact', description: '壓縮脈絡，為後續對話騰出視窗。' },
        side: { label: '/side', description: '開一段側邊對話。' },
        graph: { label: '/graph', description: '用智慧體圖執行。' },
        swarm: { label: '/swarm', description: '用智慧體群執行。' },
      },
      notYet: '這個指令還未在新介面上線。',
    },
    permission: {
      disabledRunning: '目前回答進行中，結束後再切換權限模式。',
      bypassTitle: '切換到完全權限？',
      bypassDescription:
        '完全權限下，任務可以直接讀寫檔案與存取網路，不再逐項詢問。只在你信任這次任務時使用。',
      bypassConfirm: '切換到完全權限',
      bypassCancel: '取消',
      changeFailedTitle: '權限模式切換失敗',
    },
    goal: {
      title: '設定目標',
      description: '達成條件之前，任務會自動繼續。達到輪數或權杖上限時停止。',
      conditionLabel: '達成條件',
      conditionPlaceholder: '例如：所有測試通過',
      iterationsLabel: '最多輪數',
      budgetLabel: '權杖預算',
      budgetHint: '留空表示不限制。',
      submit: '開始',
      cancel: '取消',
      conditionRequired: '請填寫達成條件。',
      iterationsInvalid: '輪數需要是 1 到 100 之間的整數。',
      budgetInvalid: '權杖預算需要是正整數。',
      armedTitle: '目標已設定',
      failedTitle: '目標設定失敗',
    },
    revision: {
      title: '正在編輯並重送',
      description: '送出後會基於這條訊息之前的內容新建一個版本。',
      cancel: '取消編輯',
    },
    questions: {
      progress: (index, total) => `第 ${index} 題，共 ${total} 題`,
      skip: '跳過',
      closeWithoutAnswering: '不回答，直接關閉',
      somethingElse: '其他答案',
      confirmNext: '下一題',
      confirmSubmit: '提交答案',
    },
    send: {
      currentTurn: '補充本輪',
      nextTurn: '下一輪傳送',
      blockedNoWorkspace: '請先選擇一個工作區。',
      blockedNoModel: '請先設定一個模型連線。',
      blockedReadiness: '目前環境暫時無法接受新任務。',
      failedTitle: '訊息傳送失敗',
      failedFallback: '未能傳送這條訊息。',
      skillFailedTitle: '技能呼叫失敗',
      skillFailedFallback: '這條訊息裡的技能未能載入，訊息沒有送出。',
      outcomeUnknownTitle: '傳送結果未知',
      outcomeUnknownDescription: '沒有收到確認。訊息可能已經送達，草稿已為你保留。',
      steeredTitle: '已作為補充說明送入目前回答',
      steeredDescription: '目前回答仍在進行，這條訊息已併入其中。',
    },
  },
  en: {
    surfaceLabel: 'Message composer',
    placeholder: {
      welcome: 'How can I help you today?',
      session: 'Write a message…',
      replyToQuestion: 'Or reply directly…',
    },
    hints: ['Type / for skills', 'Type @ for files'],
    drop: {
      overlay: 'Drop files here to attach them',
      announceEnter: 'Release to attach the files',
      rejectedWhileRunning: 'Wait for the current answer to finish before attaching files.',
    },
    attachments: {
      regionLabel: 'Attached files',
      remove: (name) => `Remove ${name}`,
      open: (name) => `Preview ${name}`,
      lightboxLabel: (name) => `Image preview: ${name}`,
      close: 'Close',
      added: (name) => `Attached ${name}`,
      removed: (name) => `Removed ${name}`,
      pickFailedTitle: 'The file could not be attached',
      previewUnavailable: 'This file cannot be previewed',
    },
    directories: {
      regionLabel: 'Referenced folders',
      remove: (path) => `Remove folder reference ${path}`,
      limitReached: 'At most four folders can be referenced.',
      pickFailedTitle: 'The folder could not be referenced',
    },
    quotes: { regionLabel: 'Quoted excerpts', remove: (excerpt) => `Remove quote: ${excerpt}` },
    menu: {
      orchestrationStandard: 'Standard',
      addFiles: 'Add files',
      addFolder: 'Add folder',
      skills: 'Skills',
      effort: 'Effort',
      effortDefault: 'Auto',
      moreModels: 'More models',
      effortHelp:
        'Higher effort means more thorough responses, but takes longer and uses your limits faster.',
      effortAutoHelp:
        'No level is set; the model decides how deeply to think from the task at hand.',
      orchestrationSwarm: 'Swarm',
      orchestrationGraph: 'Graph',
      manageSkills: 'Manage skills',
      loadingSkills: 'Reading skills…',
    },
    slash: {
      command: {
        compact: {
          label: '/compact',
          description: 'Compact the context to make room for what comes next.',
        },
        side: { label: '/side', description: 'Open a side conversation.' },
        graph: { label: '/graph', description: 'Run through an agent graph.' },
        swarm: { label: '/swarm', description: 'Run through an agent swarm.' },
      },
      notYet: 'This command is not available in the new interface yet.',
    },
    permission: {
      disabledRunning: 'Wait for the current answer to finish before changing the permission mode.',
      bypassTitle: 'Switch to full access?',
      bypassDescription:
        'With full access the task reads and writes files and reaches the network directly, without asking each time. Use it only for a task you trust.',
      bypassConfirm: 'Switch to full access',
      bypassCancel: 'Cancel',
      changeFailedTitle: 'The permission mode could not be changed',
    },
    goal: {
      title: 'Set a goal',
      description:
        'The task keeps going on its own until the condition is met, and stops at the iteration or token ceiling.',
      conditionLabel: 'Done when',
      conditionPlaceholder: 'For example: all tests pass',
      iterationsLabel: 'Maximum iterations',
      budgetLabel: 'Token budget',
      budgetHint: 'Leave empty for no ceiling.',
      submit: 'Start',
      cancel: 'Cancel',
      conditionRequired: 'Describe when the goal is done.',
      iterationsInvalid: 'Iterations must be a whole number between 1 and 100.',
      budgetInvalid: 'The token budget must be a positive whole number.',
      armedTitle: 'Goal set',
      failedTitle: 'The goal could not be set',
    },
    revision: {
      title: 'Editing and resending',
      description: 'Sending forks a new version of this task from just before that message.',
      cancel: 'Cancel editing',
    },
    questions: {
      progress: (index, total) => `${index} of ${total}`,
      skip: 'Skip',
      closeWithoutAnswering: 'Close without answering',
      somethingElse: 'Something else',
      confirmNext: 'Next question',
      confirmSubmit: 'Submit answers',
    },
    send: {
      currentTurn: 'Add to this turn',
      nextTurn: 'Send next turn',
      blockedNoWorkspace: 'Choose a workspace first.',
      blockedNoModel: 'Set up a model connection first.',
      blockedReadiness: 'This environment cannot accept a new task right now.',
      failedTitle: 'The message could not be sent',
      failedFallback: 'The message was not sent.',
      skillFailedTitle: 'A skill could not be invoked',
      skillFailedFallback: 'A skill in this message failed to load, so the message was not sent.',
      outcomeUnknownTitle: 'The result is unknown',
      outcomeUnknownDescription:
        'No confirmation came back. The message may already have arrived; your draft has been kept.',
      steeredTitle: 'Folded into the running answer',
      steeredDescription: 'The answer is still in progress, so this message joined it as steering.',
    },
  },
} satisfies UiCatalog<ComposerCopy>;

export function getComposerCopy(locale: UiLocale): ComposerCopy {
  return COMPOSER_COPY[locale];
}
