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

import { defineObjectShape, hasExactShape, isRecord } from './record-schema.js';

export type ModelFailureKind =
  | 'abort'
  | 'auth'
  | 'context_overflow'
  | 'network'
  | 'provider_capacity'
  | 'provider_billing'
  | 'provider_unavailable'
  | 'rate_limit'
  | 'request_rejected'
  | 'stream_truncated'
  | 'timeout'
  | 'unknown'
  // Answers about the organisation's side of a request: from its gateway, from
  // the account that signs its requests, or from the provider about the
  // organisation's own account there. None is retried: each waits on the
  // person, their administrator, or time.
  /** The organisation's model allowance for this period is used up. */
  | 'organization_quota'
  /** The organisation has not made this model available to the person. */
  | 'organization_model_denied'
  /** The organisation account has to be signed in again. */
  | 'organization_sign_in'
  /** The organisation server no longer serves this version of the app. */
  | 'organization_upgrade'
  /**
   * The provider refused the organisation's account with it (its key,
   * permissions or balance), which only the administrator can fix.
   */
  | 'organization_provider_account';
export const MODEL_FAILURE_MESSAGE_MAX_BYTES = 2 * 1024;

const ORGANIZATION_QUOTA_MESSAGE = 'Organization model allowance used up; it resets at ';

/**
 * The failure message of an `organization_quota` failure: it carries the
 * moment the allowance resets, which the person is told in their own time.
 */
export function organizationQuotaFailureMessage(resetsAt: number | undefined): string {
  // A time no date can hold says nothing about when; it is left out, not thrown.
  const when = resetsAt === undefined ? undefined : new Date(resetsAt);
  return when === undefined || Number.isNaN(when.getTime())
    ? 'Organization model allowance used up'
    : `${ORGANIZATION_QUOTA_MESSAGE}${when.toISOString()}`;
}

/** When the allowance resets (epoch ms), read back from that message. */
export function organizationQuotaResetsAt(message: string | undefined): number | undefined {
  if (!message?.startsWith(ORGANIZATION_QUOTA_MESSAGE)) return undefined;
  const resetsAt = Date.parse(message.slice(ORGANIZATION_QUOTA_MESSAGE.length).split(/\s/)[0]!);
  return Number.isFinite(resetsAt) ? resetsAt : undefined;
}

export type ModelRetryDecision =
  | { decision: 'exhausted'; attempts: number }
  | { decision: 'declined'; because: 'side_effects' | 'observable_output' | 'policy' | 'budget' };

const EXHAUSTED_SHAPE = defineObjectShape<Extract<ModelRetryDecision, { decision: 'exhausted' }>>()(
  ['decision', 'attempts'],
  [],
);
const DECLINED_SHAPE = defineObjectShape<Extract<ModelRetryDecision, { decision: 'declined' }>>()(
  ['decision', 'because'],
  [],
);

export function isModelRetryDecision(value: unknown): value is ModelRetryDecision {
  if (!isRecord(value)) return false;
  switch (value.decision) {
    case 'exhausted':
      return (
        hasExactShape(value, EXHAUSTED_SHAPE) &&
        Number.isSafeInteger(value.attempts) &&
        Number(value.attempts) > 0
      );
    case 'declined':
      return (
        hasExactShape(value, DECLINED_SHAPE) &&
        (value.because === 'side_effects' ||
          value.because === 'observable_output' ||
          value.because === 'policy' ||
          value.because === 'budget')
      );
    default:
      return false;
  }
}
