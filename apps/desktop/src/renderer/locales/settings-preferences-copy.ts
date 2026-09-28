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
import type { ThemePreference, TranscriptTextSize } from '@maka/core/settings';

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

type OptionCopy = { label: string; help: string };

export type SettingsPreferencesCopy = {
  /** Account › Profile. */
  personalization: {
    saveFailed: string;
    avatar: string;
    avatarRandomize: string;
    avatarReset: string;
    avatarFailed: string;
    fullName: string;
    fullNameFailed: string;
    signInToEdit: string;
    nickname: string;
    nicknamePlaceholder: string;
    nicknameFailed: string;
    preferences: string;
    preferencesHelp: string;
    preferencesPlaceholder: string;
    preferencesSaved: string;
    preferencesFailed: string;
  };
  /**
   * Group titles for the SettingsSection headers. They live in one block
   * rather than beside each control's own copy because they name the GROUP,
   * not a setting — keeping them together is what makes an inconsistent
   * grouping visible when it is edited.
   */
  sections: {
    profile: string;
    appearance: string;
    shell: string;
    notifications: string;
    pets: string;
    petsHelp: string;
  };
  appearance: {
    saveFailed: string;
    theme: string;
    themeOptions: Record<ThemePreference, OptionCopy>;
    appIconDefault: string;
    appIconCustom: string;
    appIconImport: string;
    appIconImporting: string;
    appIconRemove: string;
    appIconImportError: string;
    appIconRemoveFailed: string;
    appIconSelectFailed: string;
    appIconImportFailed: Record<
      | 'too_large'
      | 'too_many_pixels'
      | 'unsupported_format'
      | 'unreadable'
      | 'too_small'
      | 'write_failed',
      string
    >;
    appIconUnavailable: string;
    appIcon: string;
    appIconHelp: string;
    fontSize: {
      transcriptLabel: string;
      transcriptHelp: string;
      /** The three steps of the transcript text size. */
      transcriptSizes: Record<TranscriptTextSize, string>;
      terminalLabel: string;
      terminalHelp: string;
    };
  };
  pets: {
    import: string;
    importing: string;
    loading: string;
    status: string;
    activePet(name: string): string;
    disabled: string;
    disable: string;
    disabling: string;
    empty: string;
    emptyHelp: string;
    selected: string;
    select: string;
    selecting: string;
    remove: string;
    removing: string;
    removeTitle(name: string): string;
    removeDescription: string;
    confirmRemove: string;
    cancel: string;
    loadFailed: string;
    importFailed: string;
    selectFailed: string;
    removeFailed: string;
    importErrors: {
      invalid_directory: string;
      invalid_manifest: string;
      invalid_asset: string;
      already_installed: string;
      read_failed: string;
    };
    selectErrors: {
      invalid_id: string;
      not_found: string;
      read_failed: string;
      write_failed: string;
    };
    removeErrors: {
      invalid_id: string;
      remove_failed: string;
    };
  };
  general: {
    notifications: string;
    notificationsHelp: string;
    notificationsFailed: string;
    workspaceInstructions: string;
    workspaceInstructionsHelp: string;
    workspaceInstructionsFailed: string;
    workHub: string;
    workHubHelp: string;
    workHubFailed: string;
    updateFailed: string;
    defaultPermission: string;
    defaultPermissionHelp: string;
    defaultThinking: string;
    defaultThinkingHelp: string;
    followModelDefault: string;
    saveDefaultThinkingFailed: string;
    saveDefaultPermissionFailed: string;
    shellPreference: string;
    shellPreferenceHelp: string;
    shellAuto: string;
    shellGitBash: string;
    shellExecutable: string;
    shellExecutableHelp: string;
    saveShell: string;
    savingShell: string;
    shellSaved: string;
    saveShellFailed: string;
    shellExecutableRejected: string;
  };
  about: {
    loadFailed: string;
    loading: string;
    unavailable: string;
    copied: string;
    pasteHint: string;
    copyFailed: string;
    clipboardUnavailable: string;
    /** One sentence saying what following this channel means for the user. */
    channelSummaries: Record<'dev' | 'nightly' | 'release', string>;
    supportTitle: string;
    reportIssueHelp: string;
    reportIssueOpen: string;
    copyAction: string;
    copyDiagnostics: string;
    copyHelp: string;
    keyboardShortcuts: string;
    keyboardShortcutsHelp: string;
    keyboardShortcutsOpen: string;
    reportIssueLabel: string;
    checkForUpdates: string;
    checkingForUpdates: string;
    updateIdle: string;
    updateNotAvailable: string;
    /**
     * Phase words, and deliberately without the version. The row's label is
     * one short phrase in every state, so it does not truncate against the
     * button at narrow widths; the version belongs to the line below, which is
     * always there (upstream #5130).
     */
    updateAvailable: string;
    updateDownloading: (percent: number) => string;
    updateVerifying: string;
    updateDownloaded: string;
    updateInstalling: string;
    /** The second line: which version, and what happens next. */
    updateScheduleHint: string;
    updateFetchingHint: (version: string) => string;
    updateDownloadedHint: (version: string) => string;
    updateInstallingHint: (version: string) => string;
    updateFailed: Record<'check' | 'download' | 'install', string>;
    /** Provenance in one line: project, foundation status, licence. */
    openSourceSummary: string;
    sourceCode: string;
    releaseNotes: string;
  };
};

const SETTINGS_PREFERENCES_COPY_BY_LOCALE = {
  'zh-CN': {
    personalization: {
      saveFailed: '保存失败',
      avatar: '头像',
      avatarRandomize: '换一个头像',
      avatarReset: '恢复默认头像',
      avatarFailed: '更新头像失败',
      fullName: '全名',
      fullNameFailed: '保存全名失败',
      signInToEdit: '登录公司账号后可以修改。',
      nickname: '希望怎么称呼你？',
      nicknamePlaceholder: '例如：JK',
      nicknameFailed: '保存称呼失败',
      preferences: '给 Copilot 的指示',
      preferencesHelp: 'Copilot 会在所有对话中记住这些指示，并在安全规则范围内遵循。',
      preferencesPlaceholder: '例如：解释尽量简短，直击要点',
      preferencesSaved: '指示已保存',
      preferencesFailed: '保存指示失败',
    },
    sections: {
      profile: '个人资料',
      appearance: '外观',
      shell: '命令行',
      notifications: '通知',
      pets: '自定义宠物',
      petsHelp: '管理你自己导入的 PetPack。Maka 不预装、也不默认启用任何宠物。',
    },
    appearance: {
      saveFailed: '保存外观设置失败',
      theme: '主题',
      themeOptions: {
        light: { label: '浅色', help: '始终使用浅色界面。' },
        dark: { label: '深色', help: '始终使用深色界面。' },
        auto: { label: '跟随系统', help: '匹配系统当前的浅色或深色偏好。' },
      },
      appIconDefault: '默认图标',
      appIconCustom: '导入的图标',
      appIconImport: '导入图标…',
      appIconImporting: '正在导入…',
      appIconRemove: '删除',
      appIconImportError: '导入图标失败',
      appIconRemoveFailed: '删除图标失败',
      appIconSelectFailed: '切换图标失败',
      appIconImportFailed: {
        too_large: '文件太大，换一张小一点的图片',
        too_many_pixels: '图片尺寸太大，最多 4096×4096',
        unsupported_format: '只支持 PNG 和 JPEG',
        unreadable: '这个文件读不出图像',
        too_small: '图片太小，至少需要 128×128',
        write_failed: '无法保存导入的图标',
      },
      appIconUnavailable: '无法载入应用图标',
      appIcon: '应用图标',
      appIconHelp:
        '程序坞、任务栏和应用切换器里显示的图标，切换后立即生效。自己导入的图标用方形 PNG 最好，四周留约 10% 透明边。',
      fontSize: {
        transcriptLabel: '对话字号',
        transcriptHelp: '对话里消息文字的大小。',
        transcriptSizes: { small: '小', medium: '中', large: '大' },
        terminalLabel: '终端字号',
        terminalHelp: '终端里命令输出和代码的字号。',
      },
    },
    pets: {
      import: '导入 PetPack',
      importing: '正在导入…',
      loading: '正在载入自定义宠物…',
      status: '桌面宠物',
      activePet: (name) => `当前使用：${name}`,
      disabled: '已关闭',
      disable: '关闭宠物',
      disabling: '正在关闭…',
      empty: '还没有导入宠物',
      emptyHelp: '选择一个包含 pet.json 和精灵图的本地文件夹。',
      selected: '正在使用',
      select: '使用',
      selecting: '正在切换…',
      remove: '删除',
      removing: '正在删除…',
      removeTitle: (name) => `删除“${name}”？`,
      removeDescription: '这会删除 Maka 本地保存的该宠物包，且无法撤销。原始文件夹不会受影响。',
      confirmRemove: '删除',
      cancel: '取消',
      loadFailed: '无法载入自定义宠物',
      importFailed: '导入宠物失败',
      selectFailed: '切换宠物失败',
      removeFailed: '删除宠物失败',
      importErrors: {
        invalid_directory: '所选文件夹无效。',
        invalid_manifest: 'pet.json 不符合 maka.pet/v1 格式。',
        invalid_asset: '精灵图缺失、无效或超出限制。',
        already_installed: '已经导入了相同 ID 的宠物。',
        read_failed: '无法读取所选文件夹。',
      },
      selectErrors: {
        invalid_id: '宠物 ID 无效。',
        not_found: '该宠物已不在本地宠物库中。',
        read_failed: '无法读取宠物库。',
        write_failed: '无法保存宠物选择。',
      },
      removeErrors: { invalid_id: '宠物 ID 无效。', remove_failed: '无法删除本地宠物包。' },
    },
    general: {
      notifications: '回复完成',
      notificationsHelp: '任务跑完、出错或等你回答时，发系统通知提醒你，适合耗时较长的任务。',
      notificationsFailed: '通知设置切换失败',
      workspaceInstructions: '读取项目里的指令文件',
      workspaceInstructionsHelp:
        '项目里有 AGENTS.md、CLAUDE.md 或 GEMINI.md 时，自动照着里面的要求做。文件还在各自的项目里维护。',
      workspaceInstructionsFailed: '项目指令设置切换失败',
      workHub: '启用 WorkHub',
      workHubHelp: 'WorkHub 目前仍不可用。此开关仅供开发测试，开启后也不能保证正常使用。',
      workHubFailed: 'WorkHub 设置切换失败',
      updateFailed: '设置未生效，请稍后重试。',
      defaultPermission: '默认权限模式',
      defaultPermissionHelp: '新任务默认使用的权限模式；可在任务内随时切换。',
      saveDefaultPermissionFailed: '保存默认权限模式失败',
      defaultThinking: '默认思考级别',
      defaultThinkingHelp: '新任务的思考级别；当前模型不支持所选级别时用模型默认。',
      followModelDefault: '跟随模型默认',
      saveDefaultThinkingFailed: '保存默认思考级别失败',
      shellPreference: 'Bash 工具 shell',
      shellPreferenceHelp:
        '自动模式保持 Windows 的 PowerShell 优先规则；Git Bash 是仅对当前 Runtime Host 生效的显式覆盖。',
      shellAuto: '自动（推荐）',
      shellGitBash: 'Git Bash',
      shellExecutable: 'Git Bash 可执行文件',
      shellExecutableHelp:
        '填写 Runtime Host 所在 Windows 机器上 bash.exe 的绝对路径。也支持该机器上的旧版 System32 WSL Bash；保存时会验证 GNU Bash。',
      saveShell: '保存 shell 设置',
      savingShell: '正在保存…',
      shellSaved: '已保存',
      saveShellFailed: '保存 shell 设置失败',
      shellExecutableRejected:
        '当前 Runtime Host 无法把该路径作为 GNU Bash 运行。请检查 Host 是否为 Windows、路径是否存在，并确认文件名为 bash.exe。',
    },
    about: {
      loadFailed: '载入关于信息失败',
      loading: '正在加载关于页',
      unavailable: '无法载入关于信息',
      copied: '已复制诊断信息',
      pasteHint: '检查内容后，可直接粘贴到问题报告',
      copyFailed: '复制失败',
      clipboardUnavailable: '剪贴板不可用或被系统拒绝。',
      channelSummaries: {
        dev: '本地开发构建，不检查更新。',
        nightly: '每日构建的预发布版，自动更新到最新 nightly，会覆盖正式版安装。',
        release: '正式发布版，自动接收稳定更新。',
      },
      supportTitle: '支持',
      copyDiagnostics: '复制诊断信息',
      copyAction: '复制',
      copyHelp:
        '复制版本、平台、隐藏主目录后的工作区路径与近期脱敏日志；仅写入剪贴板，不会自动上传。',
      reportIssueLabel: '报告问题',
      reportIssueHelp: '带上诊断信息去 GitHub Issues，回复更快。',
      reportIssueOpen: '打开',
      keyboardShortcuts: '键盘快捷键',
      keyboardShortcutsHelp: 'Maka 支持的全部快捷键一览。',
      keyboardShortcutsOpen: '查看',
      checkForUpdates: '检查更新',
      checkingForUpdates: '正在检查更新…',
      updateIdle: '尚未检查更新',
      updateNotAvailable: '已是最新版本',
      updateAvailable: '发现新版本',
      updateDownloading: (percent) => `正在下载（${percent}%）`,
      updateVerifying: '正在验证发布来源',
      updateDownloaded: '新版本已下载',
      updateInstalling: '正在安装',
      updateScheduleHint: 'Maka 会定期在后台检查。',
      updateFetchingHint: (version) => `v${version}，完成后可在这里重启安装。`,
      updateDownloadedHint: (version) => `v${version}，重启 Maka 即可完成安装。`,
      updateInstallingHint: (version) => `v${version}，请稍候。`,
      updateFailed: { check: '检查更新失败', download: '下载更新失败', install: '安装更新失败' },
      openSourceSummary: 'Apache Maka (incubating) · Apache License 2.0',
      sourceCode: '源码',
      releaseNotes: '发行说明',
    },
  },
  'zh-TW': {
    personalization: {
      saveFailed: '儲存失敗',
      avatar: '頭像',
      avatarRandomize: '換一個頭像',
      avatarReset: '恢復預設頭像',
      avatarFailed: '更新頭像失敗',
      fullName: '全名',
      fullNameFailed: '儲存全名失敗',
      signInToEdit: '登入公司帳號後可以修改。',
      nickname: '希望怎麼稱呼你？',
      nicknamePlaceholder: '例如：JK',
      nicknameFailed: '儲存稱呼失敗',
      preferences: '給 Copilot 的指示',
      preferencesHelp: 'Copilot 會在所有對話中記住這些指示，並在安全規則範圍內遵循。',
      preferencesPlaceholder: '例如：解釋盡量簡短，直擊重點',
      preferencesSaved: '指示已儲存',
      preferencesFailed: '儲存指示失敗',
    },
    sections: {
      profile: '個人資料',
      appearance: '外觀',
      shell: '命令列',
      notifications: '通知',
      pets: '自訂寵物',
      petsHelp: '管理你自己匯入的 PetPack。Maka 不預裝、也不預設啟用任何寵物。',
    },
    appearance: {
      saveFailed: '儲存外觀設定失敗',
      theme: '主題',
      themeOptions: {
        light: { label: '淺色', help: '始終使用淺色介面。' },
        dark: { label: '深色', help: '始終使用深色介面。' },
        auto: { label: '跟隨系統', help: '符合系統目前的淺色或深色偏好。' },
      },
      appIconDefault: '預設圖示',
      appIconCustom: '匯入的圖示',
      appIconImport: '匯入圖示…',
      appIconImporting: '正在匯入…',
      appIconRemove: '刪除',
      appIconImportError: '匯入圖示失敗',
      appIconRemoveFailed: '刪除圖示失敗',
      appIconSelectFailed: '切換圖示失敗',
      appIconImportFailed: {
        too_large: '檔案太大，換一張小一點的圖片',
        too_many_pixels: '圖片尺寸太大，最多 4096×4096',
        unsupported_format: '只支援 PNG 和 JPEG',
        unreadable: '這個檔案讀不出影像',
        too_small: '圖片太小，至少需要 128×128',
        write_failed: '無法儲存匯入的圖示',
      },
      appIconUnavailable: '無法載入應用圖示',
      appIcon: '應用圖示',
      appIconHelp:
        'Dock、工作列和應用程式切換器裡顯示的圖示，切換後立即生效。自己匯入的圖示用方形 PNG 最好，四周留約 10% 透明邊。',
      fontSize: {
        transcriptLabel: '對話字型大小',
        transcriptHelp: '對話中訊息文字的大小。',
        transcriptSizes: { small: '小', medium: '中', large: '大' },
        terminalLabel: '終端機字型大小',
        terminalHelp: '終端機裡命令輸出和程式碼的字型大小。',
      },
    },
    pets: {
      import: '匯入 PetPack',
      importing: '正在匯入…',
      loading: '正在載入自訂寵物…',
      status: '桌面寵物',
      activePet: (name) => `目前使用：${name}`,
      disabled: '已關閉',
      disable: '關閉寵物',
      disabling: '正在關閉…',
      empty: '還沒有匯入寵物',
      emptyHelp: '選擇一個包含 pet.json 和精靈圖的本地資料夾。',
      selected: '正在使用',
      select: '使用',
      selecting: '正在切換…',
      remove: '刪除',
      removing: '正在刪除…',
      removeTitle: (name) => `刪除“${name}”？`,
      removeDescription: '這會刪除 Maka 本地儲存的該寵物包，且無法撤銷。原始資料夾不會受影響。',
      confirmRemove: '刪除',
      cancel: '取消',
      loadFailed: '無法載入自訂寵物',
      importFailed: '匯入寵物失敗',
      selectFailed: '切換寵物失敗',
      removeFailed: '刪除寵物失敗',
      importErrors: {
        invalid_directory: '所選資料夾無效。',
        invalid_manifest: 'pet.json 不符合 maka.pet/v1 格式。',
        invalid_asset: '精靈圖缺失、無效或超出限制。',
        already_installed: '已經匯入了相同 ID 的寵物。',
        read_failed: '無法讀取所選資料夾。',
      },
      selectErrors: {
        invalid_id: '寵物 ID 無效。',
        not_found: '該寵物已不在本地寵物庫中。',
        read_failed: '無法讀取寵物庫。',
        write_failed: '無法儲存寵物選擇。',
      },
      removeErrors: { invalid_id: '寵物 ID 無效。', remove_failed: '無法刪除本機寵物包。' },
    },
    general: {
      notifications: '回覆完成',
      notificationsHelp: '任務跑完、出錯或等你回答時，傳送系統通知提醒你，適合耗時較長的任務。',
      notificationsFailed: '通知設定切換失敗',
      workspaceInstructions: '讀取專案裡的指令檔',
      workspaceInstructionsHelp:
        '專案裡有 AGENTS.md、CLAUDE.md 或 GEMINI.md 時，自動照著裡面的要求做。檔案還在各自的專案裡維護。',
      workspaceInstructionsFailed: '專案指令設定切換失敗',
      workHub: '啟用 WorkHub',
      workHubHelp: '在一個入口檢視已有工作，並將新輸入保守地送往普通任務。',
      workHubFailed: 'WorkHub 設定切換失敗',
      updateFailed: '設定未生效，請稍後重試。',
      defaultPermission: '預設權限模式',
      defaultPermissionHelp: '新任務預設使用的權限模式；可在任務內隨時切換。',
      saveDefaultPermissionFailed: '儲存預設權限模式失敗',
      defaultThinking: '預設思考級別',
      defaultThinkingHelp: '新任務的思考級別；目前模型不支援所選級別時用模型預設。',
      followModelDefault: '跟隨模型預設',
      saveDefaultThinkingFailed: '儲存預設思考級別失敗',
      shellPreference: 'Bash 工具 shell',
      shellPreferenceHelp:
        '自動模式保持 Windows 的 PowerShell 優先規則；Git Bash 是僅對目前 Runtime Host 生效的顯式覆蓋。',
      shellAuto: '自動（推薦）',
      shellGitBash: 'Git Bash',
      shellExecutable: 'Git Bash 執行檔',
      shellExecutableHelp:
        '填寫 Runtime Host 所在 Windows 機器上 bash.exe 的絕對路徑。也支援該機器上的舊版 System32 WSL Bash；儲存時會驗證 GNU Bash。',
      saveShell: '儲存 shell 設定',
      savingShell: '正在儲存…',
      shellSaved: '已儲存',
      saveShellFailed: '儲存 shell 設定失敗',
      shellExecutableRejected:
        '目前 Runtime Host 無法把該路徑作為 GNU Bash 執行。請檢查 Host 是否為 Windows、路徑是否存在，並確認檔名為 bash.exe。',
    },
    about: {
      loadFailed: '載入關於資訊失敗',
      loading: '正在載入關於頁',
      unavailable: '無法載入關於資訊',
      copied: '已複製診斷資訊',
      pasteHint: '檢查內容後，可直接貼上到問題報告',
      copyFailed: '複製失敗',
      clipboardUnavailable: '剪貼簿不可用或被系統拒絕。',
      supportTitle: '支援',
      copyAction: '複製',
      reportIssueHelp: '帶上診斷資訊去 GitHub Issues，回覆更快。',
      reportIssueOpen: '開啟',
      channelSummaries: {
        dev: '本地開發建構，不檢查更新。',
        nightly: '每日建構的預發佈版，自動更新到最新 nightly，會覆蓋正式版安裝。',
        release: '正式發佈版，自動接收穩定更新。',
      },
      copyDiagnostics: '複製診斷資訊',
      copyHelp:
        '複製版本、平臺、隱藏主目錄後的工作區路徑，以及近期脫敏的 Desktop 與 Runtime Host 記錄；僅寫入剪貼簿，不會自動上傳。',
      keyboardShortcuts: '鍵盤快捷鍵',
      keyboardShortcutsHelp: 'Maka 支援的全部快捷鍵一覽。',
      keyboardShortcutsOpen: '檢視',
      reportIssueLabel: '報告問題',

      checkForUpdates: '檢查更新',
      checkingForUpdates: '正在檢查更新…',
      updateIdle: '尚未檢查更新',
      updateNotAvailable: '已是最新版本',
      updateAvailable: '發現新版本',
      updateDownloading: (percent) => `正在下載（${percent}%）`,
      updateVerifying: '正在驗證發佈來源',
      updateDownloaded: '新版本已下載',
      updateInstalling: '正在安裝',
      updateScheduleHint: 'Maka 會定期在背景檢查。',
      updateFetchingHint: (version) => `v${version}，完成後可在這裡重新啟動安裝。`,
      updateDownloadedHint: (version) => `v${version}，重新啟動 Maka 即可完成安裝。`,
      updateInstallingHint: (version) => `v${version}，請稍候。`,
      updateFailed: { check: '檢查更新失敗', download: '下載更新失敗', install: '安裝更新失敗' },
      openSourceSummary: 'Apache Maka (incubating) · Apache License 2.0',
      sourceCode: '原始碼',
      releaseNotes: '發行說明',
    },
  },
  en: {
    personalization: {
      saveFailed: 'Could not save',
      avatar: 'Avatar',
      avatarRandomize: 'Pick another avatar',
      avatarReset: 'Reset to the default avatar',
      avatarFailed: 'Could not update the avatar',
      fullName: 'Full name',
      fullNameFailed: 'Could not save your full name',
      signInToEdit: 'Sign in to your company account to change this.',
      nickname: 'What should we call you?',
      nicknamePlaceholder: 'For example: JK',
      nicknameFailed: 'Could not save what we call you',
      preferences: 'Instructions for Copilot',
      preferencesHelp: 'Copilot will keep these in mind across chats, within the safety rules.',
      preferencesPlaceholder: 'e.g. keep explanations brief and to the point',
      preferencesSaved: 'Instructions saved',
      preferencesFailed: 'Could not save your instructions',
    },
    sections: {
      profile: 'Profile',
      appearance: 'Appearance',
      shell: 'Command line',
      notifications: 'Notifications',
      pets: 'Custom pets',
      petsHelp:
        'Manage PetPacks you import yourself. Maka does not bundle or enable any pet by default.',
    },
    appearance: {
      saveFailed: 'Could not save appearance settings',
      theme: 'Theme',
      themeOptions: {
        light: { label: 'Light', help: 'Always use the light interface.' },
        dark: { label: 'Dark', help: 'Always use the dark interface.' },
        auto: { label: 'Follow system', help: 'Match the current system appearance.' },
      },
      appIconDefault: 'Default icon',
      appIconCustom: 'Imported icon',
      appIconImport: 'Import icon…',
      appIconImporting: 'Importing…',
      appIconRemove: 'Remove',
      appIconImportError: 'Could not import the icon',
      appIconRemoveFailed: 'Could not remove the icon',
      appIconSelectFailed: 'Could not switch the icon',
      appIconImportFailed: {
        too_large: 'That file is too large; pick a smaller image',
        too_many_pixels: 'That image is too large; 4096×4096 is the maximum',
        unsupported_format: 'Only PNG and JPEG are supported',
        unreadable: 'No image could be read from that file',
        too_small: 'That image is too small; 128×128 is the minimum',
        write_failed: 'Could not store the imported icon',
      },
      appIconUnavailable: 'Could not load the app icons',
      appIcon: 'App icon',
      appIconHelp:
        'The icon shown in the dock, taskbar, and app switcher. Changes apply right away. For an icon of your own, a square PNG with about 10% transparent margin works best.',
      fontSize: {
        transcriptLabel: 'Transcript text size',
        transcriptHelp: 'Size of the conversation transcript text.',
        transcriptSizes: { small: 'Small', medium: 'Medium', large: 'Large' },
        terminalLabel: 'Terminal font size',
        terminalHelp: 'Font size of terminal output and code.',
      },
    },
    pets: {
      import: 'Import PetPack',
      importing: 'Importing…',
      loading: 'Loading custom pets…',
      status: 'Desktop pet',
      activePet: (name) => `Currently using: ${name}`,
      disabled: 'Off',
      disable: 'Turn off pet',
      disabling: 'Turning off…',
      empty: 'No pets imported yet',
      emptyHelp: 'Choose a local folder containing pet.json and a sprite sheet.',
      selected: 'In use',
      select: 'Use',
      selecting: 'Switching…',
      remove: 'Remove',
      removing: 'Removing…',
      removeTitle: (name) => `Remove “${name}”?`,
      removeDescription:
        'This removes Maka’s local copy of the pet pack and cannot be undone. The original folder is not affected.',
      confirmRemove: 'Remove',
      cancel: 'Cancel',
      loadFailed: 'Could not load custom pets',
      importFailed: 'Could not import pet',
      selectFailed: 'Could not switch pet',
      removeFailed: 'Could not remove pet',
      importErrors: {
        invalid_directory: 'The selected folder is invalid.',
        invalid_manifest: 'pet.json does not match the maka.pet/v1 format.',
        invalid_asset: 'The sprite sheet is missing, invalid, or outside the supported limits.',
        already_installed: 'A pet with the same ID is already installed.',
        read_failed: 'The selected folder could not be read.',
      },
      selectErrors: {
        invalid_id: 'The pet ID is invalid.',
        not_found: 'That pet is no longer in the local library.',
        read_failed: 'The pet library could not be read.',
        write_failed: 'The pet selection could not be saved.',
      },
      removeErrors: {
        invalid_id: 'The pet ID is invalid.',
        remove_failed: 'The local pet pack could not be removed.',
      },
    },
    general: {
      notifications: 'Response completions',
      notificationsHelp:
        'Get a system notification when a task finishes, fails, or is waiting on your answer. Most useful for long-running tasks.',
      notificationsFailed: 'Could not change notification settings',
      workspaceInstructions: 'Read project instruction files',
      workspaceInstructionsHelp:
        'When a project has an AGENTS.md, CLAUDE.md or GEMINI.md, follow what it asks. The files stay in their projects.',
      workspaceInstructionsFailed: 'Could not change project instruction settings',
      workHub: 'Enable WorkHub',
      workHubHelp:
        'WorkHub is not available yet. This toggle is for development testing and does not enable a usable feature.',
      workHubFailed: 'Could not change WorkHub setting',
      updateFailed: 'The setting was not applied. Try again later.',
      defaultPermission: 'Default permission mode',
      defaultPermissionHelp:
        'Initial permission mode for new tasks; it can be changed at any time.',
      saveDefaultPermissionFailed: 'Could not save the default permission mode',
      defaultThinking: 'Default thinking level',
      defaultThinkingHelp:
        'Thinking level for new tasks; models that do not offer the chosen level use their own default.',
      followModelDefault: 'Follow model default',
      saveDefaultThinkingFailed: 'Could not save the default thinking level',
      shellPreference: 'Bash tool shell',
      shellPreferenceHelp:
        'Automatic keeps the PowerShell-first Windows default. Git Bash is an explicit override for the current Runtime Host.',
      shellAuto: 'Automatic (recommended)',
      shellGitBash: 'Git Bash',
      shellExecutable: 'Git Bash executable',
      shellExecutableHelp:
        'Enter the absolute path to bash.exe on the Windows machine running the Runtime Host. The legacy System32 WSL Bash shim is also recognized; Maka verifies GNU Bash before saving.',
      saveShell: 'Save shell setting',
      savingShell: 'Saving…',
      shellSaved: 'Saved',
      saveShellFailed: 'Could not save shell setting',
      shellExecutableRejected:
        'The current Runtime Host could not run that path as GNU Bash. Check that the Host runs Windows, the path exists, and the file is named bash.exe.',
    },
    about: {
      loadFailed: 'Could not load About information',
      loading: 'Loading About',
      unavailable: 'About information is unavailable',
      copied: 'Diagnostics copied',
      pasteHint: 'Review the content, then paste it into an issue report',
      copyFailed: 'Copy failed',
      clipboardUnavailable: 'The clipboard is unavailable or access was denied.',
      channelSummaries: {
        dev: 'A local development build. It does not check for updates.',
        nightly:
          'A daily prerelease build. It updates itself to the latest nightly and replaces a release install.',
        release: 'The official release build. It receives stable updates automatically.',
      },
      supportTitle: 'Support',
      copyDiagnostics: 'Copy diagnostics',
      copyAction: 'Copy',
      copyHelp:
        'Copy version, platform, a home-redacted workspace path, and recent redacted logs. The report is written only to the clipboard and is never uploaded automatically.',
      reportIssueLabel: 'Report an issue',
      reportIssueHelp: 'Open a GitHub issue with your diagnostics attached — replies come faster.',
      reportIssueOpen: 'Open',
      keyboardShortcuts: 'Keyboard shortcuts',
      keyboardShortcutsHelp: 'Every shortcut Maka responds to.',
      keyboardShortcutsOpen: 'View',
      checkForUpdates: 'Check for updates',
      checkingForUpdates: 'Checking for updates…',
      updateIdle: 'No update check has run yet',
      updateNotAvailable: 'You are on the latest version',
      updateAvailable: 'Update available',
      updateDownloading: (percent) => `Downloading (${percent}%)`,
      updateVerifying: 'Verifying release provenance',
      updateDownloaded: 'Update downloaded',
      updateInstalling: 'Installing',
      updateScheduleHint: 'Maka checks periodically in the background.',
      updateFetchingHint: (version) => `v${version}; restart from here once it finishes.`,
      updateDownloadedHint: (version) => `v${version}; restart Maka to finish installing.`,
      updateInstallingHint: (version) => `v${version}; this takes a moment.`,
      updateFailed: {
        check: 'Could not check for updates',
        download: 'Could not download the update',
        install: 'Could not install the update',
      },
      openSourceSummary: 'Apache Maka (incubating) · Apache License 2.0',
      sourceCode: 'Source code',
      releaseNotes: 'Release notes',
    },
  },
} satisfies UiCatalog<SettingsPreferencesCopy>;

export function getSettingsPreferencesCopy(locale: UiLocale): SettingsPreferencesCopy {
  return SETTINGS_PREFERENCES_COPY_BY_LOCALE[locale];
}
