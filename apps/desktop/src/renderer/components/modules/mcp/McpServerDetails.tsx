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

// Everything about one server that does not fit on its row.
//
// The pre-rewrite page put this in an inspector pane beside the list; here it
// opens UNDER the row, because the list page has no second column and a
// dialog would hide the row the facts belong to. Same facts, same order as
// that inspector: transport, endpoint, state, negotiated protocol, then the
// two long things — the tool names and the stderr tail.
//
// stderr is shown for stdio servers only, and only when the Host actually
// captured lines: a remote server has no process to have written any, and an
// empty <pre> reads as "it printed nothing" rather than "there is nothing to
// print".

import type { ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import { isMcpStdioConfig } from '@maka/core/mcp';
import {
  connectorEndpoint,
  connectorStateLabel,
  connectorTransportLabel,
  type ConnectorRow,
} from './connectors-list.js';
import { getMcpCopy } from '../../../locales/mcp-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';
import { getConnectorsPageCopy } from '../../../locales/connectors-page-copy.js';

export function McpServerDetails(props: { id: string; row: ConnectorRow }) {
  const locale = useUiLocale();
  const copy = getMcpCopy(locale);
  const modules = getModulesCopy(locale).mcp;
  const connectors = getConnectorsPageCopy(locale);
  const { row } = props;
  const status = row.status;
  const tools = status?.tools ?? [];
  const negotiated =
    status?.state === 'connected' && status.negotiatedProtocol
      ? copy.detail.negotiatedProtocol(
          status.negotiatedProtocol.era,
          status.negotiatedProtocol.revision,
        )
      : undefined;
  const stderr = isMcpStdioConfig(row.config) ? (status?.stderrTail ?? []) : [];

  return (
    <div
      id={props.id}
      data-maka-contract="mcp-server-details"
      data-mcp-server-id={row.id}
      className="flex flex-col gap-3 border-b border-hairline pb-4 pl-12 pr-2 last:border-b-0"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs leading-5">
        <Fact label={copy.detail.transport}>{connectorTransportLabel(row, copy)}</Fact>
        <Fact label={copy.detail.endpoint}>
          <code className="break-all font-mono">{connectorEndpoint(row.config)}</code>
        </Fact>
        <Fact label={copy.detail.statusLabel}>{connectorStateLabel(row, copy, modules)}</Fact>
        {negotiated && <Fact label={copy.detail.protocolLabel}>{negotiated}</Fact>}
      </dl>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium leading-4 text-text-secondary">
          {copy.detail.toolsLabel}
          <span className="pl-2 font-normal text-text-muted">{copy.row.tools(tools.length)}</span>
        </h3>
        {tools.length === 0 ? (
          <p className="text-xs leading-4 text-text-muted">{connectors.details.toolsEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
              <li
                key={tool.name}
                title={tool.description ?? tool.name}
                className="rounded-md bg-alpha-1 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-4 text-text-secondary"
              >
                {tool.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      {stderr.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium leading-4 text-text-secondary">
            {connectors.details.stderrLabel}
            <span className="pl-2 font-normal text-text-muted">
              {connectors.details.stderrHint}
            </span>
          </h3>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2 font-mono text-[0.6875rem] leading-4 text-text-secondary">
            {stderr.join('\n')}
          </pre>
        </section>
      )}
    </div>
  );
}

function Fact(props: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{props.label}</dt>
      <dd className="min-w-0 text-text-secondary">{props.children}</dd>
    </>
  );
}
