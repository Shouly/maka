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

// The generated-avatar colour pairs, lifted verbatim out of `ui/user-avatar`.
//
// These are IDENTITY colours, not theme colours: a seed hashes to one pair and
// must keep hashing to the same pair in both themes, which is exactly what a
// semantic token cannot express. They live here rather than in the component
// because `scripts/check-renderer-architecture.mjs` forbids raw colour
// literals under `src/renderer/components/**` — one deliberate data palette in
// one named module is reviewable; the same literals sprinkled through
// components are the drift the rule exists to stop.
//
// 低饱和暖色对 [底色, 前景]:与页面奶油底同族。首对即 Claude 参照件(米杏/橄榄)。
export const AVATAR_WARM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#E3DACC', '#788C5D'], // 米杏 / 橄榄
  ['#EADDD3', '#A8633E'], // 奶杏 / 陶土
  ['#DDE2E6', '#5B7285'], // 雾灰 / 灰蓝
  ['#E7DCD6', '#A8625D'], // 藕粉 / 赭红
  ['#EAE3CD', '#8F7430'], // 沙金 / 芥末
  ['#E4DEE7', '#7A6586'], // 雾紫 / 灰紫
  ['#E5E0D6', '#6E665A'], // 亚麻 / 灰褐
  ['#DFE5DC', '#5F7A66'], // 浅鼠尾 / 松绿
];

/** FNV-1a 32 位:把种子字符串折成稳定整数(只用于选暖色对) */
export function hashAvatarSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
