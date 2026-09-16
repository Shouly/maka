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

import { buildWebFetchTool } from '@maka/runtime/web-fetch-tool';
import { createLocalWebFetchExecutor } from '@maka/runtime/local-web-fetch';
import {
  createProxiedFetchTransport,
  type ProxiedFetchProxy,
  type ProxiedFetchTransport,
} from '@maka/runtime/network/scoped-fetch-transport';
import { type MakaTool } from '@maka/runtime/tool-runtime';
import type { RuntimePolicyOperationCoordinator } from '@maka/storage/runtime-policy-stores';
import { toRuntimePolicyProxy } from './runtime-policy-proxy.js';

interface HostWebFetchServiceInput {
  readonly policy: Pick<RuntimePolicyOperationCoordinator, 'resolveHostOutboundExecution'>;
  readonly createFetchTransport?: (proxy: ProxiedFetchProxy | null) => ProxiedFetchTransport;
  /**
   * The auxiliary model that answers a WebFetch `prompt` against the page.
   * Read late: the plugin model is composed after the web services, so the
   * getter binds whatever is available when a fetch runs.
   */
  readonly answerModel?: () => HostWebFetchAnswerModel | undefined;
}

export interface HostWebFetchAnswerModel {
  generate(input: {
    readonly sessionId: string;
    readonly prompt: string;
    readonly system?: string;
    readonly maxOutputTokens?: number;
    readonly abortSignal: AbortSignal;
  }): Promise<{ readonly text: string }>;
}

const WEB_FETCH_ANSWER_SYSTEM =
  'You answer a question about one fetched web page. Use only the page content; when the page does not contain the answer, say so. Quote exact wording when the question asks for it. Be concise.';
const WEB_FETCH_ANSWER_TIMEOUT_MS = 60_000;

export interface HostWebFetchService {
  fetch(input: {
    readonly url: string;
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<string>;
  answer?(input: {
    readonly url: string;
    readonly prompt: string;
    readonly content: string;
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<string>;
}

export function createHostWebFetchService(input: HostWebFetchServiceInput): HostWebFetchService {
  const createFetchTransport = input.createFetchTransport ?? createProxiedFetchTransport;
  return {
    fetch: async ({ url, sessionId, abortSignal }) => {
      const resolved = await input.policy.resolveHostOutboundExecution();
      if (resolved.kind === 'privacy_mode') {
        throw new Error('WebFetch is disabled while privacy mode is active.');
      }
      if (resolved.kind === 'credential_not_configured') {
        throw new Error('Configure the network proxy credential before using WebFetch.');
      }
      const transport = createFetchTransport(
        toRuntimePolicyProxy(resolved.networkProxy, resolved.secretMaterial.networkProxy?.secret),
      );
      try {
        return await createLocalWebFetchExecutor({ fetch: transport.fetch }).fetch({
          url,
          sessionId,
          ...(abortSignal ? { abortSignal } : {}),
        });
      } finally {
        await transport.close();
      }
    },
    ...(input.answerModel
      ? {
          answer: async ({ url, prompt, content, sessionId, abortSignal }) => {
            const model = input.answerModel?.();
            if (!model) {
              return `No summarising model is available in this session, so the page content follows instead of an answer to the prompt.\n\n${content}`;
            }
            const signal = abortSignal
              ? AbortSignal.any([abortSignal, AbortSignal.timeout(WEB_FETCH_ANSWER_TIMEOUT_MS)])
              : AbortSignal.timeout(WEB_FETCH_ANSWER_TIMEOUT_MS);
            const result = await model.generate({
              sessionId,
              system: WEB_FETCH_ANSWER_SYSTEM,
              prompt: `Page: ${url}\n\nQuestion: ${prompt}\n\nPage content (markdown):\n${content}`,
              maxOutputTokens: 4_096,
              abortSignal: signal,
            });
            return result.text.trim() || 'The model returned no answer for this page.';
          },
        }
      : {}),
  };
}

export function createHostWebFetchTool(input: HostWebFetchServiceInput): MakaTool {
  return createHostWebFetchToolFromService(createHostWebFetchService(input));
}

export function createHostWebFetchToolFromService(service: HostWebFetchService): MakaTool {
  return buildWebFetchTool({
    fetch: ({ url, sessionId, abortSignal }) =>
      service.fetch({ url, sessionId, ...(abortSignal ? { abortSignal } : {}) }),
    ...(service.answer
      ? {
          answer: (input) => service.answer!(input),
        }
      : {}),
  });
}
