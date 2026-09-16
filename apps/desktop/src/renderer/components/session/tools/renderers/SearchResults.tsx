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

// Grep and Glob, in the reference design's `list` panel: one row per hit,
// nothing between the reader and the next path.
//
// These two used to land on the JSON renderer, which showed the same
// information as a pretty-printed object — correct, and useless, because the
// one thing a reader wants from a search result is to OPEN one of the hits,
// and no part of a `<pre>` is clickable. A list row is: the path is the
// button, the line and the matching text follow it, and the trailing meta
// carries the count.
//
// The cap is stated, never hidden. ripgrep's own limit and the tool's
// `head_limit` both cut the list, and a list that silently ends looks like a
// complete answer with fewer hits than there really were — so a capped result
// spends its last row saying how many it dropped.

import { memo } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../../icons/Anthropicon.js';
import { ToolResultPanel, ToolResultRow } from '../tool-result.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import {
  parseGrepRow,
  type GlobResultShape,
  type GrepResultShape,
} from '../../../../lib/tool-delivery-results.js';

/** The last row of a capped list. Not a row that opens anything. */
function OmittedRow(props: { count: number }) {
  const copy = getTranscriptCopy(useUiLocale()).search;
  return (
    <ToolResultRow className="text-text-muted">
      {props.count > 0 ? copy.omitted(props.count) : copy.omittedUnknown}
    </ToolResultRow>
  );
}

export const GrepResult = memo(function GrepResult(props: {
  result: GrepResultShape;
  /** Opens the hit's file in the right pane's Files face. */
  onOpenFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).search;
  const onOpenFile = props.onOpenFile;
  if (props.result.matches.length === 0) {
    return (
      <ToolResultPanel variant="list">
        <p className="px-2 py-1.5 text-[0.8125rem] leading-[1.125rem] text-text-muted">
          {copy.noMatches}
        </p>
      </ToolResultPanel>
    );
  }
  return (
    <ToolResultPanel variant="list">
      {props.result.matches.map((match, index) => {
        const row = parseGrepRow(match, props.result.mode);
        return (
          <ToolResultRow
            key={`${match}-${index}`}
            icon={<Anthropicon name="file" size={12} />}
            title={match}
            {...(onOpenFile
              ? { ariaLabel: copy.openPath(row.path), onClick: () => onOpenFile(row.path) }
              : {})}
            {...(row.count !== undefined ? { meta: copy.occurrences(row.count) } : {})}
          >
            {/* The path reads as the link and the match as its context, which
                is the split a reader scans by — one column of paths down the
                left, the text beside it. */}
            <span className="font-mono" data-maka-search-row={row.path}>
              {row.path}
              {row.line !== undefined && <span className="text-text-muted">{`:${row.line}`}</span>}
              {row.text !== undefined && row.text.trim() && (
                <span className="text-text-muted">{`  ${row.text.trim()}`}</span>
              )}
            </span>
          </ToolResultRow>
        );
      })}
      {props.result.truncated && <OmittedRow count={props.result.omitted} />}
    </ToolResultPanel>
  );
});

export const GlobResult = memo(function GlobResult(props: {
  result: GlobResultShape;
  onOpenFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).search;
  const onOpenFile = props.onOpenFile;
  if (props.result.files.length === 0) {
    return (
      <ToolResultPanel variant="list">
        <p className="px-2 py-1.5 text-[0.8125rem] leading-[1.125rem] text-text-muted">
          {copy.noFiles}
        </p>
      </ToolResultPanel>
    );
  }
  return (
    <ToolResultPanel variant="list">
      {props.result.files.map((path, index) => (
        <ToolResultRow
          key={`${path}-${index}`}
          icon={<Anthropicon name="file" size={12} />}
          title={path}
          {...(onOpenFile
            ? { ariaLabel: copy.openPath(path), onClick: () => onOpenFile(path) }
            : {})}
        >
          <span className="font-mono" data-maka-search-row={path}>
            {path}
          </span>
        </ToolResultRow>
      ))}
      {props.result.truncated && <OmittedRow count={0} />}
    </ToolResultPanel>
  );
});
