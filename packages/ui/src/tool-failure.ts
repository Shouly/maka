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

// What a failed call looks like — decided once, read at every altitude.
//
// The row, the collapsed group's summary and the turn's banner all used to
// answer this separately, and only the row answered it at all: a finished
// group said nothing about a failure inside it, and a turn that recovered from
// one said nothing either. One function means they cannot disagree, and it is
// pure, so the answer is testable without a DOM.
//
// Nothing here keys on a TOOL NAME. A name is an open set — MCP servers and
// skills add tools at runtime — so a table over names is a table that is
// permanently out of date. `ToolFailure.kind` is a closed set the runtime
// owns, and `ToolFailure.class` is a closed set too, which is why a remedy may
// be looked up from it.

import type { ToolFailure, ToolFailureKind } from '@maka/core/events';
import { toolActivityPresentationStatus, type ToolActivityItem } from './materialize.js';

/**
 * What a reader could do about a failure, when a control exists for it.
 *
 * Derived from the runtime's class rather than declared in the contract: the
 * runtime knows what went wrong, the client knows what it can offer, and those
 * are not the same question — a Host with no permission control still receives
 * the same `denied`.
 */
export type ToolFailureRemedy = 'raise_permission' | 'bypass';

export interface ToolFailurePresentation {
  readonly kind: ToolFailureKind;
  /**
   * How loud to be. `refused` and `denied` are warnings: the work did not
   * happen but nothing is broken, and in the denied case the reader is one
   * setting away from it working. Only `failed` is danger.
   *
   * Matches how the turn banner already grades itself
   * (`deriveFailedTurnSeverity`), so a row and the banner above it cannot
   * disagree about how bad the same event was.
   */
  readonly tone: 'warning' | 'danger';
  readonly class?: string;
  readonly message?: string;
  readonly remedy?: ToolFailureRemedy;
}

const REMEDY_BY_CLASS: Readonly<Record<string, ToolFailureRemedy>> = {
  requires_bypass: 'bypass',
  sandbox_boundary_required: 'raise_permission',
  sandbox_denial: 'raise_permission',
};

/**
 * The failure a row carries, or undefined when it did not fail.
 *
 * Asked of the status the row DISPLAYS, not of `item.status`. A background
 * command is the case that separates them: the call that launched it succeeded
 * and stays `completed` forever, while the process it started goes on to fail,
 * and only `toolActivityPresentationStatus` folds the run's own status back in.
 * Keyed on `item.status` this returned nothing for exactly that row — and since
 * the failure now carries the mark that replaced the word "Error", a background
 * command that died left no trace on its collapsed header at all.
 *
 * `interrupted` is not a failure: a call the user stopped did not go wrong.
 * An `errored` row with no envelope reads as `failed`, which is what an
 * unannotated throw means and what every row meant before the envelope
 * existed — an imported session, or a Host that predates it.
 */
export function toolFailureOf(item: ToolActivityItem): ToolFailurePresentation | undefined {
  if (toolActivityPresentationStatus(item) !== 'errored') return undefined;
  return describeToolFailure(item.failure);
}

function describeToolFailure(failure: ToolFailure | undefined): ToolFailurePresentation {
  const kind = failure?.kind ?? 'failed';
  const remedy = failure?.class ? REMEDY_BY_CLASS[failure.class] : undefined;
  return {
    kind,
    tone: kind === 'failed' ? 'danger' : 'warning',
    ...(failure?.class ? { class: failure.class } : {}),
    ...(failure?.message ? { message: failure.message } : {}),
    ...(remedy ? { remedy } : {}),
  };
}
