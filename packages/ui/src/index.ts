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
 * The `@maka/ui` barrel.
 *
 * The enterprise renderer rewrite (Phase 0a) shrank this package to logic:
 * turn projection, streams and redaction, copy catalogs, locale plumbing and
 * a handful of headless React hooks. Every Astryx-visual component and the
 * atom re-exports that came with them are gone, so this barrel now lists only
 * modules that carry no design system.
 *
 * `module-panel-types.js` is load-bearing beyond the renderer:
 * `src/preload/bridge-contract.d.ts` imports its skill types from here.
 */

export * from './artifact-preview-registry.js';
export * from './assistant-stream.js';
export * from './attachment-image.js';
export * from './bot-brand.js';
export * from './bot-brand-logo.js';
export * from './chat-conversation-items.js';
export * from './chat-display-helpers.js';
export * from './chat-input-behavior.js';
export * from './chat-model-helpers.js';
export * from './clipboard-feedback.js';
export * from './composer-helpers.js';
export * from './conversation-copy.js';
export * from './daily-review-copy.js';
export * from './daily-review-helpers.js';
export * from './daily-review-view-state.js';
export * from './form-interaction-prompt-state.js';
export * from './goal-projection-context.js';
export * from './input-history.js';
export * from './interaction-queue.js';
export * from './listed-selection.js';
export * from './live-turn-projection.js';
export * from './locale-context.js';
export * from './locale-helpers.js';
export * from './maka-uri.js';
export * from './maka-wordmark.js';
export * from './markdown-math.js';
export { MakaUriContext } from './markdown.js';
export * from './materialize.js';
export * from './model-picker-internals.js';
export * from './module-panel-types.js';
export * from './nav-selection.js';
export * from './platform-shortcut-text.js';
export * from './primitives/stat-tile.js';
export * from './redact.js';
export * from './relative-time.js';
export * from './runtime-resume-copy.js';
export * from './scheduled-task-copy.js';
export * from './scheduled-task-helpers.js';
export * from './scheduled-task-status.js';
export * from './selection-quote-target.js';
export * from './session-hover-card-copy.js';
export * from './session-setting-intent.js';
export * from './session-status-presentation.js';
export * from './shared-ui-copy.js';
export * from './shell-controls-copy.js';
export * from './shell-view-types.js';
export * from './sidebar-update-projection-context.js';
export * from './skill-status.js';
export * from './skills-copy.js';
export * from './status-vocabulary.js';
export * from './stream-delta.js';
export * from './streaming-display-redaction.js';
export * from './streaming-presentation.js';
export * from './thinking-stream.js';
export * from './timeline-fold.js';
export * from './tool-activity/builtin-preview.js';
export * from './tool-activity/computer-action-label.js';
export * from './tool-activity/copy.js';
export * from './tool-activity/diff-syntax.js';
export * from './tool-activity/display-name.js';
export * from './tool-activity/preview-utils.js';
export * from './tool-activity/result-projection.js';
export * from './tool-activity/sandbox-denial.js';
export * from './tool-format.js';
export * from './tool-output-stream.js';
export * from './transcript-projection.js';
export * from './transcript-row-projection.js';
export * from './transcript-scroll-authority.js';
export * from './use-chat-scroll.js';
export * from './use-composer-draft.js';
export * from './use-composer-history.js';
export * from './use-message-selection-quote.js';
export * from './use-mounted-ref.js';
export * from './use-pending-selection.js';
export * from './use-roving-row-focus.js';
export * from './use-transcript-projection.js';
export * from './user-question-prompt-state.js';
export * from './utils.js';
