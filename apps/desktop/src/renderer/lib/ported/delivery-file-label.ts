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

// What a delivered file is CALLED, what KIND it is called, and which glyph
// stands for it.
//
// Ported from relx's `sandbox-file-utils` and `file-utils`, which keep these as
// THREE separate questions and answer each from the extension:
//
//   the title  — the filename made readable (`formatFileDisplayName`)
//   the kind   — a word for the reader (`getFileTypeDisplay`)
//   the glyph  — a bucket of extensions (`FILE_ICON_BUCKETS`)
//
// They are deliberately not one mapping. A `.pdf` is a Document but draws the
// plain file glyph; a `.mermaid` is a Diagram but draws the code glyph; an
// unknown extension is a File and draws a file. Collapsing them into one
// "category" — which an earlier version of this did — forces a wrong answer on
// two of the three every time the three disagree.

import type { AnthropiconName } from '../../components/icons/Anthropicon.js';

/** The kind word, as a key the copy catalog turns into language. */
export type DeliveryFileKind =
  | 'skill'
  | 'presentation'
  | 'spreadsheet'
  | 'document'
  | 'code'
  | 'diagram'
  | 'image'
  | 'audio'
  | 'file';

const KIND_BY_EXTENSION: Readonly<Record<string, DeliveryFileKind>> = Object.fromEntries(
  (
    [
      ['skill', ['skill']],
      ['presentation', ['ppt', 'pptx']],
      ['spreadsheet', ['xls', 'xlsx']],
      ['document', ['doc', 'docx', 'md', 'txt', 'pdf']],
      [
        'code',
        [
          'html',
          'jsx',
          'js',
          'ts',
          'tsx',
          'css',
          'py',
          'json',
          'yaml',
          'yml',
          'xml',
          'ini',
          'cfg',
          'config',
          'log',
          'toml',
          'proto',
          'sql',
          'sh',
          'bash',
          'zsh',
          'go',
          'rs',
          'php',
          'rb',
          'swift',
          'kt',
          'kts',
          'scala',
          'r',
          'matlab',
          'm',
          'mm',
          'mts',
          'lua',
          'pl',
          'pm',
          't',
          'bat',
          'coffee',
          'tex',
          'latex',
          'gd',
          'gdshader',
          'tres',
          'tscn',
        ],
      ],
      ['diagram', ['mermaid']],
      ['image', ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']],
      ['audio', ['mp3', 'wav']],
    ] as [DeliveryFileKind, string[]][]
  ).flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind])),
);

/** The glyph buckets, which answer a DIFFERENT question from the kind word. */
const GLYPH_BY_EXTENSION: Readonly<Record<string, AnthropiconName>> = Object.fromEntries(
  (
    [
      [
        'code',
        [
          'py',
          'js',
          'jsx',
          'ts',
          'tsx',
          'mts',
          'mjs',
          'cjs',
          'html',
          'htm',
          'css',
          'scss',
          'less',
          'vue',
          'svelte',
          'c',
          'cpp',
          'h',
          'hpp',
          'rs',
          'go',
          'java',
          'rb',
          'php',
          'swift',
          'kt',
          'kts',
          'scala',
          'r',
          'matlab',
          'm',
          'mm',
          'lua',
          'pl',
          'pm',
          't',
          'sh',
          'bash',
          'zsh',
          'bat',
          'coffee',
          'tex',
          'latex',
          'gd',
          'gdshader',
          'tres',
          'tscn',
          'mermaid',
          'sql',
          'proto',
          // Structured configuration counts as source here, as relx has it.
          'json',
          'xml',
          'yaml',
          'yml',
          'toml',
          'ini',
          'cfg',
          'conf',
          'config',
        ],
      ],
      ['spreadsheet', ['xls', 'xlsx', 'csv', 'tsv', 'ods']],
      ['image', ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']],
      ['sound', ['mp3', 'wav']],
      ['archive', ['zip']],
      // Text and documents share the fallback glyph; listed so the grouping is
      // readable rather than implied.
      [
        'file',
        [
          'md',
          'markdown',
          'txt',
          'text',
          'log',
          'rtf',
          'pdf',
          'doc',
          'docx',
          'odt',
          'ppt',
          'pptx',
          'odp',
        ],
      ],
    ] as [AnthropiconName, string[]][]
  ).flatMap(([glyph, extensions]) => extensions.map((extension) => [extension, glyph])),
);

/** Lowercased, dot-free, and absent when the name has no extension at all. */
function extensionOf(name: string): string | undefined {
  const filename = name.split('/').pop()?.toLowerCase() ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return undefined;
  return filename.slice(dot + 1);
}

/** A skill is either a packed `*.skill` or the `skill.md` inside its folder. */
function isSkillName(name: string): boolean {
  const filename = name.split('/').pop()?.toLowerCase() ?? '';
  return filename === 'skill.md' || filename.endsWith('.skill');
}

/** The extension, without its dot and upper-cased, for the line under the title. */
export function deliveryFileExtension(name: string): string | undefined {
  return extensionOf(name)?.toUpperCase();
}

export function deliveryFileKind(name: string): DeliveryFileKind {
  if (isSkillName(name)) return 'skill';
  const extension = extensionOf(name);
  return (extension ? KIND_BY_EXTENSION[extension] : undefined) ?? 'file';
}

export function deliveryFileGlyph(name: string): AnthropiconName {
  if (isSkillName(name)) return 'bookOpen';
  const extension = extensionOf(name);
  return (extension ? GLYPH_BY_EXTENSION[extension] : undefined) ?? 'file';
}

/**
 * The filename as a sentence: no extension, separators as spaces, one capital.
 *
 * Only the FIRST letter is raised. Title Case would turn a report's name into
 * a headline, and relx leaves the rest as the author typed it — `f09.txt`
 * stays `F09` because nothing after the first character is a letter to begin
 * with.
 */
export function deliveryFileTitle(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const words = base.replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!words) return name;
  return words[0]!.toUpperCase() + words.slice(1);
}
