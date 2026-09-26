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

// Ported from upstream `renderer/skill-invocation-feedback.ts`. What the
// composer tells the user about a submission turned back before anything was
// admitted: attachments the ingest guard refused before they left the
// renderer (#4878). A `/<name>` skill token is text the model reads, so no
// submission is refused over a Skill.

import type { AttachmentIngestBlockedCode } from '@maka/core/attachments';
import type { UiLocale } from '@maka/core/ui-locale';
import { getShellCopy } from '../../locales/shell-copy.js';

type FeedbackToastApi = {
  error(
    title: string,
    description?: string,
    diagnosticDetails?: string,
    diagnosticTarget?: { sessionId: string },
  ): void;
};

export function showSubmissionFeedback(
  uiLocale: UiLocale,
  toastApi: FeedbackToastApi,
  outcome: { reason: 'attachment_blocked'; code: AttachmentIngestBlockedCode },
  sessionId: string,
): void {
  const copy = getShellCopy(uiLocale);
  toastApi.error(
    copy.chatActions.sendFailedTitle,
    copy.sessionSettingsActions.attachmentIngestBlocked[outcome.code],
    undefined,
    { sessionId },
  );
}
