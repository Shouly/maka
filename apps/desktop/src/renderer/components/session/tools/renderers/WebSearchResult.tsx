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

// `web_search` and `web_search_error`.
//
// PLAIN TEXT, always. A search result is attacker-controlled text arriving
// from an arbitrary site, so it is never rendered as markdown and never as
// HTML — the row shows the title, the snippet and the host, and nothing in it
// can become a link the model wrote or a script the page wrote. Opening a
// result goes through the host's external-link path, which applies its own
// policy, rather than through an anchor the renderer navigates.

import { memo } from 'react';
import type { ToolResultContent } from '@maka/core/events';
import { getToolActivityCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../../icons/Anthropicon.js';
import { ToolResultPanel, ToolResultRow, toolResultBlockClass } from '../tool-result.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';

type WebSearchContent = Extract<ToolResultContent, { kind: 'web_search' }>;
type WebSearchErrorContent = Extract<ToolResultContent, { kind: 'web_search_error' }>;

/** The host, for the trailing meta. Never parsed for anything but display. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const WebSearchResult = memo(function WebSearchResult(props: {
  result: WebSearchContent;
  onOpenExternal: (url: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getToolActivityCopy(locale).result;
  if (props.result.rows.length === 0) {
    return (
      <ToolResultPanel variant="list">
        <p className="px-2 py-1.5 text-[0.8125rem] leading-[1.125rem] text-text-muted">
          {copy.webNoResults}
        </p>
      </ToolResultPanel>
    );
  }
  return (
    <ToolResultPanel variant="list">
      {props.result.rows.map((row, index) => (
        <ToolResultRow
          key={`${row.url}-${index}`}
          icon={<Anthropicon name="globe" size={12} />}
          meta={hostOf(row.url)}
          title={row.snippet}
          ariaLabel={row.title}
          onClick={() => props.onOpenExternal(row.url)}
        >
          {row.title}
        </ToolResultRow>
      ))}
    </ToolResultPanel>
  );
});

export const WebSearchErrorResult = memo(function WebSearchErrorResult(props: {
  result: WebSearchErrorContent;
}) {
  const locale = useUiLocale();
  const toolCopy = getToolActivityCopy(locale).result;
  const copy = getTranscriptCopy(locale).result;
  const guidance =
    props.result.reason in toolCopy.webGuidance
      ? toolCopy.webGuidance[props.result.reason as keyof typeof toolCopy.webGuidance]
      : undefined;
  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        <p className="text-xs leading-5 text-danger">{props.result.message}</p>
        {guidance && <p className="text-xs leading-5 text-text-muted">{guidance}</p>}
        <p className="text-[0.6875rem] leading-none text-text-muted">
          {copy.failureClass(props.result.reason)}
        </p>
      </div>
    </ToolResultPanel>
  );
});
