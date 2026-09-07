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
 * Phase 3a replaced the Phase-0 placeholder with Prism. The token `type`
 * strings this emits are Prism's own, so a consumer that renders them as
 * `token <type>` inside a `.custom-code-highlight` container inherits the
 * palette `globals.css` already defines for code blocks — one set of colours
 * for code, not a second one invented for diffs.
 *
 * Prism tokenizes the WHOLE buffer, and a diff's buffer is two files
 * interleaved, so a construct that spans lines (an unterminated string, a
 * block comment opened on a deleted line) can colour rows below it. That is
 * bounded by construction: the spans are cut at line boundaries here, so a
 * mis-tokenized region mis-colours rows and can never shift them.
 */

import Prism from 'prismjs';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-scss.js';
import 'prismjs/components/prism-less.js';

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

type PrismToken = { type?: string; content: unknown };

/**
 * Flatten Prism's tree into absolute spans, in source order.
 *
 * A nested token's own `type` wins over its parent's, and a plain string
 * inside a token inherits the parent's — which is how `"a ${b} c"` keeps the
 * quotes and the literal text on the string colour while the interpolation
 * inside gets its own.
 */
function collectSpans(
  tokens: readonly unknown[],
  state: { offset: number },
  parentType: string | undefined,
  out: SyntaxToken[],
): void {
  for (const token of tokens) {
    if (typeof token === 'string') {
      if (parentType) out.push({ type: parentType, start: state.offset, end: state.offset + token.length });
      state.offset += token.length;
      continue;
    }
    const node = token as PrismToken;
    const type = node.type ?? parentType;
    const content = node.content;
    if (typeof content === 'string') {
      if (type) out.push({ type, start: state.offset, end: state.offset + content.length });
      state.offset += content.length;
    } else if (Array.isArray(content)) {
      collectSpans(content, state, type, out);
    } else if (content !== undefined && content !== null) {
      collectSpans([content], state, type, out);
    }
  }
}

/**
 * One entry per line, with the buffer's spans cut at every newline so a
 * construct that crosses lines still produces a span per row.
 */
function splitSpansByLine(code: string, spans: readonly SyntaxToken[]): TokenLine[] {
  const lines = code.split('\n');
  const result: TokenLine[] = lines.map(() => []);
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  let index = 0;
  for (const span of spans) {
    if (span.end <= span.start) continue;
    // Spans arrive in source order, so the search for the first line only ever
    // moves forward across the whole pass.
    while (index + 1 < starts.length && starts[index + 1]! <= span.start) index += 1;
    for (let line = index; line < lines.length; line += 1) {
      const lineStart = starts[line]!;
      const lineEnd = lineStart + lines[line]!.length;
      if (lineStart >= span.end) break;
      const start = Math.max(span.start, lineStart) - lineStart;
      const end = Math.min(span.end, lineEnd) - lineStart;
      if (end > start) result[line]!.push({ type: span.type, start, end });
    }
  }
  return result;
}

function tokenizeLines(code: string, language: string): TokenLine[] {
  const grammar = (Prism.languages as Record<string, unknown>)[language];
  if (!grammar) return code.split('\n').map(() => []);
  const spans: SyntaxToken[] = [];
  collectSpans(
    Prism.tokenize(code, grammar as Prism.Grammar) as readonly unknown[],
    { offset: 0 },
    undefined,
    spans,
  );
  return splitSpansByLine(code, spans);
}

/**
 * File extension → the Prism grammar to tokenize with. The table is bounded by
 * the grammars imported above, not by what Maka happens to edit: anything else
 * tokenizes to nothing and renders as plain text, which is the result the diff
 * had before and never a wrong colouring.
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
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  pyi: 'python',
  sh: 'bash',
  bash: 'bash',
  // Prism has no zsh grammar; its shell constructs are bash's.
  zsh: 'bash',
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
 * not a claim that the buffer is valid source — see the note at the top of
 * this file about constructs that span lines.
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
