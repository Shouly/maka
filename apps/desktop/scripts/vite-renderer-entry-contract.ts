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

import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const SOURCE_FILE = /\.(?:(?:c|m)?(?:js|ts)x?)$/u;
const ALLOWED_HTML_TAGS = new Set([
  'body',
  'div',
  'head',
  'html',
  'link',
  'meta',
  'script',
  'style',
  'title',
]);
// Pinned to the byte. Loosening the renderer's CSP has to be two deliberate
// edits — the document and this line — so no transform and no well-meant patch
// can widen it on its own.
//
// `object-src blob:` is the artifact pane's PDF preview: `<embed
// type="application/pdf">` is a plugin document, which `default-src 'self'`
// refuses, and the bytes are a blob the renderer minted itself from what the
// artifact bridge already read. It admits no new origin — only the plugin
// surface for blobs this renderer made, and the one call that makes a PDF blob
// names `application/pdf` itself rather than trusting the artifact's mime.
//
// `frame-src maka-artifact:` is the HTML artifact preview. Model-authored
// markup is framed under a scheme Main serves and controls rather than under
// this document's own origin, so it can never reach `window.maka`; naming the
// scheme here is what stops a frame pointing anywhere else.
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src blob:; frame-src maka-artifact:; connect-src 'self'";

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function htmlAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu'),
  );
  return match?.[1] ?? match?.[2];
}

export function assertRendererEntryHtml(html: string, expectedScriptSource?: string): void {
  const tagNames = [...html.matchAll(/<\/?([a-z][a-z0-9-]*)\b/giu)].map((match) =>
    match[1].toLowerCase(),
  );
  const hasForbiddenTag = tagNames.some((tag) => !ALLOWED_HTML_TAGS.has(tag));
  const hasEventHandler = /\son[a-z0-9-]+\s*=/iu.test(html);

  const openingScriptCount = html.match(/<script\b/giu)?.length ?? 0;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)];
  const [script] = scripts;
  const scriptSource = htmlAttribute(script?.[1] ?? '', 'src');
  const validScriptSource = expectedScriptSource
    ? scriptSource === expectedScriptSource
    : scriptSource === '/main.tsx' || /^\.\/assets\/[a-z0-9._-]+\.js$/iu.test(scriptSource ?? '');
  const validScript =
    openingScriptCount === 1 &&
    scripts.length === 1 &&
    htmlAttribute(script?.[1] ?? '', 'type') === 'module' &&
    validScriptSource &&
    (script?.[2] ?? '').trim().length === 0;

  const metas = [...html.matchAll(/<meta\b([^>]*)>/giu)].map((match) => match[1]);
  const charsetMetas = metas.filter(
    (attributes) => htmlAttribute(attributes, 'charset')?.toLowerCase() === 'utf-8',
  );
  const viewportMetas = metas.filter(
    (attributes) =>
      htmlAttribute(attributes, 'name')?.toLowerCase() === 'viewport' &&
      htmlAttribute(attributes, 'content') === 'width=device-width, initial-scale=1.0',
  );
  const policyMetas = metas.filter(
    (attributes) =>
      htmlAttribute(attributes, 'http-equiv')?.toLowerCase() === 'content-security-policy' &&
      htmlAttribute(attributes, 'content')?.trim().replace(/\s+/gu, ' ') === CONTENT_SECURITY_POLICY,
  );
  const validMetas =
    metas.length === 3 &&
    charsetMetas.length === 1 &&
    viewportMetas.length === 1 &&
    policyMetas.length === 1;

  const links = [...html.matchAll(/<link\b([^>]*)>/giu)].map((match) => match[1]);
  const validLinks = links.every((attributes) => {
    const relation = htmlAttribute(attributes, 'rel')?.toLowerCase();
    const href = htmlAttribute(attributes, 'href');
    return (
      ['modulepreload', 'stylesheet'].includes(relation ?? '') &&
      /^\.\/assets\/[a-z0-9._-]+\.(?:css|js)$/iu.test(href ?? '')
    );
  });

  if (
    hasForbiddenTag ||
    hasEventHandler ||
    !validScript ||
    !validMetas ||
    !validLinks
  ) {
    throw new Error(
      'renderer entry HTML contract forbids transformed executable or navigation surfaces',
    );
  }
}

/**
 * Attests the final Vite module graph rather than trusting the source HTML.
 * A transformIndexHtml hook may rewrite a valid index.html before bundling;
 * the canonical main.tsx must therefore remain the sole executable source
 * imported directly by the emitted HTML entry.
 */
export function rendererEntryContractPlugin(rendererRoot: string): Plugin {
  const canonicalIndex = normalizePath(resolve(rendererRoot, 'index.html'));
  const canonicalMain = normalizePath(resolve(rendererRoot, 'main.tsx'));
  let isRendererBuild = false;

  return {
    name: 'maka-renderer-entry-contract',
    apply: 'build',
    configResolved(config) {
      isRendererBuild = normalizePath(resolve(config.root)) === normalizePath(resolve(rendererRoot));
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!isRendererBuild) return html;
        assertRendererEntryHtml(html);
        return html;
      },
    },
    generateBundle(_options, bundle) {
      if (!isRendererBuild) return;
      const entryChunks = Object.values(bundle).filter(
        (item) => item.type === 'chunk' && item.isEntry,
      );
      const [entry] = entryChunks;
      const facade = entry?.facadeModuleId ? normalizePath(entry.facadeModuleId) : undefined;
      const moduleInfo = facade ? this.getModuleInfo(entry.facadeModuleId) : undefined;
      const directSourceImports = (moduleInfo?.importedIds ?? [])
        .filter((id) => !id.startsWith('\0'))
        .map((id) => normalizePath(id.split(/[?#]/u, 1)[0]))
        .filter((id) => SOURCE_FILE.test(id));

      if (
        entryChunks.length !== 1 ||
        facade !== canonicalIndex ||
        directSourceImports.length !== 1 ||
        directSourceImports[0] !== canonicalMain
      ) {
        this.error(
          'renderer entry contract requires src/renderer/index.html to import only src/renderer/main.tsx',
        );
      }
      this.emitFile({
        type: 'asset',
        fileName: 'renderer-entry-attestation.json',
        source: `${JSON.stringify(
          {
            entryFile: entry.fileName,
            htmlFile: 'index.html',
            sourceFile: 'src/renderer/main.tsx',
          },
          null,
          2,
        )}\n`,
      });
    },
  };
}
