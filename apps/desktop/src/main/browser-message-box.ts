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

import type { UiCatalog } from '@maka/core/ui-locale';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isThemePalette, type ThemePalette } from '@maka/core/settings';
import type { UiLocale } from '@maka/core/ui-locale';
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  MessageBoxOptions,
  MessageBoxReturnValue,
  Rectangle,
} from 'electron';
import { resolveOverlayAssetDir } from './overlay-assets.js';

const RESPONSE_URL_PREFIX = 'maka-dialog://response/';
// 425 card + the 16px body padding each side: the in-app dialog's width
// (`ConfirmDialog`'s md:max-w-[425px]), which this card had been 95px wider than.
const DIALOG_WIDTH = 457;
const INITIAL_HEIGHT = 600;
const MIN_HEIGHT = 280;
const WORK_AREA_MARGIN = 32;
const DIALOG_PRESENTATION_TIMEOUT_MS = 30_000;
const DIALOG_DESIGN_TOKENS_FILE = 'browser-dialog-design-tokens.css';
let cachedDialogDesignTokens: string | undefined;
let activeBrowserMessageBoxPresentations = 0;

export interface BrowserMessageBoxAppearance {
  readonly locale: UiLocale;
  readonly palette?: ThemePalette;
  readonly dark?: boolean;
}

export interface BrowserMessageBoxRuntime {
  readonly shouldUseDarkColors: boolean;
  readonly createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  readonly resolveWorkArea: (parent: BrowserWindow | undefined) => Rectangle;
  readonly showNative: (
    options: MessageBoxOptions,
    parent: BrowserWindow | undefined,
  ) => Promise<MessageBoxReturnValue>;
  readonly onBrowserError: (error: unknown) => void;
  readonly presentationTimeoutMs?: number;
}

/** Whether closing a temporary dialog must not be interpreted as app shutdown. */
export function isBrowserMessageBoxPresentationActive(): boolean {
  return activeBrowserMessageBoxPresentations > 0;
}

/**
 * Product-styled replacement for Electron's native MessageBox.
 *
 * BrowserWindow can fail for exactly the class of failures these dialogs
 * report, so the native MessageBox remains the last-resort fallback.
 */
export async function showBrowserMessageBox(
  options: MessageBoxOptions,
  parent: BrowserWindow | undefined,
  appearance: BrowserMessageBoxAppearance,
): Promise<MessageBoxReturnValue> {
  // Keep the presentation helpers importable under plain `node --test`.
  // Electron itself is only required when a dialog is actually presented.
  const electron = await import('electron');
  return showBrowserMessageBoxWithRuntime(options, parent, appearance, {
    shouldUseDarkColors: electron.nativeTheme.shouldUseDarkColors,
    createWindow: (windowOptions) => new electron.BrowserWindow(windowOptions),
    resolveWorkArea: (nextParent) => resolveWorkArea(electron, nextParent),
    showNative: (nextOptions, nextParent) =>
      showNativeMessageBox(electron, nextOptions, nextParent),
    onBrowserError: (error) => {
      console.error('[dialog] BrowserWindow presentation failed; using native fallback:', error);
    },
  });
}

export async function showBrowserMessageBoxWithRuntime(
  options: MessageBoxOptions,
  parent: BrowserWindow | undefined,
  appearance: BrowserMessageBoxAppearance,
  runtime: BrowserMessageBoxRuntime,
): Promise<MessageBoxReturnValue> {
  activeBrowserMessageBoxPresentations += 1;
  try {
    const visibleParent = (): BrowserWindow | undefined =>
      parent && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized()
        ? parent
        : undefined;
    try {
      return await presentBrowserMessageBox(runtime, options, visibleParent(), appearance);
    } catch (error) {
      runtime.onBrowserError(error);
      return await runtime.showNative(options, visibleParent());
    }
  } finally {
    activeBrowserMessageBoxPresentations -= 1;
  }
}

async function showNativeMessageBox(
  electron: typeof import('electron'),
  options: MessageBoxOptions,
  parent: BrowserWindow | undefined,
): Promise<MessageBoxReturnValue> {
  return parent
    ? electron.dialog.showMessageBox(parent, options)
    : electron.dialog.showMessageBox(options);
}

async function presentBrowserMessageBox(
  runtime: BrowserMessageBoxRuntime,
  options: MessageBoxOptions,
  parent: BrowserWindow | undefined,
  appearance: BrowserMessageBoxAppearance,
): Promise<MessageBoxReturnValue> {
  const presentation = normalizeBrowserMessageBoxPresentation(options, {
    ...appearance,
    dark: appearance.dark ?? runtime.shouldUseDarkColors,
  });
  const workArea = runtime.resolveWorkArea(parent);
  const width = Math.max(320, Math.min(DIALOG_WIDTH, workArea.width - WORK_AREA_MARGIN * 2));
  const initialHeight = Math.max(
    MIN_HEIGHT,
    Math.min(INITIAL_HEIGHT, workArea.height - WORK_AREA_MARGIN * 2),
  );
  const initialBounds = centeredBounds(parent?.getBounds(), workArea, width, initialHeight);
  const win = runtime.createWindow({
    ...initialBounds,
    title: presentation.title,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // The card draws the whole dialog — its corners, its hairline ring and its
    // shadow all come from `--dialog-shadow`. Letting the OS draw a second
    // rounded rect and a second shadow at the WINDOW bounds put a faint line
    // around the card, one body-gutter out from the card's own edge.
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(parent ? { parent, modal: true, skipTaskbar: true } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  try {
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    return await new Promise<MessageBoxReturnValue>((resolve, reject) => {
      let settled = false;
      let presentationTimeout: ReturnType<typeof setTimeout> | undefined;
      const clearPresentationTimeout = (): void => {
        if (!presentationTimeout) return;
        clearTimeout(presentationTimeout);
        presentationTimeout = undefined;
      };
      const finish = (response: number): void => {
        if (settled) return;
        settled = true;
        clearPresentationTimeout();
        resolve({ response, checkboxChecked: false });
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearPresentationTimeout();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      presentationTimeout = setTimeout(
        () => fail(new Error('Dialog renderer did not become interactive in time')),
        runtime.presentationTimeoutMs ?? DIALOG_PRESENTATION_TIMEOUT_MS,
      );

      win.on('closed', () => finish(presentation.cancelId));
      win.on('unresponsive', () => fail(new Error('Dialog renderer became unresponsive')));
      win.webContents.on('render-process-gone', (_event, details) => {
        fail(new Error(`Dialog renderer exited: ${details.reason}`));
      });
      win.webContents.on('will-navigate', (event, url) => {
        const response = parseBrowserMessageBoxResponse(url, presentation.buttons.length);
        event.preventDefault();
        if (response !== undefined) finish(response);
      });
      void win
        .loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(
            renderBrowserMessageBoxHtml(presentation),
          )}`,
        )
        .then(async () => {
          if (settled || win.isDestroyed()) return;
          const naturalHeight = await measureDialogHeight(win).catch(() => initialHeight);
          const height = Math.max(
            MIN_HEIGHT,
            Math.min(naturalHeight, workArea.height - WORK_AREA_MARGIN * 2),
          );
          win.setBounds(centeredBounds(parent?.getBounds(), workArea, width, height), false);
          await win.webContents.executeJavaScript(
            "document.body.classList.add('maka-dialog-constrained')",
            true,
          );
          if (settled || win.isDestroyed()) return;
          win.show();
          win.focus();
          clearPresentationTimeout();
        })
        .catch(fail);
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

interface BrowserMessageBoxPresentation {
  readonly type: 'none' | 'info' | 'warning' | 'error' | 'question';
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly defaultId: number;
  readonly cancelId: number;
  readonly dark: boolean;
  readonly locale: UiLocale;
  readonly palette: ThemePalette;
}

function normalizeBrowserMessageBoxPresentation(
  options: MessageBoxOptions,
  appearance: BrowserMessageBoxAppearance & { readonly dark: boolean },
): BrowserMessageBoxPresentation {
  const buttons = options.buttons?.length ? [...options.buttons] : ['OK'];
  const cancelId = validButtonId(options.cancelId, buttons.length) ? options.cancelId : 0;
  const defaultId = validButtonId(options.defaultId, buttons.length)
    ? options.defaultId
    : 0;
  const title = options.title || 'Maka';
  const message = options.message || title;
  return {
    type: messageBoxType(options.type),
    title,
    message,
    detail: options.detail ?? '',
    buttons,
    defaultId,
    cancelId,
    dark: appearance.dark,
    locale: appearance.locale,
    palette: isThemePalette(appearance.palette) ? appearance.palette : 'default',
  };
}

function validButtonId(value: number | undefined, count: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;
}

function resolveWorkArea(
  electron: typeof import('electron'),
  parent: BrowserWindow | undefined,
): Rectangle {
  if (parent && !parent.isDestroyed()) {
    return electron.screen.getDisplayMatching(parent.getBounds()).workArea;
  }
  return electron.screen.getPrimaryDisplay().workArea;
}

export function centeredBounds(
  parentBounds: Rectangle | undefined,
  workArea: Rectangle,
  width: number,
  height: number,
): Rectangle {
  const anchor = parentBounds ?? workArea;
  const preferredX = Math.round(anchor.x + (anchor.width - width) / 2);
  const preferredY = Math.round(anchor.y + (anchor.height - height) / 2);
  return {
    x: clamp(preferredX, workArea.x, workArea.x + workArea.width - width),
    y: clamp(preferredY, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

async function measureDialogHeight(win: BrowserWindow): Promise<number> {
  const measured: unknown = await win.webContents.executeJavaScript(
    `(() => {
      const card = document.querySelector('.card');
      if (!card) return 0;
      const gutter = getComputedStyle(document.body);
      return Math.ceil(
        card.scrollHeight + parseFloat(gutter.paddingTop) + parseFloat(gutter.paddingBottom),
      );
    })()`,
    true,
  );
  return typeof measured === 'number' && Number.isFinite(measured)
    ? Math.ceil(measured)
    : INITIAL_HEIGHT;
}

function dialogDesignTokens(): string {
  cachedDialogDesignTokens ??= readFileSync(
    join(resolveOverlayAssetDir(import.meta.url), DIALOG_DESIGN_TOKENS_FILE),
    'utf8',
  );
  return cachedDialogDesignTokens;
}

export function parseBrowserMessageBoxResponse(
  value: string,
  buttonCount: number,
): number | undefined {
  if (!value.startsWith(RESPONSE_URL_PREFIX)) return undefined;
  const encodedResponse = value.slice(RESPONSE_URL_PREFIX.length);
  if (!/^(?:0|[1-9]\d*)$/u.test(encodedResponse)) return undefined;
  const response = Number(encodedResponse);
  return Number.isInteger(response) && response >= 0 && response < buttonCount
    ? response
    : undefined;
}

export function buildBrowserMessageBoxHtml(
  options: MessageBoxOptions,
  appearance: BrowserMessageBoxAppearance & { readonly dark: boolean },
): string {
  return renderBrowserMessageBoxHtml(
    normalizeBrowserMessageBoxPresentation(options, appearance),
  );
}

function renderBrowserMessageBoxHtml(input: BrowserMessageBoxPresentation): string {
  const nonce = randomUUID().replaceAll('-', '');
  const closeLabel = CLOSE_LABEL[input.locale];
  const closeButton = `<button class="window-close" type="button" data-response="${input.cancelId}" aria-label="${closeLabel}">
    <span class="glyph" aria-hidden="true">\uE10F</span>
  </button>`;
  const buttons = input.buttons
    .map((label, index) => ({ label, index }))
    .sort((left, right) => {
      const rank = (index: number): number =>
        index === input.defaultId ? 2 : index === input.cancelId ? 0 : 1;
      return rank(left.index) - rank(right.index);
    })
    .map(({ label, index }) => {
      const classes = [
        'decision',
        index === input.defaultId
          ? 'primary'
          : index === input.cancelId
            ? 'ghost'
            : 'secondary',
      ]
        .filter(Boolean)
        .join(' ');
      return `<button class="${classes}" type="button" data-response="${index}"${
        index === input.defaultId ? ' autofocus' : ''
      }>${escapeHtml(label)}</button>`;
    })
    .join('');
  const detailBlock = input.detail
    ? `<div class="detail" data-testid="dialog-detail">${escapeHtml(input.detail)}</div>`
    : '';
  // The app's own glyphs, from the icon face the generated stylesheet inlines —
  // the same codepoints ANTHROPICON_SPECS names, so these marks are the ones the
  // rest of the product draws and they move when it does. NoticeCard uses
  // warningCircle for both warning and destructive; this follows it.
  const statusGlyph =
    input.type === 'question'
      ? '\uE088' // questionCircle
      : input.type === 'info' || input.type === 'none'
        ? '\uE08F' // info
        : '\uE10A'; // warningCircle

  return `<!doctype html>
<html lang="${input.locale}" data-theme="${input.dark ? 'dark' : 'light'}" data-maka-theme="${input.palette}" class="${input.dark ? 'dark' : 'light'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src data:; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(input.title)}</title>
  <style nonce="${nonce}">
    ${dialogDesignTokens()}
    /* Measurements are the in-app dialog's, not this card's own invention:
       'ui/dialog.tsx' (12px radius, --dialog-shadow, 24px inner padding, a
       22/28 semibold title over a 14/20 secondary description, a 12px action
       gap) and 'ui/button.tsx' (32px tall, 8px radius, the squish press). The
       card is standalone, so those come through as literals — the COLOURS are
       the shared tokens, which is what keeps it in step when the palette moves. */
    * { box-sizing: border-box; }
    html, body { margin: 0; background: transparent; }
    body {
      /* The transparent margin the card's shadow is drawn into. '--dialog-shadow'
         reaches ~24px below the card (offset 12 + blur 28 halved, spread -2) and
         ~12px to each side, and barely at all above it, so the bottom gets more
         than the rest. Too little here and the OS window bounds clip the shadow. */
      --gutter: 16px;
      --gutter-bottom: 28px;
      padding: var(--gutter) var(--gutter) var(--gutter-bottom);
      font-family: var(--font-sans);
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      user-select: none;
    }
    body.maka-dialog-constrained { height: 100vh; overflow: hidden; }
    .card {
      width: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      /* No border: the in-app dialog separates itself with elevation alone. */
      border-radius: 12px;
      background: var(--surface-3);
      box-shadow: var(--dialog-shadow);
      animation: dialog-enter 200ms cubic-bezier(.32, .72, 0, 1) backwards;
    }
    body.maka-dialog-constrained .card {
      height: calc(100vh - var(--gutter) - var(--gutter-bottom));
      min-height: calc(100vh - var(--gutter) - var(--gutter-bottom));
    }
    /* The card is its own window, so it keeps a drag strip the in-app dialog
       does not need. It carries nothing but the close control: a brand mark
       here would be the first thing read, above the sentence that says what is
       about to happen. */
    .drag-region {
      height: 36px;
      flex: 0 0 36px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 4px 8px 0;
      -webkit-app-region: drag;
    }
    button { font: inherit; }
    .window-close {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--text-primary);
      cursor: pointer;
      transition: background-color 60ms ease-out;
      -webkit-app-region: no-drag;
    }
    /* The icon-face contract, transcribed from 'Anthropicon': ligatures off so
       a codepoint pair cannot combine, synthesis off so a missing weight is
       never faked, and the variable axes pinned to the same values the
       component sets for a 20px mark. */
    .glyph {
      font-family: 'Anthropicons-Variable';
      font-size: 20px;
      line-height: 1;
      font-style: normal;
      font-weight: 433.25;
      font-synthesis: none;
      font-variant-ligatures: none;
      font-feature-settings: 'liga' 0, 'clig' 0, 'dlig' 0;
      font-variation-settings: 'ANIM' 0, 'ANM2' 0, 'opsz' 20, 'wght' 433.25;
      letter-spacing: normal;
      user-select: none;
    }
    .window-close:hover { background: var(--sidebar-menu-hover); }
    .window-close:focus-visible,
    .decision:focus-visible {
      outline: none;
      box-shadow: var(--sidebar-focus-shadow);
    }
    .content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 0 24px 20px;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar) transparent;
    }
    .content::-webkit-scrollbar { width: 10px; }
    .content::-webkit-scrollbar-track { background: transparent; }
    .content::-webkit-scrollbar-thumb {
      border: 2px solid transparent;
      border-radius: 999px;
      background: var(--scrollbar);
      background-clip: content-box;
    }
    .heading-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    /* The mark, coloured by tone and nothing else — 'NoticeCard' tints the
       glyph and never puts it in a tile, and a tile here would be a second
       filled shape competing with the title beside it. 20px is the size the
       icon set is drawn at. */
    .icon {
      flex: 0 0 20px;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 4px;
      color: var(--text-muted);
    }
    .warning .icon { color: var(--text-warning); }
    .error .icon { color: var(--text-danger); }
    .question .icon { color: var(--text-accent); }
    .heading-copy { min-width: 0; }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 28px;
      font-weight: 580;
      color: var(--text-primary);
    }
    .message {
      margin-top: 4px;
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 20px;
      white-space: pre-wrap;
      user-select: text;
    }
    /* The consequence, on a surface of its own — 'NoticeCard''s shape and its
       three tone faces (rounded-xl, 1px border, 12px padding). Following it
       also settles what NOT to tint: the tone colours the surface and the mark,
       never the prose, so the text stays 'text-secondary' on every face and an
       amber block does not arrive with amber text inside it. */
    .detail {
      margin-top: 16px;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid var(--hairline);
      background: var(--surface-2);
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 20px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
    }
    .warning .detail {
      border-color: var(--border-warning);
      background: var(--bg-warning);
    }
    .error .detail {
      border-color: var(--border-danger);
      background: var(--bg-danger);
    }
    .actions {
      flex: 0 0 auto;
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 12px;
      padding: 0 24px 24px;
    }
    /* 'ui-control-squish', transcribed: the press scales a backing layer, never
       the label. */
    .decision {
      position: relative;
      isolation: isolate;
      height: 32px;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--text-primary);
      font-size: 14px;
      line-height: 20px;
      font-weight: 400;
      white-space: nowrap;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .decision::before {
      content: "";
      position: absolute;
      inset: var(--control-inset, 0px);
      z-index: -1;
      border-radius: inherit;
      background: var(--control-fill, var(--fill-secondary));
      box-shadow: var(--control-shadow, var(--field-shadow));
      transform-origin: 50%;
      transition:
        transform 450ms var(--control-spring),
        background-color 60ms ease-out,
        box-shadow 60ms ease-out;
    }
    .decision:hover::before {
      background: var(--control-fill-hover, var(--fill-secondary-hover));
      box-shadow: var(--control-shadow-hover, var(--field-shadow-hover));
    }
    .decision:active::before {
      transform: scale(.975);
      transition: transform 60ms ease-out, background-color 60ms ease-out;
    }
    /* The default action is solid near-black, the system's primary — not the
       brand colour, which names Maka rather than the action ('ui/button.tsx'). */
    .decision.primary {
      --control-fill: var(--fill-primary);
      --control-fill-hover: var(--fill-primary-hover);
      --control-inset: .5px;
      --control-shadow: none;
      --control-shadow-hover: none;
      color: var(--on-primary);
      font-weight: 500;
    }
    /* Spelled out rather than left to the fallbacks above: the classifier emits
       this class, so a reader looking for it has to find it. */
    .decision.secondary {
      --control-fill: var(--fill-secondary);
      --control-fill-hover: var(--fill-secondary-hover);
    }
    .decision.ghost {
      --control-fill: transparent;
      --control-fill-hover: var(--sidebar-menu-hover);
      --control-shadow: none;
      --control-shadow-hover: none;
    }
    @keyframes dialog-enter {
      from { opacity: 0; transform: translateY(10px) scale(.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; }
      .decision::before { transition: none; }
    }
  </style>
</head>
<body>
  <main class="card ${input.type}" role="alertdialog" aria-labelledby="dialog-title" aria-describedby="dialog-message">
    <div class="drag-region">
      ${closeButton}
    </div>
    <section class="content">
      <div class="heading-row">
        <span class="icon glyph" aria-hidden="true">${statusGlyph}</span>
        <div class="heading-copy">
          <h1 id="dialog-title">${escapeHtml(input.title)}</h1>
          <div class="message" id="dialog-message">${escapeHtml(input.message)}</div>
        </div>
      </div>
      ${detailBlock}
    </section>
    <footer class="actions">${buttons}</footer>
  </main>
  <script nonce="${nonce}">
    const respond = (value) => window.location.assign('${RESPONSE_URL_PREFIX}' + value);
    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-response]') : null;
      if (button) respond(button.getAttribute('data-response'));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        respond('${input.cancelId}');
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        respond('${input.defaultId}');
      }
    });
  </script>
</body>
</html>`;
}

function messageBoxType(value: MessageBoxOptions['type']): BrowserMessageBoxPresentation['type'] {
  return value === 'warning' || value === 'error' || value === 'question' || value === 'info'
    ? value
    : 'none';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

const CLOSE_LABEL = { 'zh-CN': '关闭', 'zh-TW': '關閉', en: 'Close' } satisfies UiCatalog<string>;
