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

import type { CSSProperties } from 'react'

interface AnthropiconSpec {
  glyph: string
  size: AnthropiconSize
  weight: number
}

export type AnthropiconSize = 12 | 16 | 18 | 20 | 24 | 32

// Canonical names and codepoints come from the `er.icons` registry shipped in
// Claude's current shared-frame bundle. Keep these names literal: call sites
// choose an icon for their product semantics instead of hiding mismatches
// behind aliases such as "customize" or "viewAll".
export const ANTHROPICON_SPECS = {
  add: { glyph: '\uE001', size: 16, weight: 700 },
  agent: { glyph: '\uE003', size: 20, weight: 433.25 },
  archive: { glyph: '\uE008', size: 20, weight: 433.25 },
  at: { glyph: '\uE0A9', size: 20, weight: 433.25 },
  artifacts: { glyph: '\uE017', size: 20, weight: 433.25 },
  /** 顺时针回转箭头(重试)。E11E 是逆时针版,方向相反,别混用。 */
  arrowClockwise: { glyph: '\uE11D', size: 20, weight: 433.25 },
  arrowCounterClockwise: { glyph: '\uE11E', size: 20, weight: 433.25 },
  /** 裸下箭头。E00A 是圈内版,滚动到底部这类按钮取裸的。 */
  arrowDown: { glyph: '\uE009', size: 20, weight: 433.25 },
  arrowLeft: { glyph: '\uE00C', size: 20, weight: 433.25 },
  arrowOutSquare: { glyph: '\uE00E', size: 20, weight: 433.25 },
  arrowRight: { glyph: '\uE010', size: 20, weight: 433.25 },
  arrowUp: { glyph: '\uE013', size: 20, weight: 433.25 },
  /** 圈内上箭头 —— "有更高的版本/可升级"。E013 是裸上箭头(发送)。 */
  arrowUpCircle: { glyph: '\uE014', size: 20, weight: 433.25 },
  arrowUpRight: { glyph: '\uE015', size: 16, weight: 533.25 },
  attach: { glyph: '\uE019', size: 20, weight: 433.25 },
  book: { glyph: '\uE01D', size: 20, weight: 433.25 },
  /** 摊开的书。E01D(book) 是合起来的那本。 */
  bookOpen: { glyph: '\uE01F', size: 20, weight: 433.25 },
  bookmark: { glyph: '\uE117', size: 20, weight: 433.25 },
  bullhorn: { glyph: '\uE022', size: 20, weight: 433.25 },
  calendar: { glyph: '\uE024', size: 20, weight: 433.25 },
  camera: { glyph: '\uE025', size: 20, weight: 433.25 },
  caretDown: { glyph: '\uE027', size: 12, weight: 577.75 },
  caretRight: { glyph: '\uE02A', size: 12, weight: 577.75 },
  chat: { glyph: '\uE031', size: 16, weight: 533.25 },
  /** chat 的实心版,已选态用。 */
  chatFilled: { glyph: '\uE036', size: 16, weight: 533.25 },
  chatAdd: { glyph: '\uE032', size: 16, weight: 533.25 },
  chats: { glyph: '\uE039', size: 20, weight: 433.25 },
  check: { glyph: '\uE03B', size: 16, weight: 533.25 },
  /** 圈内打勾。E03D 是实心圈版,要描边的取这个。 */
  checkCircle: { glyph: '\uE03C', size: 20, weight: 433.25 },
  checkDouble: { glyph: '\uE03E', size: 16, weight: 533.25 },
  clipboard: { glyph: '\uE041', size: 20, weight: 433.25 },
  clock: { glyph: '\uE043', size: 20, weight: 433.25 },
  search: { glyph: '\uE0D3', size: 16, weight: 533.25 },
  /** 空心爱心 —— 表情反应入口。E126 是爱心+标签的组合,不是纯爱心。 */
  heart: { glyph: '\uE127', size: 20, weight: 433.25 },
  home: { glyph: '\uE08A', size: 16, weight: 700 },
  code: { glyph: '\uE048', size: 16, weight: 533.25 },
  collapse: { glyph: '\uE04D', size: 20, weight: 433.25 },
  terminal: { glyph: '\uE04F', size: 20, weight: 433.25 },
  computer: { glyph: '\uE053', size: 20, weight: 433.25 },
  connectors: { glyph: '\uE055', size: 20, weight: 433.25 },
  copy: { glyph: '\uE056', size: 20, weight: 433.25 },
  cursor: { glyph: '\uE059', size: 20, weight: 433.25 },
  cursorClick: { glyph: '\uE021', size: 20, weight: 433.25 },
  dotsVertical: { glyph: '\uE062', size: 16, weight: 533.25 },
  download: { glyph: '\uE063', size: 20, weight: 433.25 },
  edit: { glyph: '\uE064', size: 20, weight: 433.25 },
  eye: { glyph: '\uE069', size: 20, weight: 433.25 },
  expand: { glyph: '\uE067', size: 20, weight: 433.25 },
  eyeSlash: { glyph: '\uE06A', size: 20, weight: 433.25 },
  /** 思考中 / 思考过程 —— 时间线里 thinking 那一步的图标。 */
  thinking: { glyph: '\uE068', size: 20, weight: 433.25 },
  /** 单个文档。E06F(files) 是一摞。 */
  file: { glyph: '\uE06C', size: 20, weight: 433.25 },
  files: { glyph: '\uE06F', size: 20, weight: 433.25 },
  filter: { glyph: '\uE070', size: 16, weight: 533.25 },
  folder: { glyph: '\uE072', size: 20, weight: 433.25 },
  folderOpen: { glyph: '\uE073', size: 20, weight: 433.25 },
  folderAdd: { glyph: '\uE074', size: 20, weight: 433.25 },
  globe: { glyph: '\uE082', size: 20, weight: 433.25 },
  hand: { glyph: '\uE085', size: 20, weight: 433.25 },
  image: { glyph: '\uE08C', size: 20, weight: 433.25 },
  info: { glyph: '\uE08F', size: 20, weight: 433.25 },
  library: { glyph: '\uE096', size: 20, weight: 433.25 },
  lightning: { glyph: '\uE098', size: 20, weight: 433.25 },
  lightbulb: { glyph: '\uE097', size: 20, weight: 433.25 },
  link: { glyph: '\uE09A', size: 20, weight: 433.25 },
  listBullet: { glyph: '\uE09C', size: 20, weight: 433.25 },
  /** 闭合挂锁。E0A2 是打开的那把。 */
  lock: { glyph: '\uE0A1', size: 20, weight: 433.25 },
  logout: { glyph: '\uE0A4', size: 20, weight: 433.25 },
  memory: { glyph: '\uE0A8', size: 20, weight: 433.25 },
  microphone: { glyph: '\uE0AB', size: 20, weight: 433.25 },
  menu: { glyph: '\uE0AA', size: 20, weight: 433.25 },
  /** 减号。与 add(E001) 成对。 */
  minus: { glyph: '\uE0AE', size: 16, weight: 700 },
  moon: { glyph: '\uE0B0', size: 20, weight: 433.25 },
  note: { glyph: '\uE0B3', size: 20, weight: 433.25 },
  /** 楼宇 —— 部门 / 组织单元。 */
  buildings: { glyph: '\uE0B6', size: 20, weight: 433.25 },
  paperPlane: { glyph: '\uE0BA', size: 16, weight: 533.25 },
  pause: { glyph: '\uE0BB', size: 20, weight: 433.25 },
  play: { glyph: '\uE0C1', size: 20, weight: 433.25 },
  plugin: { glyph: '\uE0C5', size: 20, weight: 433.25 },
  /** 禁止符(圈内斜杠)。取消 / 中止的标准记号 —— 别拿 xCircle 将就,那个语义是「关闭」。 */
  prohibit: { glyph: '\uE0C8', size: 20, weight: 433.25 },
  projects: { glyph: '\uE0C9', size: 20, weight: 433.25 },
  projectsX: { glyph: '\uE0CB', size: 20, weight: 433.25 },
  pullRequest: { glyph: '\uE07F', size: 20, weight: 433.25 },
  /** 圈内问号 —— 当前会话有题在等你回答。与 checkCircle / warningCircle /
   *  xCircle 同属圈系,放在会话行首那个槽位里与它们同一档。 */
  questionCircle: { glyph: '\uE088', size: 20, weight: 433.25 },
  /** 回车折返箭头 —— 回复某条消息。 */
  reply: { glyph: '\uE00F', size: 20, weight: 433.25 },
  scale: { glyph: '\uE128', size: 20, weight: 433.25 },
  scroll: { glyph: '\uE0D2', size: 20, weight: 433.25 },
  settings: { glyph: '\uE0D6', size: 20, weight: 433.25 },
  shapes: { glyph: '\uE0D7', size: 20, weight: 433.25 },
  share: { glyph: '\uE0D8', size: 20, weight: 433.25 },
  sidebar: { glyph: '\uE0DD', size: 16, weight: 433.25 },
  /** 带声波的喇叭 —— 音频文件。字体里没有音符字形。 */
  sound: { glyph: '\uE0E4', size: 20, weight: 433.25 },
  spinner: { glyph: '\uE0E5', size: 20, weight: 433.25 },
  /** 带表头行的网格 —— 表格文件。E0FF 是无表头的行堆叠,不是同一个。 */
  spreadsheet: { glyph: '\uE0E6', size: 20, weight: 433.25 },
  star: { glyph: '\uE0E7', size: 20, weight: 433.25 },
  starFilled: { glyph: '\uE0E8', size: 20, weight: 433.25 },
  /** 实心方块。E0EA 是描边方、E0EB 中心带点,停止录制取实心的。 */
  stop: { glyph: '\uE0EC', size: 20, weight: 433.25 },
  /** 圆内实心方块。「停止生成」那颗键用这个;裸方块(stop)是另一档。 */
  stopCircle: { glyph: '\uE0EB', size: 20, weight: 433.25 },
  sun: { glyph: '\uE0EE', size: 20, weight: 433.25 },
  sunHorizon: { glyph: '\uE0F0', size: 20, weight: 433.25 },
  tasks: { glyph: '\uE0F1', size: 20, weight: 433.25 },
  team: { glyph: '\uE0F2', size: 16, weight: 533.25 },
  /** 点赞 / 点踩,各带一个实心版(已选态用实心,与 star/starFilled 同一手法)。 */
  thumbUp: { glyph: '\uE0FB', size: 20, weight: 433.25 },
  thumbUpFilled: { glyph: '\uE0FC', size: 20, weight: 433.25 },
  thumbDown: { glyph: '\uE0F9', size: 20, weight: 433.25 },
  thumbDownFilled: { glyph: '\uE0FA', size: 20, weight: 433.25 },
  tool: { glyph: '\uE100', size: 20, weight: 433.25 },
  toggles: { glyph: '\uE0FE', size: 20, weight: 433.25 },
  timer: { glyph: '\uE0FD', size: 20, weight: 433.25 },
  trash: { glyph: '\uE101', size: 20, weight: 433.25 },
  upload: { glyph: '\uE103', size: 20, weight: 433.25 },
  user: { glyph: '\uE105', size: 20, weight: 433.25 },
  /** 柱状图。同一组里 E030 是折线图(chartLine)。 */
  usage: { glyph: '\uE02F', size: 20, weight: 433.25 },
  chartLine: { glyph: '\uE030', size: 20, weight: 433.25 },
  users: { glyph: '\uE106', size: 20, weight: 433.25 },
  /** 声波。录音 / 转录场景。 */
  waveform: { glyph: '\uE108', size: 20, weight: 433.25 },
  warning: { glyph: '\uE109', size: 20, weight: 433.25 },
  wrench: { glyph: '\uE10D', size: 20, weight: 433.25 },
  /** 圈内感叹号。E109(warning) 是三角版 —— 终态节点那一组统一用圈系。 */
  warningCircle: { glyph: '\uE10A', size: 20, weight: 433.25 },
  x: { glyph: '\uE10F', size: 20, weight: 433.25 },
  /** 圈内叉。取消/中止态,与 checkCircle、warningCircle 成一组。 */
  xCircle: { glyph: '\uE110', size: 20, weight: 433.25 },
} as const satisfies Record<string, AnthropiconSpec>

export type AnthropiconName = keyof typeof ANTHROPICON_SPECS

export interface AnthropiconProps {
  name: AnthropiconName
  className?: string
  size?: AnthropiconSize
  weight?: number
}

// 尺寸越大字重越小(16→20 每 1px 减 25),用来抵消"字号变大 = 描边变粗",
// 让视觉线宽在各尺寸上保持恒定。
//
// 24/32 取 400 是**轴的下限**,不是外推值:@font-face 声明 `font-weight: 400 700`,
// 而线性外推到 32px 会得到 133,早已越界。所以 20px 以上无法再靠减字重补偿,
// 大图标的描边会比小图标略粗 —— 这是字体本身的边界。Claude 自己的界面里
// 图标只用到 12/16/20 三档,没有更大的。
const REGULAR_WEIGHT_BY_SIZE: Record<AnthropiconSize, number> = {
  12: 577.75,
  16: 533.25,
  18: 483.25,
  20: 433.25,
  24: 400,
  32: 400,
}

/**
 * Claude's variable icon-font glyph with its live size and weight locked to the
 * semantic name. Icons are always decorative; the containing control owns the
 * accessible label.
 */
export function Anthropicon({ name, className, size: sizeOverride, weight: weightOverride }: AnthropiconProps) {
  const spec = ANTHROPICON_SPECS[name]
  const size = sizeOverride ?? spec.size
  const weight = weightOverride ?? (
    size === spec.size ? spec.weight : REGULAR_WEIGHT_BY_SIZE[size]
  )
  const { glyph } = spec
  const dimension = `${size}px`
  const style: CSSProperties = {
    alignItems: 'center',
    display: 'inline-flex',
    flex: '0 0 auto',
    fontFamily: "'Anthropicons-Variable'",
    fontFeatureSettings: "'liga' 0, 'clig' 0, 'dlig' 0",
    fontSize: dimension,
    fontStyle: 'normal',
    fontSynthesis: 'none',
    fontVariantLigatures: 'none',
    fontVariationSettings: `'ANIM' 0, 'ANM2' 0, 'opsz' ${size}, 'wght' ${weight}`,
    fontWeight: weight,
    height: dimension,
    justifyContent: 'center',
    letterSpacing: 'normal',
    lineHeight: 1,
    minWidth: dimension,
    textTransform: 'none',
    userSelect: 'none',
    width: dimension,
  }

  return (
    <span
      aria-hidden="true"
      className={className}
      data-anthropicon={name}
      style={style}
    >
      {glyph}
    </span>
  )
}
