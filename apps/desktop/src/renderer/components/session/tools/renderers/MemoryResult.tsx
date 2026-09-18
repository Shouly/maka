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

// The opened body of a memory row: the six tools share one renderer and one
// icon, and the body follows the tool's shape — a file list, a document, the
// two sides of a replacement, the text a write lands. Ported from the
// reference design system's `MemoryRenderer`.
//
// Nothing protocol-shaped is drawn: the version token, the `if_version` hint
// and the paging cursor are the model's handshake with the store, not memory.

import { RelativeTime, useUiLocale, type ToolActivityItem } from '@maka/ui';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { cn } from '../../../../lib/cn.js';
import {
  memoryArgsOf,
  memoryResultText,
  memoryToolVerb,
  parseMemoryListResult,
  parseMemoryReadResult,
} from '../../../../lib/memory-tool-results.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import {
  ToolResultPanel,
  toolResultBlockClass,
  toolResultBlockLabelClass,
  toolResultBlockLabelRowClass,
} from '../tool-result.js';

/**
 * A block of memory text inside the panel. The block's own padding is the
 * inset; the panel owns the scroll cap, so the text carries neither.
 */
function DocBox(props: { text: string; label?: string; labelClassName?: string }) {
  return (
    <div className={toolResultBlockClass}>
      {props.label && (
        <div className={toolResultBlockLabelRowClass}>
          <p className={cn(toolResultBlockLabelClass, props.labelClassName)}>{props.label}</p>
        </div>
      )}
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-text-primary">
        {props.text}
      </pre>
    </div>
  );
}

export function MemoryResult(props: { item: ToolActivityItem }) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools.memory;
  const item = props.item;
  const verb = memoryToolVerb(item.toolName);
  if (!verb || item.status === 'errored') return null;
  const args = memoryArgsOf(item);

  if (verb === 'search') {
    const entries = parseMemoryListResult(memoryResultText(item));
    if (entries.length === 0) return null;
    return (
      <ToolResultPanel variant="list">
        {entries.map((entry) => (
          <div
            key={entry.path}
            className="rounded-md px-2 py-1.5"
            data-maka-memory-file={entry.path}
          >
            <div className="flex items-baseline gap-3">
              <span className="truncate font-mono text-xs text-text-secondary">{entry.path}</span>
              {entry.updatedAt !== undefined && (
                <span className="ml-auto shrink-0 text-[0.6875rem] text-text-muted">
                  <RelativeTime ts={entry.updatedAt} />
                </span>
              )}
            </div>
            {entry.preview && (
              <div className="truncate text-[0.6875rem] text-text-muted">{entry.preview}</div>
            )}
          </div>
        ))}
      </ToolResultPanel>
    );
  }

  if (verb === 'read') {
    const docs = parseMemoryReadResult(memoryResultText(item)).filter((doc) => doc.body.length > 0);
    if (docs.length === 0) return null;
    return (
      <ToolResultPanel>
        {docs.map((doc, index) => (
          <DocBox
            key={doc.path ?? index}
            text={doc.body}
            {...(docs.length > 1 && doc.path ? { label: doc.path } : {})}
          />
        ))}
      </ToolResultPanel>
    );
  }

  if (item.toolName === TOOL_NAMES.memoryStrReplace) {
    if (item.status === 'running') return null;
    const oldStr = typeof args.old_str === 'string' ? args.old_str : '';
    const newStr = typeof args.new_str === 'string' ? args.new_str : '';
    if (!oldStr && !newStr) return null;
    return (
      <ToolResultPanel>
        {oldStr && <DocBox text={oldStr} label={copy.removed} labelClassName="text-danger" />}
        {newStr && <DocBox text={newStr} label={copy.added} labelClassName="text-accent" />}
      </ToolResultPanel>
    );
  }

  if (verb === 'save' || verb === 'update') {
    // The result of a write is a byte count; what was written is the argument.
    const content = typeof args.content === 'string' ? args.content : '';
    if (!content) return null;
    return (
      <ToolResultPanel>
        <DocBox text={content} />
      </ToolResultPanel>
    );
  }

  return null;
}
