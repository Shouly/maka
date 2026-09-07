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

// The result kinds whose whole body is a paragraph or a picture: text, JSON,
// an image, an archived placeholder, a workflow, and the row that has no
// result yet.
//
// JSON never reaches the reader as escaped braces. `formatQuietJsonValue` is
// the same formatter the CLI and the TUI use, so a tool's result reads the
// same wherever it is shown; the raw value is available in the row's copy
// action for anyone who needs it exactly.

import { memo } from 'react';
import type { ToolResultContent } from '@maka/core/events';
import {
  capLines,
  formatBytes,
  formatQuietJsonValue,
  formatUserVisibleToolText,
  getToolActivityCopy,
  useAttachmentImageSource,
  useUiLocale,
  type ToolActivityItem,
} from '@maka/ui';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import {
  ToolHandoffButton,
  ToolResultPanel,
  toolResultBlockClass,
  toolResultBlockLabelClass,
  toolResultBlockLabelRowClass,
} from '../tool-result.js';
import { getWorkbarCopy } from '../../../../locales/workbar-copy.js';

export const TextResult = memo(function TextResult(props: {
  result: Extract<ToolResultContent, { kind: 'text' } | { kind: 'summary' }>;
}) {
  const locale = useUiLocale();
  const raw = props.result.kind === 'text' ? props.result.text : props.result.summarized;
  const { body, capped } = capLines(formatUserVisibleToolText(raw, locale));
  const copy = getToolActivityCopy(locale).result;
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">
          {body}
        </pre>
        {capped > 0 && <p className={toolResultBlockLabelClass}>{copy.hiddenLines(capped)}</p>}
      </div>
    </ToolResultPanel>
  );
});

export const JsonResult = memo(function JsonResult(props: {
  result: Extract<ToolResultContent, { kind: 'json' }>;
}) {
  const locale = useUiLocale();
  const preview = formatQuietJsonValue(props.result.value, locale);
  const { body, capped } = capLines(preview.body);
  const copy = getToolActivityCopy(locale).result;
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        {preview.headline && (
          <div className={toolResultBlockLabelRowClass}>
            <p className={toolResultBlockLabelClass}>{preview.headline}</p>
          </div>
        )}
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">
          {body}
        </pre>
        {capped > 0 && <p className={toolResultBlockLabelClass}>{copy.hiddenLines(capped)}</p>}
      </div>
    </ToolResultPanel>
  );
});

export const FileWriteResult = memo(function FileWriteResult(props: {
  result: Extract<ToolResultContent, { kind: 'file_write' }>;
  /** Opens the written file in the right pane's Files face. */
  onOpenFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getToolActivityCopy(locale).result;
  const handoff = getWorkbarCopy(locale).handoff;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-xs leading-4 text-text-muted">
        {copy.fileWritten(props.result.bytes, props.result.path)}
      </span>
      {props.onOpenFile && (
        <ToolHandoffButton
          label={handoff.openInFiles}
          onClick={() => props.onOpenFile?.(props.result.path)}
        />
      )}
    </span>
  );
});

/**
 * An `image` result. The bytes never travel as a data URL through the event
 * stream — the attachment provider reads them from the Host on demand, which
 * is also why an unresolved ref renders as a caption rather than a broken
 * image box.
 */
export const ImageResult = memo(function ImageResult(props: {
  item: ToolActivityItem;
  result: Extract<ToolResultContent, { kind: 'image' }>;
  /** Opens the image in the right pane's Files face. */
  onOpenFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const handoff = getWorkbarCopy(locale).handoff;
  // Only a session file has bytes the attachment authority can read back; a
  // workspace or external path is a location, not a stored artifact.
  const source = useAttachmentImageSource(
    props.result.ref.kind === 'session_file'
      ? { sessionId: props.result.ref.sessionId, artifactId: props.result.ref.relativePath }
      : undefined,
  );
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        {props.onOpenFile && (
          <div className={toolResultBlockLabelRowClass}>
            <span />
            <ToolHandoffButton
              label={handoff.openInFiles}
              onClick={() =>
                props.onOpenFile?.(
                  props.result.ref.kind === 'session_file'
                    ? props.result.ref.relativePath
                    : undefined,
                )
              }
            />
          </div>
        )}
        {source ? (
          <img
            src={source}
            alt={copy.result.imageAlt(props.item.toolName)}
            className="max-h-60 max-w-full rounded-md object-contain"
          />
        ) : (
          <p className="text-xs leading-5 text-text-muted">{copy.turn.attachmentUnavailable}</p>
        )}
      </div>
    </ToolResultPanel>
  );
});

export const ArchivedResult = memo(function ArchivedResult(props: {
  result: Extract<ToolResultContent, { kind: 'archived_tool_result' }>;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).result;
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        <p className="text-xs leading-5 text-text-secondary">{copy.archived}</p>
        <p className={toolResultBlockLabelClass}>
          {copy.archivedDetail(props.result.status, formatBytes(props.result.originalBytes))}
        </p>
      </div>
    </ToolResultPanel>
  );
});

export const WorkflowResult = memo(function WorkflowResult(props: {
  result: Extract<ToolResultContent, { kind: 'rive_workflow' }>;
}) {
  const locale = useUiLocale();
  const copy = getToolActivityCopy(locale).result;
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        <div className={toolResultBlockLabelRowClass}>
          <p className={toolResultBlockLabelClass}>{copy.workflow.action}</p>
          <span className="text-[0.6875rem] leading-none text-text-muted">
            {props.result.ok ? copy.workflowCompleted : copy.workflowFailed}
          </span>
        </div>
        <p className="text-xs leading-5 text-text-secondary">{props.result.summary}</p>
        {props.result.error && (
          <p className="text-xs leading-5 text-danger">
            {props.result.error.reason}: {props.result.error.message}
          </p>
        )}
      </div>
    </ToolResultPanel>
  );
});

/**
 * A row that has started and has nothing back yet. It shows the streamed
 * output when there is some, so a long command is watchable, and otherwise the
 * arguments it was called with, so the reader knows what is being waited on.
 */
export const PendingResult = memo(function PendingResult(props: { item: ToolActivityItem }) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).result;
  const toolCopy = getToolActivityCopy(locale);
  const chunks = props.item.outputChunks ?? [];
  if (chunks.length === 0) {
    const args = props.item.args ?? props.item.argsPreview;
    if (args === undefined) {
      return (
        <ToolResultPanel>
          <p className="px-1 text-xs leading-5 text-text-muted">{copy.pending}</p>
        </ToolResultPanel>
      );
    }
    const preview = formatQuietJsonValue(args, locale);
    return (
      <ToolResultPanel>
        <div className={toolResultBlockClass}>
          <div className={toolResultBlockLabelRowClass}>
            <p className={toolResultBlockLabelClass}>{copy.arguments}</p>
          </div>
          <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">
            {capLines(preview.body).body}
          </pre>
        </div>
      </ToolResultPanel>
    );
  }
  const text = chunks.map((chunk) => chunk.text).join('');
  const { body, capped } = capLines(text);
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        <div className={toolResultBlockLabelRowClass}>
          <p className={toolResultBlockLabelClass}>{copy.output}</p>
        </div>
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">
          {body}
        </pre>
        {capped > 0 && (
          <p className={toolResultBlockLabelClass}>{toolCopy.result.hiddenLines(capped)}</p>
        )}
        {chunks.some((chunk) => chunk.redacted) && (
          <p className={toolResultBlockLabelClass}>{toolCopy.output.redacted}</p>
        )}
        {props.item.outputTruncated && (
          <p className={toolResultBlockLabelClass}>{toolCopy.output.truncated}</p>
        )}
      </div>
    </ToolResultPanel>
  );
});
