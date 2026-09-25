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

// One line in a run's card — the reference's `TurnStatusStep`.
//
// No icon and no timeline rail: the verb is the row's identity, in muted ink,
// and the thing it acted on follows in primary ink ("Read **app.tsx**",
// "Searched **useStore**"). A failed row keeps its words and adds a red
// "Failed"; a row with something to show carries a chevron right after its
// text and opens in place, inside the card.
//
// The header is a real `<button>` with `aria-expanded` when the row opens, so
// Space and Enter work without a keydown handler of our own.
//
// The sandbox affordance sits in the opened row rather than in the turn's error
// banner, because what to do about it is specific to this call: raise the
// permission mode and run the turn again.

import { memo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { parseMcpToolName, useUiLocale, type ToolActivityItem } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { ShimmerTitle } from '../../ui/shimmer-title.js';
import { cn } from '../../../lib/cn.js';
import { getMcpCatalog } from '../../../lib/ported/mcp-catalog.js';
import { McpBrandMark, hasMcpBrandMark } from '../../../lib/ported/mcp-brand-marks.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { reasoningHeadline } from '../../../lib/reasoning-label.js';
import { ThinkingText } from '../ThinkingStep.js';
import { renderToolContent, type ToolContentContext } from './registry.js';
import {
  canExpandTool,
  toolRowFailure,
  toolRowStatus,
  toolRowStatusLabel,
  toolStepLabel,
} from './tool-presentation.js';
import { ToolFailureBlock } from './ToolFailureBlock.js';

/** A step row: the card's padding, one 20px line. */
const stepRowClass =
  'group/step flex w-full min-w-0 items-center gap-1.5 px-3 py-2 text-left text-sm leading-5';

const stepToggleClass =
  'cursor-pointer outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:rounded-lg';

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

/** The chevron right after a row's text: `›` closed, `⌄` open. */
function StepChevron(props: { open: boolean }) {
  return (
    <Anthropicon
      name="caretRight"
      size={12}
      className={cn(
        'shrink-0 text-text-muted transition-transform duration-150',
        props.open && 'rotate-90',
      )}
    />
  );
}

/** The opened part of a row, animated open and shut. */
function StepPanel(props: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {props.open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div className="pb-1">{props.children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface TurnStatusToolStepProps {
  item: ToolActivityItem;
  context: ToolContentContext;
  /** Raises the permission mode and re-runs the turn; absent when neither is possible. */
  onSwitchToFullAccessAndRetry?: () => void;
  /** True while that switch is in flight. */
  switching?: boolean;
}

export const TurnStatusToolStep = memo(function TurnStatusToolStep(props: TurnStatusToolStepProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const [open, setOpen] = useState(false);

  const item = props.item;
  const running = toolRowStatus(item) === 'running';
  const label = toolStepLabel(item, locale);
  const statusLabel = toolRowStatusLabel(item, locale);
  const failure = toolRowFailure(item);
  const expandable = canExpandTool(item);
  const mcp = parseMcpToolName(item.toolName);

  const words = running ? (
    // One sweep over the whole line while it runs; the two inks return when
    // it settles.
    <ShimmerTitle
      title={label.text}
      isLoading
      className="min-w-0 truncate text-sm leading-5 [--base-color:var(--text-muted)]"
    />
  ) : (
    <span className="min-w-0 truncate" title={label.text}>
      <span className="text-text-muted">{label.lead}</span>
      {label.object && (
        <>
          {' '}
          <span
            className={cn('text-text-primary', label.objectIsCode && 'font-mono text-[0.8125rem]')}
          >
            {label.object}
          </span>
        </>
      )}
      {label.detail && <span className="text-text-muted"> {label.detail}</span>}
    </span>
  );

  const trailing = (
    <>
      {mcp && <McpServerMark serverId={mcp.serverId} locale={locale} />}
      {statusLabel && (
        <span className="shrink-0 text-xs leading-4 text-text-muted">{statusLabel}</span>
      )}
      {failure && (
        <span
          className={cn('shrink-0', failure.tone === 'danger' ? 'text-danger' : 'text-warning')}
        >
          {copy.tools.step.failed}
        </span>
      )}
    </>
  );

  return (
    <div
      className="flex min-w-0 flex-col"
      data-maka-turn-status-step={item.toolUseId}
      data-state={running ? 'busy' : failure ? 'failed' : 'done'}
    >
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? copy.tools.collapse(label.text) : copy.tools.expand(label.text)}
          onClick={() => setOpen((value) => !value)}
          className={cn(stepRowClass, stepToggleClass)}
        >
          {words}
          {trailing}
          <StepChevron open={open} />
        </button>
      ) : (
        <div className={stepRowClass}>
          {words}
          {trailing}
        </div>
      )}
      {expandable && (
        <StepPanel open={open}>
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
        </StepPanel>
      )}
    </div>
  );
});

/**
 * A run of reasoning, as a step, named by its first line — the reference's
 * label — and opening onto the whole text. Before any line has words it reads
 * "Thinking…" while live and "Thought process" once done.
 *
 * Deviation: the reference drops the first line from the opened text, and does
 * not open a one-line block at all, because its label is a short generated
 * summary. Maka's label is the model's own first line, often a long paragraph
 * cut by the row, so the opened text keeps it whole rather than lose the rest.
 */
export const TurnStatusThinkingStep = memo(function TurnStatusThinkingStep(props: {
  text: string;
  live: boolean;
  truncated: boolean;
  onOpenExternal?: (url: string) => void;
}) {
  const copy = getTranscriptCopy(useUiLocale());
  const [open, setOpen] = useState(false);
  const label =
    reasoningHeadline(props.text) ??
    (props.live ? copy.tools.thinkingActive : copy.tools.thinkingOnly);
  return (
    <div className="flex min-w-0 flex-col" data-maka-thinking="">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? copy.tools.collapse(label) : copy.tools.expand(label)}
        onClick={() => setOpen((value) => !value)}
        className={cn(stepRowClass, stepToggleClass)}
      >
        {props.live ? (
          <ShimmerTitle
            title={label}
            isLoading
            className="min-w-0 truncate text-sm leading-5 [--base-color:var(--text-muted)]"
          />
        ) : (
          <span className="min-w-0 truncate text-text-muted">{label}</span>
        )}
        <StepChevron open={open} />
      </button>
      <StepPanel open={open}>
        <div className="px-3 pb-2">
          <ThinkingText
            text={props.text}
            {...(props.live ? { live: true } : {})}
            {...(props.onOpenExternal ? { onOpenExternal: props.onOpenExternal } : {})}
          />
          {props.truncated && (
            <p className="mt-1 text-xs leading-4 text-text-muted">{copy.thinking.truncated}</p>
          )}
        </div>
      </StepPanel>
    </div>
  );
});

/**
 * Text the model wrote between two steps, folded out of the answer. It is the
 * model narrating its own work, so it reads as part of the record: muted, in
 * the card, in the order it was said.
 */
export const TurnStatusNarrationStep = memo(function TurnStatusNarrationStep(props: {
  text: string;
  live: boolean;
  onOpenExternal?: (url: string) => void;
}) {
  return (
    <div className="min-w-0 px-3 py-2" data-maka-narration="">
      <ThinkingText
        text={props.text}
        {...(props.live ? { live: true } : {})}
        {...(props.onOpenExternal ? { onOpenExternal: props.onOpenExternal } : {})}
      />
    </div>
  );
});
