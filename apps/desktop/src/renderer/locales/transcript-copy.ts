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

import type { ToolSummaryKey } from '../components/session/tools/tool-presentation.js';
import type { DeliveryFileKind } from '../lib/ported/delivery-file-label.js';
import type { MakaPlatform } from '../lib/platform.js';
import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

/**
 * One tool group's summary phrase.
 *
 * `other` takes the count for the kinds that name an object — "Read 16 files",
 * "Ran 22 commands". A kind that counts CALLS rather than objects says the same
 * thing at any count and ignores the argument: "Updated tasks" is what the turn
 * did, and "Updated tasks 6 times" only tells the reader how many calls it took
 * to say it, which reads as churn now that one call carries one task.
 */
export interface ToolSummaryLabel {
  readonly one: string;
  readonly other: (count: number) => string;
  /**
   * Labels that share an `object` merge into one phrase when a group holds
   * several of them, the object said once — "Searched, read, and updated
   * memory". `verb` is the past-tense verb the phrase contributes; the
   * locale's `joinMerged` puts the sentence together.
   */
  readonly merge?: { readonly verb: string; readonly object: string };
}

/**
 * The families a step row's verb comes from. Each has three tenses, because a
 * row says what it is doing, then what it did — or that it did not.
 */
export type ToolStepVerbKey =
  | 'command'
  | 'read'
  | 'create'
  | 'update'
  | 'edit'
  | 'search'
  | 'fetch'
  | 'webSearch'
  | 'agent'
  | 'skill'
  | 'taskAdd'
  | 'taskUpdate'
  | 'taskComplete'
  | 'taskStart'
  | 'taskReset'
  | 'taskRemove'
  | 'taskGet'
  | 'taskList'
  | 'taskStop'
  | 'ask'
  | 'share'
  | 'message'
  | 'toolSearch'
  | 'tool'
  | 'memorySearch'
  | 'memorySave'
  | 'memoryUpdate'
  | 'memoryDelete';

export interface ToolStepVerb {
  readonly done: string;
  readonly running: string;
  readonly failed: string;
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
  };
  /**
   * That a background task ended, in one clause. What Copilot did about it is
   * the reply underneath, so the line does not narrate it.
   */
  readonly taskFinished: {
    readonly completed: (task: { title: string; detail?: string }) => string;
    readonly failed: (task: { title: string; detail?: string }) => string;
    readonly killed: (task: { title: string; detail?: string }) => string;
  };
  /** The same event for a child agent rather than a command. */
  readonly agentFinished: {
    readonly completed: (task: { title: string; detail?: string }) => string;
    readonly failed: (task: { title: string; detail?: string }) => string;
    readonly killed: (task: { title: string; detail?: string }) => string;
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
    /** The status line while an AskUserQuestion waits for the user. */
    /** Under a question the user skipped or never reached. */
    readonly noAnswer: string;
    readonly thinkingOnly: string;
    readonly thinkingActive: string;
    /** The status line while the answer's prose is still streaming. */
    readonly writing: string;
    /**
     * The status line once the turn has gone quiet for longer than usual. It
     * REPLACES the activity phrase rather than joining it: the phrase names
     * the last block this renderer heard about, which is precisely what a
     * quiet stretch makes doubtful.
     *
     * It REASSURES; it does not diagnose. Silence is not evidence of a fault —
     * any tool call longer than the staleness threshold (a build, a test run,
     * a fetch) sends no events either, so "the connection dropped" or "nothing
     * is arriving" would be wrong on the common case. What the reader needs at
     * a minute in is that the work is still theirs and still running, and that
     * this one is simply slower than most. The clock beside it already says
     * how long, so the phrase never repeats that.
     */
    readonly streamUnsteady: string;
    /** The card that confirms a scheduled task the turn created or changed. */
    readonly scheduledTask: {
      readonly creating: string;
      readonly created: string;
      readonly updating: string;
      readonly updated: string;
    };
    readonly summary: Record<ToolSummaryKey, ToolSummaryLabel>;
    readonly active: Record<ToolSummaryKey, string>;
    readonly join: (phrases: readonly string[]) => string;
    /** Several verbs on one object, as one phrase: `(['searched', 'read'], 'memory')`. */
    readonly joinMerged: (verbs: readonly string[], object: string) => string;
    readonly expand: (name: string) => string;
    readonly collapse: (name: string) => string;
    /** A summary that names only its first phrases: "…, and 3 more steps". */
    readonly moreSteps: (phrases: string, count: number) => string;
    /** A run's status row while the turn waits on the user. */
    readonly blocked: { readonly question: string; readonly input: string };
    /**
     * A step row: a muted verb, then the object it acted on. The verb is the
     * row's identity — there is no icon — so each family has its own.
     */
    readonly step: {
      readonly verbs: Readonly<Record<ToolStepVerbKey, ToolStepVerb>>;
      /** Bash's object when the call carries neither description nor command. */
      readonly aCommand: string;
      readonly questions: (count: number) => string;
      readonly files: (count: number) => string;
      /** The tag after a failed step. */
      readonly failed: string;
    };
    /**
     * A task row says what it is doing, then what it did. The tool's own name
     * ("Task Create") is not the useful half: four tools share one icon, so
     * the verb is what tells them apart at a glance.
     */
    readonly task: {
      readonly creating: string;
      readonly created: string;
      readonly updating: string;
      readonly updated: string;
      readonly fetching: (taskId: string | undefined) => string;
      readonly fetched: (taskId: string | undefined) => string;
      readonly listing: string;
      readonly listed: string;
      /**
       * What the row says when the call did NOT do what it set out to do.
       *
       * A third form, not a nicety: with only a running and a settled form, a
       * refused TaskUpdate had to pick between "updating" (it is not) and
       * "updated" (it did not) — and it picked the second, so the row asserted
       * the change it had just been refused. The attempt is the one thing that
       * is true either way.
       */
      readonly attempted: {
        readonly create: string;
        readonly update: string;
        readonly fetch: (taskId: string | undefined) => string;
        readonly list: string;
      };
    };
    /**
     * A memory row: the verb and the file, then what went wrong when
     * something did. The six tools share an icon, so the verb is the row's
     * whole identity, and each verb has a running and a settled form.
     */
    readonly memory: {
      readonly searching: string;
      readonly searched: string;
      readonly reading: (name: string | undefined) => string;
      readonly read: (name: string | undefined) => string;
      readonly saving: (name: string | undefined) => string;
      readonly saved: (name: string | undefined) => string;
      readonly updating: (name: string | undefined) => string;
      readonly updated: (name: string | undefined) => string;
      readonly deleting: (name: string | undefined) => string;
      readonly deleted: (name: string | undefined) => string;
      /** "3 files": a listing's count, and the name of a read across several. */
      readonly files: (count: number) => string;
      /** Beside a write the model is merging after a version conflict. */
      readonly merging: string;
      readonly removed: string;
      readonly added: string;
      /** The attempt, for a call that failed — see `task.attempted`. */
      readonly attempted: {
        readonly search: string;
        readonly read: (name: string | undefined) => string;
        readonly save: (name: string | undefined) => string;
        readonly update: (name: string | undefined) => string;
        readonly delete: (name: string | undefined) => string;
      };
    };
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
  /** SendUserFile's card strip. */
  readonly delivery: {
    readonly filesLabel: string;
    readonly openFile: (name: string) => string;
    readonly empty: string;
    /** The word before the extension on a card: `Document · MD`, `Code · PY`. */
    readonly kind: Readonly<Record<DeliveryFileKind, string>>;
    /**
     * The card's one action, named by the platform's own file manager — a
     * generic "file manager" is a word nobody's desktop uses.
     */
    readonly showIn: Readonly<Record<MakaPlatform, string>>;
    readonly openFailed: string;
    readonly openOutsideWorkspace: string;
  };
  /** The Grep and Glob list panels. */
  readonly search: {
    readonly matchesLabel: string;
    readonly filesLabel: string;
    readonly openPath: (path: string) => string;
    readonly occurrences: (count: number) => string;
    readonly noMatches: string;
    readonly noFiles: string;
    /** The last row of a capped list. */
    readonly omitted: (count: number) => string;
    readonly omittedUnknown: string;
  };
  /**
   * A background command inherited from another session, said in the row's
   * trailing slot — the same place an interruption is said.
   *
   * Two states and they are not the same news. `elsewhere` is running and
   * healthy, just not here: the owner session publishes its updates and this
   * row settles when it ends. `lost` is the one that needed saying — the owner
   * cannot be resolved, so the only state left is the transcript's snapshot,
   * which says "running" and always will.
   */
  readonly inheritedRun: {
    readonly elsewhere: string;
    readonly lost: string;
  };
  readonly sandbox: {
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
    readonly transcriptLoadFailed: string;
    readonly transcriptLoadFailedDetail: string;
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

const ZH_CN_ACTIVITY_SUMMARY: Record<ToolSummaryKey, ToolSummaryLabel> = {
  computer: { one: '操作了电脑', other: (n) => `操作电脑 ${n} 次` },
  read: { one: '读取了文件', other: (n) => `读取 ${n} 个文件` },
  search: { one: '搜索了代码', other: (n) => `搜索 ${n} 次` },
  websearch: { one: '搜索了网页', other: (n) => `搜索网页 ${n} 次` },
  webfetch: { one: '抓取了网页', other: (n) => `抓取 ${n} 个网页` },
  edit: { one: '修改了文件', other: (n) => `修改 ${n} 个文件` },
  command: { one: '执行了命令', other: (n) => `执行 ${n} 条命令` },
  explore: { one: '浏览了目录', other: (n) => `浏览 ${n} 个目录` },
  browser: { one: '操作了浏览器', other: (n) => `操作浏览器 ${n} 次` },
  tasks: { one: '更新了任务进度', other: () => '更新了任务进度' },
  delegate: { one: '派发了子任务', other: (n) => `派发 ${n} 个子任务` },
  schedule: { one: '设置了定时任务', other: () => '设置了定时任务' },
  ask: { one: '提出了一个问题', other: (n) => `提出 ${n} 个问题` },
  taskRead: { one: '查看了任务进度', other: () => '查看了任务进度' },
  toolSearch: { one: '加载了工具', other: () => '加载了工具' },
  share: { one: '分享了文件', other: (n) => `分享了 ${n} 个文件` },
  tool: { one: '使用了工具', other: (n) => `使用了 ${n} 个工具` },
  memorySearch: {
    one: '搜索了记忆',
    other: () => '搜索了记忆',
    merge: { verb: '搜索', object: '记忆' },
  },
  memoryRead: {
    one: '读取了记忆',
    other: () => '读取了记忆',
    merge: { verb: '读取', object: '记忆' },
  },
  memorySave: {
    one: '保存了记忆',
    other: () => '保存了记忆',
    merge: { verb: '保存', object: '记忆' },
  },
  memoryUpdate: {
    one: '更新了记忆',
    other: () => '更新了记忆',
    merge: { verb: '更新', object: '记忆' },
  },
  memoryDelete: {
    one: '删除了记忆',
    other: () => '删除了记忆',
    merge: { verb: '删除', object: '记忆' },
  },
};

const ZH_CN_ACTIVITY_ACTIVE: Record<ToolSummaryKey, string> = {
  computer: '正在操作电脑',
  read: '正在读取文件',
  search: '正在搜索',
  websearch: '正在搜索网页',
  webfetch: '正在抓取网页',
  edit: '正在修改文件',
  command: '正在执行命令',
  explore: '正在浏览目录',
  browser: '正在操作浏览器',
  tasks: '正在更新任务进度',
  delegate: '正在派发子任务',
  schedule: '正在设置定时任务',
  ask: '正在向你提问…',
  taskRead: '正在查看任务进度',
  toolSearch: '正在加载工具',
  share: '正在分享文件',
  tool: '正在使用工具',
  memorySearch: '正在搜索记忆',
  memoryRead: '正在读取记忆',
  memorySave: '正在保存记忆',
  memoryUpdate: '正在更新记忆',
  memoryDelete: '正在删除记忆',
};

const ZH_TW_ACTIVITY_SUMMARY: Record<ToolSummaryKey, ToolSummaryLabel> = {
  computer: { one: '操作了電腦', other: (n) => `操作電腦 ${n} 次` },
  read: { one: '讀取了檔案', other: (n) => `讀取 ${n} 個檔案` },
  search: { one: '搜尋了程式碼', other: (n) => `搜尋 ${n} 次` },
  websearch: { one: '搜尋了網頁', other: (n) => `搜尋網頁 ${n} 次` },
  webfetch: { one: '擷取了網頁', other: (n) => `擷取 ${n} 個網頁` },
  edit: { one: '修改了檔案', other: (n) => `修改 ${n} 個檔案` },
  command: { one: '執行了指令', other: (n) => `執行 ${n} 條指令` },
  explore: { one: '瀏覽了目錄', other: (n) => `瀏覽 ${n} 個目錄` },
  browser: { one: '操作了瀏覽器', other: (n) => `操作瀏覽器 ${n} 次` },
  tasks: { one: '更新了任務進度', other: () => '更新了任務進度' },
  delegate: { one: '派發了子任務', other: (n) => `派發 ${n} 個子任務` },
  schedule: { one: '設定了排程任務', other: () => '設定了排程任務' },
  ask: { one: '提出了一個問題', other: (n) => `提出 ${n} 個問題` },
  taskRead: { one: '查看了任務進度', other: () => '查看了任務進度' },
  toolSearch: { one: '載入了工具', other: () => '載入了工具' },
  share: { one: '分享了檔案', other: (n) => `分享了 ${n} 個檔案` },
  tool: { one: '使用了工具', other: (n) => `使用了 ${n} 個工具` },
  memorySearch: {
    one: '搜尋了記憶',
    other: () => '搜尋了記憶',
    merge: { verb: '搜尋', object: '記憶' },
  },
  memoryRead: {
    one: '讀取了記憶',
    other: () => '讀取了記憶',
    merge: { verb: '讀取', object: '記憶' },
  },
  memorySave: {
    one: '儲存了記憶',
    other: () => '儲存了記憶',
    merge: { verb: '儲存', object: '記憶' },
  },
  memoryUpdate: {
    one: '更新了記憶',
    other: () => '更新了記憶',
    merge: { verb: '更新', object: '記憶' },
  },
  memoryDelete: {
    one: '刪除了記憶',
    other: () => '刪除了記憶',
    merge: { verb: '刪除', object: '記憶' },
  },
};

const ZH_TW_ACTIVITY_ACTIVE: Record<ToolSummaryKey, string> = {
  computer: '正在操作電腦',
  read: '正在讀取檔案',
  search: '正在搜尋',
  websearch: '正在搜尋網頁',
  webfetch: '正在擷取網頁',
  edit: '正在修改檔案',
  command: '正在執行指令',
  explore: '正在瀏覽目錄',
  browser: '正在操作瀏覽器',
  tasks: '正在更新任務進度',
  delegate: '正在派發子任務',
  schedule: '正在設定排程任務',
  ask: '正在向你提問…',
  taskRead: '正在查看任務進度',
  toolSearch: '正在載入工具',
  share: '正在分享檔案',
  tool: '正在使用工具',
  memorySearch: '正在搜尋記憶',
  memoryRead: '正在讀取記憶',
  memorySave: '正在儲存記憶',
  memoryUpdate: '正在更新記憶',
  memoryDelete: '正在刪除記憶',
};

const EN_ACTIVITY_SUMMARY: Record<ToolSummaryKey, ToolSummaryLabel> = {
  computer: { one: 'Used the computer', other: (n) => `Used the computer ${n} times` },
  read: { one: 'Read a file', other: (n) => `Read ${n} files` },
  search: { one: 'Searched the code', other: (n) => `Ran ${n} searches` },
  websearch: { one: 'Searched the web', other: (n) => `Ran ${n} web searches` },
  webfetch: { one: 'Fetched a page', other: (n) => `Fetched ${n} pages` },
  edit: { one: 'Edited a file', other: (n) => `Edited ${n} files` },
  command: { one: 'Ran a command', other: (n) => `Ran ${n} commands` },
  explore: { one: 'Explored a directory', other: (n) => `Explored ${n} directories` },
  browser: { one: 'Used the browser', other: (n) => `Used the browser ${n} times` },
  tasks: { one: 'Updated tasks', other: () => 'Updated tasks' },
  delegate: { one: 'Delegated a task', other: (n) => `Delegated ${n} tasks` },
  schedule: { one: 'Scheduled a task', other: () => 'Scheduled tasks' },
  ask: { one: 'Asked a question', other: (n) => `Asked ${n} questions` },
  taskRead: { one: 'Checked tasks', other: () => 'Checked tasks' },
  toolSearch: { one: 'Loaded tools', other: () => 'Loaded tools' },
  share: { one: 'Shared a file', other: (n) => `Shared ${n} files` },
  tool: { one: 'Used a tool', other: (n) => `Used ${n} tools` },
  memorySearch: {
    one: 'Searched memory',
    other: () => 'Searched memory',
    merge: { verb: 'searched', object: 'memory' },
  },
  memoryRead: {
    one: 'Read memory',
    other: () => 'Read memory',
    merge: { verb: 'read', object: 'memory' },
  },
  memorySave: {
    one: 'Saved memory',
    other: () => 'Saved memory',
    merge: { verb: 'saved', object: 'memory' },
  },
  memoryUpdate: {
    one: 'Updated memory',
    other: () => 'Updated memory',
    merge: { verb: 'updated', object: 'memory' },
  },
  memoryDelete: {
    one: 'Deleted memory',
    other: () => 'Deleted memory',
    merge: { verb: 'deleted', object: 'memory' },
  },
};

const EN_ACTIVITY_ACTIVE: Record<ToolSummaryKey, string> = {
  computer: 'Using the computer',
  read: 'Reading a file',
  search: 'Searching the code',
  websearch: 'Searching the web',
  webfetch: 'Fetching a page',
  edit: 'Editing a file',
  command: 'Running a command',
  explore: 'Exploring a directory',
  browser: 'Using the browser',
  tasks: 'Updating progress',
  delegate: 'Delegating a task',
  schedule: 'Scheduling a task',
  ask: 'Asking you a question…',
  taskRead: 'Checking progress',
  toolSearch: 'Loading tools',
  share: 'Sharing files',
  tool: 'Using a tool',
  memorySearch: 'Searching memory',
  memoryRead: 'Reading memory',
  memorySave: 'Saving memory',
  memoryUpdate: 'Updating memory',
  memoryDelete: 'Deleting memory',
};

/**
 * Serial-comma joining, English only. The Chinese locales use the ideographic
 * comma and never lower-case a following phrase, so their join is a plain
 * concatenation — running the English rule over Chinese would insert " and "
 * into a Chinese sentence.
 */
/**
 * "搜索并读取了记忆", "搜索、读取并更新了记忆": the verbs run together with the
 * enumeration comma, "并" before the last, and the aspect marker and object
 * once at the end. Both Chinese locales share the shape; the marker differs.
 */
function joinChineseVerbs(verbs: readonly string[], object: string, and: string): string {
  if (verbs.length <= 1) return `${verbs[0] ?? ''}了${object}`;
  return `${verbs.slice(0, -1).join('、')}${and}${verbs[verbs.length - 1]}了${object}`;
}

/** "Searched memory", "Read and saved memory", "Searched, read, and updated memory". */
function joinEnglishVerbs(verbs: readonly string[], object: string): string {
  const [first = '', ...rest] = verbs;
  const head = first.charAt(0).toUpperCase() + first.slice(1);
  if (rest.length === 0) return `${head} ${object}`;
  if (rest.length === 1) return `${head} and ${rest[0]} ${object}`;
  return `${[head, ...rest.slice(0, -1)].join(', ')}, and ${rest[rest.length - 1]} ${object}`;
}

/**
 * "Used 24 tools, updated tasks, ran 2 commands": commas only, every phrase
 * after the first lower-cased — the reference's summary line, which keeps
 * "and" for the "…, and 3 more steps" tail.
 */
function joinEnglishPhrases(phrases: readonly string[]): string {
  const lowered = phrases.map((phrase, index) =>
    index === 0 ? phrase : `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`,
  );
  return lowered.join(', ');
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
    },
    taskFinished: {
      completed: ({ title }) => `后台任务「${title}」已完成`,
      failed: ({ title, detail }) => `后台任务「${title}」失败${detail ? `（${detail}）` : ''}`,
      killed: ({ title }) => `后台任务「${title}」已停止`,
    },
    agentFinished: {
      completed: ({ title }) => `子助手「${title}」已完成`,
      failed: ({ title, detail }) => `子助手「${title}」失败${detail ? `（${detail}）` : ''}`,
      killed: ({ title }) => `子助手「${title}」已停止`,
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
      noAnswer: '未回答',
      thinkingOnly: '思考过程',
      thinkingActive: '正在思考…',
      writing: '正在撰写…',
      streamUnsteady: '仍在处理，比平时久一些…',
      scheduledTask: {
        creating: '正在创建定时任务',
        created: '已创建定时任务',
        updating: '正在更新定时任务',
        updated: '已更新定时任务',
      },
      summary: ZH_CN_ACTIVITY_SUMMARY,
      active: ZH_CN_ACTIVITY_ACTIVE,
      join: (phrases) => phrases.join('、'),
      joinMerged: (verbs, object) => joinChineseVerbs(verbs, object, '并'),
      expand: (name) => `展开 ${name}`,
      collapse: (name) => `收起 ${name}`,
      moreSteps: (phrases, n) => `${phrases}，以及另外 ${n} 个步骤`,
      blocked: { question: '正在提问', input: '需要你的确认' },
      step: {
        verbs: {
          command: { done: '执行了', running: '正在执行', failed: '未能执行' },
          read: { done: '读取了', running: '正在读取', failed: '未能读取' },
          create: { done: '创建了', running: '正在创建', failed: '未能写入' },
          update: { done: '更新了', running: '正在更新', failed: '未能写入' },
          edit: { done: '修改了', running: '正在修改', failed: '未能修改' },
          search: { done: '搜索了', running: '正在搜索', failed: '未能搜索' },
          fetch: { done: '抓取了', running: '正在抓取', failed: '未能抓取' },
          webSearch: { done: '搜索了网页', running: '正在搜索网页', failed: '未能搜索网页' },
          agent: { done: '运行了子任务', running: '正在运行子任务', failed: '未能运行子任务' },
          skill: { done: '运行了技能', running: '正在运行技能', failed: '未能运行技能' },
          taskAdd: { done: '添加了任务', running: '正在添加任务', failed: '未能添加任务' },
          taskUpdate: { done: '更新了任务', running: '正在更新任务', failed: '未能更新任务' },
          taskComplete: { done: '完成了任务', running: '正在更新任务', failed: '未能更新任务' },
          taskStart: { done: '开始了任务', running: '正在更新任务', failed: '未能更新任务' },
          taskReset: { done: '重置了任务', running: '正在更新任务', failed: '未能更新任务' },
          taskRemove: { done: '删除了任务', running: '正在删除任务', failed: '未能删除任务' },
          taskGet: { done: '读取了任务', running: '正在读取任务', failed: '未能读取任务' },
          taskList: { done: '列出了任务', running: '正在列出任务', failed: '未能列出任务' },
          taskStop: { done: '停止了任务', running: '正在停止任务', failed: '未能停止任务' },
          ask: { done: '提问了', running: '正在提问', failed: '未能提问' },
          share: { done: '分享了', running: '正在分享', failed: '未能分享' },
          message: { done: '发送了消息', running: '正在发送消息', failed: '未能发送消息' },
          toolSearch: { done: '加载了工具', running: '正在加载工具', failed: '未能加载工具' },
          tool: { done: '使用了', running: '正在使用', failed: '未能使用' },
          memorySearch: { done: '搜索了记忆', running: '正在搜索记忆', failed: '未能搜索记忆' },
          memorySave: { done: '保存了', running: '正在保存', failed: '未能保存' },
          memoryUpdate: { done: '更新了', running: '正在更新', failed: '未能更新' },
          memoryDelete: { done: '删除了', running: '正在删除', failed: '未能删除' },
        },
        aCommand: '命令',
        questions: (n) => `${n} 个问题`,
        files: (n) => `${n} 个文件`,
        failed: '失败',
      },
      task: {
        creating: '正在创建任务',
        created: '已创建任务',
        updating: '正在更新任务',
        updated: '已更新任务',
        fetching: (taskId) => (taskId ? `正在读取任务 #${taskId}` : '正在读取任务详情'),
        fetched: (taskId) => (taskId ? `已读取任务 #${taskId}` : '已读取任务详情'),
        listing: '正在列出任务',
        listed: '已列出任务',
        attempted: {
          create: '创建任务',
          update: '更新任务',
          fetch: (taskId) => (taskId ? `读取任务 #${taskId}` : '读取任务详情'),
          list: '列出任务',
        },
      },
      memory: {
        searching: '正在搜索记忆',
        searched: '搜索了记忆',
        reading: (name) => (name ? `正在读取 ${name}` : '正在读取记忆'),
        read: (name) => (name ? `读取了 ${name}` : '读取了记忆'),
        saving: (name) => (name ? `正在保存 ${name}` : '正在保存记忆'),
        saved: (name) => (name ? `保存了 ${name}` : '保存了记忆'),
        updating: (name) => (name ? `正在更新 ${name}` : '正在更新记忆'),
        updated: (name) => (name ? `更新了 ${name}` : '更新了记忆'),
        deleting: (name) => (name ? `正在删除 ${name}` : '正在删除记忆'),
        deleted: (name) => (name ? `删除了 ${name}` : '删除了记忆'),
        files: (count) => `${count} 个文件`,
        merging: '合并中…',
        removed: '删除',
        added: '新增',
        attempted: {
          search: '搜索记忆',
          read: (name) => (name ? `读取 ${name}` : '读取记忆'),
          save: (name) => (name ? `保存 ${name}` : '保存记忆'),
          update: (name) => (name ? `更新 ${name}` : '更新记忆'),
          delete: (name) => (name ? `删除 ${name}` : '删除记忆'),
        },
      },
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
    delivery: {
      filesLabel: '发来的文件',
      openFile: (name) => `在文件面板中打开 ${name}`,
      empty: '这次没有发来文件。',
      kind: {
        skill: '技能',
        presentation: '演示文稿',
        spreadsheet: '电子表格',
        document: '文档',
        code: '代码',
        diagram: '图表',
        image: '图片',
        audio: '音频',
        file: '文件',
      },
      showIn: {
        darwin: '在访达中显示',
        win32: '在文件资源管理器中显示',
        linux: '在文件管理器中显示',
      },
      openFailed: '打不开这个文件',
      openOutsideWorkspace: '这个文件不在当前项目里，只能在文件面板中查看。',
    },
    search: {
      matchesLabel: '匹配结果',
      filesLabel: '匹配到的文件',
      openPath: (path) => `在文件面板中打开 ${path}`,
      occurrences: (count) => `${count} 处`,
      noMatches: '没有匹配的内容。',
      noFiles: '没有匹配的文件。',
      omitted: (count) => `还有 ${count} 条未显示`,
      omittedUnknown: '结果已截断，还有内容未显示',
    },
    inheritedRun: { elsewhere: '在其他会话中运行', lost: '已失去跟踪' },
    sandbox: {
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
      transcriptLoadFailed: '消息加载失败',
      transcriptLoadFailedDetail: '没有读到这个任务的对话记录。可以重试，或稍后再打开。',
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
    },
    taskFinished: {
      completed: ({ title }) => `背景任務「${title}」已完成`,
      failed: ({ title, detail }) => `背景任務「${title}」失敗${detail ? `（${detail}）` : ''}`,
      killed: ({ title }) => `背景任務「${title}」已停止`,
    },
    agentFinished: {
      completed: ({ title }) => `子助手「${title}」已完成`,
      failed: ({ title, detail }) => `子助手「${title}」失敗${detail ? `（${detail}）` : ''}`,
      killed: ({ title }) => `子助手「${title}」已停止`,
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
      noAnswer: '未回答',
      thinkingOnly: '思考過程',
      thinkingActive: '正在思考…',
      writing: '正在撰寫…',
      streamUnsteady: '仍在處理，比平時久一些…',
      scheduledTask: {
        creating: '正在建立排程任務',
        created: '已建立排程任務',
        updating: '正在更新排程任務',
        updated: '已更新排程任務',
      },
      summary: ZH_TW_ACTIVITY_SUMMARY,
      active: ZH_TW_ACTIVITY_ACTIVE,
      join: (phrases) => phrases.join('、'),
      joinMerged: (verbs, object) => joinChineseVerbs(verbs, object, '並'),
      expand: (name) => `展開 ${name}`,
      collapse: (name) => `收合 ${name}`,
      moreSteps: (phrases, n) => `${phrases}，以及另外 ${n} 個步驟`,
      blocked: { question: '正在提問', input: '需要你的確認' },
      step: {
        verbs: {
          command: { done: '執行了', running: '正在執行', failed: '未能執行' },
          read: { done: '讀取了', running: '正在讀取', failed: '未能讀取' },
          create: { done: '建立了', running: '正在建立', failed: '未能寫入' },
          update: { done: '更新了', running: '正在更新', failed: '未能寫入' },
          edit: { done: '修改了', running: '正在修改', failed: '未能修改' },
          search: { done: '搜尋了', running: '正在搜尋', failed: '未能搜尋' },
          fetch: { done: '擷取了', running: '正在擷取', failed: '未能擷取' },
          webSearch: { done: '搜尋了網頁', running: '正在搜尋網頁', failed: '未能搜尋網頁' },
          agent: { done: '執行了子任務', running: '正在執行子任務', failed: '未能執行子任務' },
          skill: { done: '執行了技能', running: '正在執行技能', failed: '未能執行技能' },
          taskAdd: { done: '新增了任務', running: '正在新增任務', failed: '未能新增任務' },
          taskUpdate: { done: '更新了任務', running: '正在更新任務', failed: '未能更新任務' },
          taskComplete: { done: '完成了任務', running: '正在更新任務', failed: '未能更新任務' },
          taskStart: { done: '開始了任務', running: '正在更新任務', failed: '未能更新任務' },
          taskReset: { done: '重設了任務', running: '正在更新任務', failed: '未能更新任務' },
          taskRemove: { done: '刪除了任務', running: '正在刪除任務', failed: '未能刪除任務' },
          taskGet: { done: '讀取了任務', running: '正在讀取任務', failed: '未能讀取任務' },
          taskList: { done: '列出了任務', running: '正在列出任務', failed: '未能列出任務' },
          taskStop: { done: '停止了任務', running: '正在停止任務', failed: '未能停止任務' },
          ask: { done: '提問了', running: '正在提問', failed: '未能提問' },
          share: { done: '分享了', running: '正在分享', failed: '未能分享' },
          message: { done: '傳送了訊息', running: '正在傳送訊息', failed: '未能傳送訊息' },
          toolSearch: { done: '載入了工具', running: '正在載入工具', failed: '未能載入工具' },
          tool: { done: '使用了', running: '正在使用', failed: '未能使用' },
          memorySearch: { done: '搜尋了記憶', running: '正在搜尋記憶', failed: '未能搜尋記憶' },
          memorySave: { done: '儲存了', running: '正在儲存', failed: '未能儲存' },
          memoryUpdate: { done: '更新了', running: '正在更新', failed: '未能更新' },
          memoryDelete: { done: '刪除了', running: '正在刪除', failed: '未能刪除' },
        },
        aCommand: '指令',
        questions: (n) => `${n} 個問題`,
        files: (n) => `${n} 個檔案`,
        failed: '失敗',
      },
      task: {
        creating: '正在建立任務',
        created: '已建立任務',
        updating: '正在更新任務',
        updated: '已更新任務',
        fetching: (taskId) => (taskId ? `正在讀取任務 #${taskId}` : '正在讀取任務詳情'),
        fetched: (taskId) => (taskId ? `已讀取任務 #${taskId}` : '已讀取任務詳情'),
        listing: '正在列出任務',
        listed: '已列出任務',
        attempted: {
          create: '建立任務',
          update: '更新任務',
          fetch: (taskId) => (taskId ? `讀取任務 #${taskId}` : '讀取任務詳情'),
          list: '列出任務',
        },
      },
      memory: {
        searching: '正在搜尋記憶',
        searched: '搜尋了記憶',
        reading: (name) => (name ? `正在讀取 ${name}` : '正在讀取記憶'),
        read: (name) => (name ? `讀取了 ${name}` : '讀取了記憶'),
        saving: (name) => (name ? `正在儲存 ${name}` : '正在儲存記憶'),
        saved: (name) => (name ? `儲存了 ${name}` : '儲存了記憶'),
        updating: (name) => (name ? `正在更新 ${name}` : '正在更新記憶'),
        updated: (name) => (name ? `更新了 ${name}` : '更新了記憶'),
        deleting: (name) => (name ? `正在刪除 ${name}` : '正在刪除記憶'),
        deleted: (name) => (name ? `刪除了 ${name}` : '刪除了記憶'),
        files: (count) => `${count} 個檔案`,
        merging: '合併中…',
        removed: '刪除',
        added: '新增',
        attempted: {
          search: '搜尋記憶',
          read: (name) => (name ? `讀取 ${name}` : '讀取記憶'),
          save: (name) => (name ? `儲存 ${name}` : '儲存記憶'),
          update: (name) => (name ? `更新 ${name}` : '更新記憶'),
          delete: (name) => (name ? `刪除 ${name}` : '刪除記憶'),
        },
      },
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
    delivery: {
      filesLabel: '傳來的檔案',
      openFile: (name) => `在檔案面板中開啟 ${name}`,
      empty: '這次沒有傳來檔案。',
      kind: {
        skill: '技能',
        presentation: '簡報',
        spreadsheet: '試算表',
        document: '文件',
        code: '程式碼',
        diagram: '圖表',
        image: '圖片',
        audio: '音訊',
        file: '檔案',
      },
      showIn: {
        darwin: '在 Finder 中顯示',
        win32: '在檔案總管中顯示',
        linux: '在檔案管理器中顯示',
      },
      openFailed: '開不了這個檔案',
      openOutsideWorkspace: '這個檔案不在目前專案內，只能在檔案面板中檢視。',
    },
    search: {
      matchesLabel: '符合的結果',
      filesLabel: '符合的檔案',
      openPath: (path) => `在檔案面板中開啟 ${path}`,
      occurrences: (count) => `${count} 處`,
      noMatches: '沒有符合的內容。',
      noFiles: '沒有符合的檔案。',
      omitted: (count) => `還有 ${count} 條未顯示`,
      omittedUnknown: '結果已截斷，還有內容未顯示',
    },
    inheritedRun: { elsewhere: '在其他工作階段中執行', lost: '已失去追蹤' },
    sandbox: {
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
      transcriptLoadFailed: '訊息載入失敗',
      transcriptLoadFailedDetail: '沒有讀到這個任務的對話記錄。可以重試，或稍後再開啟。',
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
    },
    taskFinished: {
      completed: ({ title }) => `Background task finished: ${title}`,
      failed: ({ title, detail }) =>
        `Background task failed: ${title}${detail ? ` (${detail})` : ''}`,
      killed: ({ title }) => `Background task stopped: ${title}`,
    },
    agentFinished: {
      completed: ({ title }) => `Agent finished: ${title}`,
      failed: ({ title, detail }) => `Agent failed: ${title}${detail ? ` (${detail})` : ''}`,
      killed: ({ title }) => `Agent stopped: ${title}`,
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
      noAnswer: 'No answer',
      thinkingOnly: 'Thought process',
      thinkingActive: 'Thinking…',
      writing: 'Writing…',
      streamUnsteady: 'Still working — taking longer than usual…',
      scheduledTask: {
        creating: 'Creating scheduled task',
        created: 'Created scheduled task',
        updating: 'Updating scheduled task',
        updated: 'Updated scheduled task',
      },
      summary: EN_ACTIVITY_SUMMARY,
      active: EN_ACTIVITY_ACTIVE,
      join: joinEnglishPhrases,
      joinMerged: joinEnglishVerbs,
      expand: (name) => `Expand ${name}`,
      collapse: (name) => `Collapse ${name}`,
      moreSteps: (phrases, n) => `${phrases}, and ${n} more ${n === 1 ? 'step' : 'steps'}`,
      blocked: { question: 'Asking a question', input: 'Needs your input' },
      step: {
        verbs: {
          command: { done: 'Ran', running: 'Running', failed: 'Failed to run' },
          read: { done: 'Read', running: 'Reading', failed: 'Failed to read' },
          create: { done: 'Created', running: 'Creating', failed: 'Failed to write' },
          update: { done: 'Updated', running: 'Updating', failed: 'Failed to write' },
          edit: { done: 'Edited', running: 'Editing', failed: 'Failed to edit' },
          search: { done: 'Searched', running: 'Searching', failed: 'Failed to search' },
          fetch: { done: 'Fetched', running: 'Fetching', failed: 'Failed to fetch' },
          webSearch: {
            done: 'Searched web',
            running: 'Searching web',
            failed: 'Failed to search web',
          },
          agent: { done: 'Ran agent', running: 'Running agent', failed: 'Failed to run agent' },
          skill: { done: 'Ran skill', running: 'Running skill', failed: 'Failed to run skill' },
          taskAdd: { done: 'Added task', running: 'Adding task', failed: 'Failed to add task' },
          taskUpdate: {
            done: 'Updated task',
            running: 'Updating task',
            failed: 'Failed to update task',
          },
          taskComplete: {
            done: 'Completed task',
            running: 'Updating task',
            failed: 'Failed to update task',
          },
          taskStart: {
            done: 'Started task',
            running: 'Updating task',
            failed: 'Failed to update task',
          },
          taskReset: {
            done: 'Reset task',
            running: 'Updating task',
            failed: 'Failed to update task',
          },
          taskRemove: {
            done: 'Removed task',
            running: 'Removing task',
            failed: 'Failed to remove task',
          },
          taskGet: { done: 'Read task', running: 'Reading task', failed: 'Failed to read task' },
          taskList: {
            done: 'Listed tasks',
            running: 'Listing tasks',
            failed: 'Failed to list tasks',
          },
          taskStop: {
            done: 'Stopped task',
            running: 'Stopping task',
            failed: 'Failed to stop task',
          },
          ask: { done: 'Asked', running: 'Asking', failed: 'Failed to ask' },
          share: { done: 'Shared', running: 'Sharing', failed: 'Failed to share' },
          message: {
            done: 'Sent message',
            running: 'Sending message',
            failed: 'Failed to send message',
          },
          toolSearch: {
            done: 'Loaded tools',
            running: 'Loading tools',
            failed: 'Failed to load tools',
          },
          tool: { done: 'Used', running: 'Using', failed: 'Failed to use' },
          memorySearch: {
            done: 'Searched memory',
            running: 'Searching memory',
            failed: 'Failed to search memory',
          },
          memorySave: { done: 'Saved', running: 'Saving', failed: 'Failed to save' },
          memoryUpdate: { done: 'Updated', running: 'Updating', failed: 'Failed to update' },
          memoryDelete: { done: 'Deleted', running: 'Deleting', failed: 'Failed to delete' },
        },
        aCommand: 'a command',
        questions: (n) => `${n} questions`,
        files: (n) => `${n} files`,
        failed: 'Failed',
      },
      task: {
        creating: 'Creating task',
        created: 'Task created',
        updating: 'Updating task',
        updated: 'Task updated',
        fetching: (taskId) => (taskId ? `Fetching task #${taskId}` : 'Fetching task details'),
        fetched: (taskId) => (taskId ? `Fetched task #${taskId}` : 'Fetched task details'),
        listing: 'Listing tasks',
        listed: 'Listed tasks',
        attempted: {
          create: 'Create a task',
          update: 'Update a task',
          fetch: (taskId) => (taskId ? `Fetch task #${taskId}` : 'Fetch task details'),
          list: 'List tasks',
        },
      },
      memory: {
        searching: 'Searching memory',
        searched: 'Searched memory',
        reading: (name) => (name ? `Reading ${name}` : 'Reading memory'),
        read: (name) => (name ? `Read ${name}` : 'Read memory'),
        saving: (name) => (name ? `Saving ${name}` : 'Saving memory'),
        saved: (name) => (name ? `Saved ${name}` : 'Saved memory'),
        updating: (name) => (name ? `Updating ${name}` : 'Updating memory'),
        updated: (name) => (name ? `Updated ${name}` : 'Updated memory'),
        deleting: (name) => (name ? `Deleting ${name}` : 'Deleting memory'),
        deleted: (name) => (name ? `Deleted ${name}` : 'Deleted memory'),
        files: (count) => `${count} file${count === 1 ? '' : 's'}`,
        merging: 'merging…',
        removed: 'Removed',
        added: 'Added',
        attempted: {
          search: 'Search memory',
          read: (name) => (name ? `Read ${name}` : 'Read memory'),
          save: (name) => (name ? `Save ${name}` : 'Save memory'),
          update: (name) => (name ? `Update ${name}` : 'Update memory'),
          delete: (name) => (name ? `Delete ${name}` : 'Delete memory'),
        },
      },
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
    delivery: {
      filesLabel: 'Files sent to you',
      openFile: (name) => `Open ${name} in Files`,
      empty: 'No files came with this.',
      kind: {
        skill: 'Skill',
        presentation: 'Presentation',
        spreadsheet: 'Spreadsheet',
        document: 'Document',
        code: 'Code',
        diagram: 'Diagram',
        image: 'Image',
        audio: 'Audio',
        file: 'File',
      },
      showIn: {
        darwin: 'Show in Finder',
        win32: 'Show in Explorer',
        linux: 'Show in file manager',
      },
      openFailed: 'That file would not open',
      openOutsideWorkspace:
        'This file is not in the project, so it can only be viewed in the Files face.',
    },
    search: {
      matchesLabel: 'Matches',
      filesLabel: 'Matching files',
      openPath: (path) => `Open ${path} in Files`,
      occurrences: (count) => (count === 1 ? '1 match' : `${count} matches`),
      noMatches: 'Nothing matched.',
      noFiles: 'No files matched.',
      omitted: (count) => (count === 1 ? '1 more omitted' : `${count} more omitted`),
      omittedUnknown: 'Capped — more results omitted',
    },
    inheritedRun: { elsewhere: 'Running elsewhere', lost: 'Lost track of it' },
    sandbox: {
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
      transcriptLoadFailed: 'Messages failed to load',
      transcriptLoadFailedDetail:
        "This task's conversation could not be read. Try again, or reopen it later.",
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
