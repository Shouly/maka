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

/**
 * Syntax colouring for the file-diff preview.
 *
 * The diff body used to paint every line one flat colour — green for an
 * addition, red for a deletion, grey for context — so a fifty-line hunk read
 * as three blocks of tint with no structure inside them. A whole-buffer
 * highlighter cannot supply the missing half: it highlights one language, and
 * a diff is neither (its marker column is not code, and its lines are two
 * files interleaved). What a diff can use is a *stateless per-line*
 * tokenizer — the rows tokenize as one buffer of stripped code and the results
 * still line up row for row, with no pretence that the old and new sides are
 * each a compilable file.
 *
 * TODO(phase-3): Prism-based highlighting. The enterprise renderer rewrite
 * (Phase 0a) removed the Astryx tokenizer this module used to call, and the
 * replacement below returns one empty token array per line — every row renders
 * as plain text, which is exactly the result the diff had before colouring was
 * added and never a wrong colouring. Phase 3 swaps `tokenizeLines` for a
 * `prismjs` implementation that emits the same `TokenLine` shape.
 */

/** One highlight span inside a line, at line-relative offsets. */
export type SyntaxToken = {
  type: string;
  start: number;
  end: number;
};

/**
 * Per-line token structure. Each line stores its own tokens with
 * line-relative start/end offsets (0 = start of line).
 */
export type TokenLine = SyntaxToken[];

/**
 * Placeholder tokenizer: one empty token array per line, so consumers keep
 * their row-for-row alignment and render plain text until Phase 3 lands Prism.
 */
function tokenizeLines(code: string, _language: string): TokenLine[] {
  return code.split('\n').map(() => []);
}


/**
 * File extension → the language identifier Astryx's tokenizer knows. The table
 * is bounded by what `buildLanguagePatterns` implements, not by what Maka
 * happens to edit: anything else tokenizes to nothing and renders as plain
 * text, which is the result the diff had before and never a wrong colouring.
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'svg',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  pyi: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  php: 'php',
  hh: 'hack',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
};

/**
 * Per-row tokens for a diff's stripped code, in row order — empty when the
 * paths do not agree on one language the tokenizer knows.
 *
 * Every producer of a `file_diff` result names exactly one path, so the
 * disagreement case is a guard rather than a feature: a diff spanning two
 * languages renders plain instead of taking whichever file came first.
 *
 * Joining the rows into one buffer is a way to make a single `tokenize` call,
 * not a claim that the buffer is valid source — the tokenizer returns one
 * entry per line and inherits no state from the line above (see the note on
 * newline-spanning patterns at the top of this file).
 */
export function diffSyntaxTokens(paths: readonly string[], code: readonly string[]): TokenLine[] {
  if (code.length === 0) return [];
  let language: string | undefined;
  for (const path of paths) {
    const candidate = syntaxLanguageForPath(path);
    if (candidate === undefined) return [];
    if (language !== undefined && language !== candidate) return [];
    language = candidate;
  }
  return language === undefined ? [] : tokenizeLines(code.join('\n'), language);
}

export function syntaxLanguageForPath(path: string): string | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension ? LANGUAGE_BY_EXTENSION[extension] : undefined;
}
