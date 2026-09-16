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

import type {
  SandboxBoundaryExpansion,
  SandboxBoundarySettlement,
} from '@maka/core/sandbox-boundary';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';

import { sandboxBoundaryExpansionSchema } from './sandbox-boundary-declaration.js';
import type { MakaTool } from './tool-runtime.js';

/**
 * Refusal for a `RequestSandboxBoundary` call that cannot be carried out.
 *
 * Shared with `ToolRuntime.requestSandboxBoundary`, which is where the
 * production form of this failure is decided: ToolRuntime injects the context
 * callback unconditionally, so the guard below answers only an embedder that
 * assembles its own tool context. Two conditions, one thing to say, one place
 * to say it.
 */
export const SANDBOX_BOUNDARY_UNAVAILABLE =
  'RequestSandboxBoundary is not available on this surface, so the sandbox was not widened. ' +
  'Retrying will fail the same way — redo the work inside the paths already allowed, or tell the ' +
  'user which path needs access.';

export const REQUEST_SANDBOX_BOUNDARY_TOOL_NAME = TOOL_NAMES.requestSandboxBoundary;

export const SANDBOX_BOUNDARY_DENIED_FOR_TURN =
  'The user denied a sandbox boundary expansion for this Turn. Do not request another expansion. ' +
  'Continue only with the authority already available, or explain the remaining blocker.';

export const SANDBOX_BOUNDARY_FINALIZATION_PROMPT = [
  '<sandbox_boundary_finalization>',
  'Sandbox boundary negotiation cannot continue in this Turn.',
  'Do not call tools. Give the user a concise final status from the evidence already available.',
  'State what remains blocked and which existing-authority alternatives, if any, were tried.',
  '</sandbox_boundary_finalization>',
].join('\n');

export function buildRequestSandboxBoundaryTool(): MakaTool<
  { expansion: SandboxBoundaryExpansion; justification: string },
  SandboxBoundarySettlement
> {
  return {
    name: REQUEST_SANDBOX_BOUNDARY_TOOL_NAME,
    executionSemantics: 'exclusive_step',
    description: [
      'Ask the user to widen the session sandbox boundary so a local tool that answered sandbox_boundary_required can be retried.',
      '',
      '- Pass exactly the expansion that failure named (a path to read or write, or network access) — the smallest one that unblocks the call — and a one-sentence justification the user can judge.',
      '- The turn pauses until the user decides. On approval the boundary revision advances and the original call can be repeated as it was; on denial, do not request another expansion in this turn — finish with what the boundary allows and say what you could not do.',
      '- It never grants anything by itself; a call outside any boundary request is refused. Bash can declare a needed boundary up front instead, through its boundary_intent and required_boundary fields.',
    ].join('\n'),
    parameters: z
      .object({
        expansion: sandboxBoundaryExpansionSchema,
        justification: z.string().min(1),
      })
      .strict(),
    impl: ({ expansion, justification }, context) => {
      if (!context.requestSandboxBoundary) {
        throw new Error(SANDBOX_BOUNDARY_UNAVAILABLE);
      }
      return context.requestSandboxBoundary(expansion, justification);
    },
  };
}
