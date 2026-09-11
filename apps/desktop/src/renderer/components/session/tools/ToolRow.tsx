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
  isRequiresBypassToolResult,
  useUiLocale,
  type ToolActivityItem,
} from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
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
  stepIconColClass,
  stepRowClass,
} from './tool-result.js';
import {
  canExpandTool,
  toolActivityIcon,
  toolActivityKindOf,
  toolRowStatus,
  toolRowStatusLabel,
  toolRowTitle,
} from './tool-presentation.js';

/**
 * `mcp__<server>__<tool>` is the name the runtime mints for a proxied MCP tool
 * (`packages/runtime/src/mcp-tools.ts`). Splitting it back out is how a row
 * says which server answered without the transcript carrying a second field.
 */
export function parseMcpToolName(name: string): { serverId: string; toolName: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice('mcp__'.length);
  const separator = rest.indexOf('__');
  if (separator <= 0) return undefined;
  return { serverId: rest.slice(0, separator), toolName: rest.slice(separator + 2) };
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
  const expandable = canExpandTool(item);
  const mcp = parseMcpToolName(item.toolName);
  const requiresBypass = isRequiresBypassToolResult(item.result);
  const showSandbox = status === 'sandbox_blocked' || requiresBypass;

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
        <Anthropicon name={toolActivityIcon(toolActivityKindOf(item))} size={20} />
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
                <ShimmerTitle title={title} isLoading className="min-w-0 truncate text-sm" />
              ) : (
                <span
                  className={cn(
                    'min-w-0 truncate text-sm leading-5 text-text-muted transition-colors duration-200',
                    'group-hover/row:text-text-secondary group-focus-visible/row:text-text-secondary',
                    status === 'errored' && 'text-danger',
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
            {statusLabel && (
              <span
                className={cn(
                  'shrink-0 text-xs leading-4',
                  status === 'errored' || status === 'sandbox_blocked'
                    ? 'text-danger'
                    : 'text-text-muted',
                )}
              >
                {statusLabel}
              </span>
            )}
          </button>
        ) : (
          <div className={stepBodyClass}>
            <span className="flex min-w-0 items-center gap-1.5">
              {mcp && <McpServerMark serverId={mcp.serverId} locale={locale} />}
              <span className="min-w-0 truncate text-sm leading-5 text-text-muted">{title}</span>
            </span>
            {statusLabel && (
              <span className="shrink-0 text-xs leading-4 text-text-muted">{statusLabel}</span>
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
          {showSandbox && (
            <div className="mx-2.5 mt-1 flex flex-col gap-2 rounded-lg border-[0.5px] border-danger-line bg-danger-subtle p-3">
              <p className="text-xs font-medium leading-5 text-danger">
                {requiresBypass ? toolCopy.requiresBypass.title : toolCopy.sandboxBlocked.title}
              </p>
              <p className="text-xs leading-5 text-text-secondary">
                {requiresBypass
                  ? toolCopy.requiresBypass.description
                  : toolCopy.sandboxBlocked.description}
              </p>
              {props.onSwitchToFullAccessAndRetry && (
                <button
                  type="button"
                  onClick={props.onSwitchToFullAccessAndRetry}
                  disabled={props.switching}
                  className="ui-control-squish ui-control-squish-ghost inline-flex h-7 w-fit cursor-pointer items-center rounded-md px-2 text-xs leading-5 text-danger outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50"
                >
                  {props.switching ? copy.sandbox.pending : copy.sandbox.action}
                </button>
              )}
            </div>
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
