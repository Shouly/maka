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

// One step on a turn's tool timeline.
//
// The header is a real `<button>` with `aria-expanded`, which is what makes
// Space and Enter both open the row without a keydown handler of our own — a
// div with `role="button"` would have needed one, and would have got Space
// wrong (it scrolls the page).
//
// The sandbox affordance sits INSIDE the row rather than in the turn's error
// banner, because the thing to do about it is specific to this call: raise the
// permission mode and run the turn again. A turn-level banner would have to
// guess which call it meant.

import { memo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  getToolActivityCopy,
  parseMcpToolName,
  useUiLocale,
  type ToolActivityItem,
} from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { isNoteItem } from '../../../lib/tool-delivery-results.js';
import { ShimmerTitle } from '../../ui/shimmer-title.js';
import { cn } from '../../../lib/cn.js';
import { getMcpCatalog } from '../../../lib/ported/mcp-catalog.js';
import { McpBrandMark, hasMcpBrandMark } from '../../../lib/ported/mcp-brand-marks.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { renderToolContent, type ToolContentContext } from './registry.js';
import {
  StepGap,
  StepLine,
  stepBodyClass,
  stepBodyInteractiveClass,
  StepDot,
  stepIconColClass,
  stepRowClass,
} from './tool-result.js';
import {
  canExpandTool,
  toolFailureMark,
  toolRowIcon,
  toolActivityKindOf,
  toolRowFailure,
  toolRowMeta,
  toolRowStatus,
  toolRowStatusLabel,
  toolRowTitle,
} from './tool-presentation.js';
import { ToolFailureBlock } from './ToolFailureBlock.js';

/**
 * The mark on a failed row.
 *
 * A glyph rather than the word "Error", in the row's trailing slot rather than
 * on its title. That slot is where the word it replaced already lived, beside
 * the other things a row says about its outcome; put next to the title it sat
 * between the words and the caret that opens the row, wedged into the one gap
 * that belongs to the affordance. The title itself is never recoloured — it is
 * the line that has to stay readable down a column of twenty rows, and the
 * weight of a failure belongs in the block that carries its reason.
 */
function FailureMark(props: {
  failure: NonNullable<ReturnType<typeof toolRowFailure>>;
  copy: ReturnType<typeof getToolActivityCopy>;
}) {
  // The label goes on the wrapper, not on the glyph: `Anthropicon` takes no
  // `aria-label` — icons there are decorative and the containing control owns
  // the name — so passing one was dropped on the floor, and the mark that is
  // now the row's ONLY sign of failure said nothing at all to a screen reader.
  return (
    <span
      role="img"
      aria-label={props.copy.failure.mark[props.failure.kind]}
      className={cn(
        'flex shrink-0 items-center',
        props.failure.tone === 'danger' ? 'text-danger' : 'text-warning',
      )}
    >
      {/* 16, not the caret's 12: this is a status glyph read at a glance down a
          column, not a hover affordance. It is the size the rest of the session
          view gives an inline warning, and it sits flush in the trailing
          group's 16px line box. */}
      <Anthropicon name={toolFailureMark(props.failure)} size={16} />
    </span>
  );
}

function McpServerMark(props: { serverId: string; locale: Parameters<typeof getMcpCatalog>[0] }) {
  const entry = getMcpCatalog(props.locale).find((row) => row.id === props.serverId);
  if (!entry || !hasMcpBrandMark(entry.id)) return null;
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center text-text-muted [&>svg]:size-full [&_path]:fill-current"
      title={entry.name}
    >
      <McpBrandMark entry={entry} />
    </span>
  );
}

export interface ToolRowProps {
  item: ToolActivityItem;
  isFirst: boolean;
  isLast: boolean;
  context: ToolContentContext;
  /** Raises the permission mode and re-runs the turn; absent when neither is possible. */
  onSwitchToFullAccessAndRetry?: () => void;
  /** True while that switch is in flight. */
  switching?: boolean;
}

export const ToolRow = memo(function ToolRow(props: ToolRowProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const toolCopy = getToolActivityCopy(locale);
  const [expanded, setExpanded] = useState(false);

  const item = props.item;
  const status = toolRowStatus(item);
  const running = status === 'running';
  const title = toolRowTitle(item, locale);
  const statusLabel = toolRowStatusLabel(item, locale);
  const meta = toolRowMeta(item, locale);
  const expandable = canExpandTool(item);
  // A note that stayed in the timeline: its row IS the message, so it carries
  // a dot rather than a tool glyph and never opens.
  const isNote = isNoteItem(item);
  const mcp = parseMcpToolName(item.toolName);
  const failure = toolRowFailure(item);

  const header = (
    <div className={stepRowClass}>
      <div
        className={cn(
          stepIconColClass,
          'text-text-muted transition-colors duration-200',
          'group-has-[button:hover]/step:text-text-secondary',
          'group-has-[button:focus-visible]/step:text-text-secondary',
        )}
        aria-hidden="true"
      >
        {isNote ? <StepDot /> : <Anthropicon name={toolRowIcon(item)} size={20} />}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {expandable ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? copy.tools.collapse(title) : copy.tools.expand(title)}
            onClick={() => setExpanded((open) => !open)}
            className={cn(stepBodyClass, stepBodyInteractiveClass)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {mcp && <McpServerMark serverId={mcp.serverId} locale={locale} />}
              {running ? (
                <ShimmerTitle
                  title={title}
                  isLoading
                  // Same box and same colour as the settled title, or it hops
                  // when the sweep stops: `leading-5` because these sit in an
                  // `items-center` row, and the base colour because a note
                  // settles a shade brighter than a tool row.
                  className={cn(
                    'min-w-0 truncate text-sm leading-5',
                    !isNote && '[--base-color:var(--text-muted)]',
                  )}
                />
              ) : (
                <span
                  className={cn(
                    'min-w-0 truncate text-sm leading-5 text-text-muted transition-colors duration-200',
                    'group-hover/row:text-text-secondary group-focus-visible/row:text-text-secondary',
                  )}
                >
                  {title}
                </span>
              )}
              <Anthropicon
                name="caretRight"
                size={12}
                className={cn(
                  'shrink-0 text-text-muted opacity-0 transition-[opacity,transform] duration-150',
                  'group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
                  expanded && 'rotate-90',
                )}
              />
            </span>
            {(meta || statusLabel || failure) && (
              <span className="flex shrink-0 items-center gap-2 text-xs leading-4 text-text-muted">
                {meta && <span className="max-w-48 truncate">{meta}</span>}
                {statusLabel && <span className="shrink-0">{statusLabel}</span>}
                {failure && <FailureMark failure={failure} copy={toolCopy} />}
              </span>
            )}
          </button>
        ) : (
          <div className={stepBodyClass}>
            <span className="flex min-w-0 items-center gap-1.5">
              {mcp && <McpServerMark serverId={mcp.serverId} locale={locale} />}
              {running ? (
                // The shimmer used to live only in the expandable branch, so a
                // row that cannot be opened sat still for its whole run.
                <ShimmerTitle
                  title={title}
                  isLoading
                  // Same box and same colour as the settled title, or it hops
                  // when the sweep stops: `leading-5` because these sit in an
                  // `items-center` row, and the base colour because a note
                  // settles a shade brighter than a tool row.
                  className={cn(
                    'min-w-0 truncate text-sm leading-5',
                    !isNote && '[--base-color:var(--text-muted)]',
                  )}
                />
              ) : (
                <span
                  className={cn(
                    'min-w-0 truncate text-sm leading-5',
                    // A note carries the model's own words to the reader, not a
                    // label for work it did — one step up the ladder from the
                    // rows around it, which say what ran.
                    isNote ? 'text-text-secondary' : 'text-text-muted',
                  )}
                >
                  {title}
                </span>
              )}
            </span>
            {(meta || statusLabel || failure) && (
              <span className="flex shrink-0 items-center gap-2 text-xs leading-4 text-text-muted">
                {meta && <span className="max-w-48 truncate">{meta}</span>}
                {statusLabel && <span className="shrink-0">{statusLabel}</span>}
                {failure && <FailureMark failure={failure} copy={toolCopy} />}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const detail = (
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          {failure && (
            <ToolFailureBlock
              failure={failure}
              {...(props.onSwitchToFullAccessAndRetry
                ? { onSwitchToFullAccessAndRetry: props.onSwitchToFullAccessAndRetry }
                : {})}
              {...(props.switching !== undefined ? { switching: props.switching } : {})}
            />
          )}
          {renderToolContent(item, props.context)}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="flex shrink-0 flex-col" data-maka-tool-row={item.toolUseId}>
      <StepGap on={!props.isFirst} />
      <div className="rounded-lg">
        {header}
        <div className="flex flex-row">
          <StepLine on={!props.isLast} />
          <div className="min-w-0 flex-1">{detail}</div>
        </div>
      </div>
      <StepGap on={!props.isLast} />
    </div>
  );
});
