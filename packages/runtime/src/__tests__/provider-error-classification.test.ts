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

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { createJsonErrorResponseHandler, postJsonToApi } from '@ai-sdk/provider-utils';
import { RetryError } from 'ai';
import { z } from 'zod/v4';
import { organizationQuotaResetsAt } from '@maka/core/model-failure';

import {
  classifyError,
  MODEL_FAILURE_RETRY,
  providerFailureDiagnostic,
  providerModelFailure,
} from '../provider-error-classification.js';

describe('Organisation gateway failures', () => {
  // The gateway answers in the protocol's own error shape; `maka` and
  // `x-maka-error` say it is its own refusal, and why.
  const gatewayError = (
    statusCode: number,
    maka: Record<string, unknown>,
    message: string,
    headers: Record<string, string> = { 'x-should-retry': 'false' },
  ) => {
    const error = { type: statusCode === 429 ? 'rate_limit_error' : 'permission_error', message };
    return new APICallError({
      message,
      url: 'https://maka.example.com/model/anthropic/v1/messages',
      requestBodyValues: {},
      statusCode,
      responseHeaders: { 'x-maka-error': String(maka.code), ...headers },
      responseBody: JSON.stringify({ type: 'error', error, maka }),
      // What the SDK's schema keeps: `maka` is not in it.
      data: { type: 'error', error },
    });
  };

  test('a used-up allowance is not retried, and its failure says when it resets', () => {
    const resetsAt = Date.parse('2026-10-05T00:00:00.000Z');
    const failure = providerModelFailure(
      gatewayError(429, { code: 'quota_exceeded', retryAt: resetsAt }, 'Allowance used up', {
        'retry-after': '86400',
        'x-should-retry': 'false',
      }),
    );
    assert.equal(failure.kind, 'organization_quota');
    assert.equal(failure.retryable, false, 'not a throttle to wait out for a day');
    assert.equal(organizationQuotaResetsAt(failure.message), resetsAt);

    // A reset time no date can hold is left out rather than failing the classification.
    const beyond = providerModelFailure(
      gatewayError(429, { code: 'quota_exceeded', retryAt: 9e15 }, 'Allowance used up'),
    );
    assert.equal(beyond.kind, 'organization_quota');
    assert.equal(organizationQuotaResetsAt(beyond.message), undefined);
  });

  test("the gateway's other refusals read as what they are", () => {
    for (const [statusCode, code, kind] of [
      [403, 'model_not_allowed', 'organization_model_denied'],
      [401, 'unauthenticated', 'organization_sign_in'],
      [409, 'upgrade_required', 'organization_upgrade'],
      [400, 'invalid_request', 'request_rejected'],
      [502, 'upstream_unavailable', 'provider_unavailable'],
    ] as const) {
      const failure = providerModelFailure(gatewayError(statusCode, { code }, 'refused'));
      assert.equal(failure.kind, kind, code);
      // Every refusal says `x-should-retry: false`, which an unreachable provider's honours too.
      assert.equal(failure.retryable, false, code);
    }
  });

  test('an unreachable provider is retried only when the gateway says nothing was sent', () => {
    const unreachable = (shouldRetry: string) =>
      providerModelFailure(
        gatewayError(502, { code: 'upstream_unavailable' }, 'Provider unreachable', {
          'x-should-retry': shouldRetry,
        }),
      );
    assert.equal(unreachable('true').kind, 'provider_unavailable');
    assert.equal(unreachable('true').retryable, true);
    assert.equal(unreachable('false').retryable, false);
  });

  test('a refusal is known by its header or by its body, either alone', () => {
    const byHeader = new APICallError({
      message: 'Sign in again',
      url: 'https://maka.example.com/model/openai/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 401,
      responseHeaders: { 'x-maka-error': 'unauthenticated' },
      responseBody: JSON.stringify({ error: { message: 'Sign in again' } }),
    });
    assert.equal(classifyError(byHeader), 'organization_sign_in');
    const byBody = new APICallError({
      message: 'Not offered',
      url: 'https://maka.example.com/model/gemini/v1beta/models/x:generateContent',
      requestBodyValues: {},
      statusCode: 403,
      responseBody: JSON.stringify({
        error: { code: 403, status: 'PERMISSION_DENIED', message: 'Not offered' },
        maka: { code: 'model_not_allowed' },
      }),
    });
    assert.equal(classifyError(byBody), 'organization_model_denied');
  });

  test('a code the desktop does not map keeps the ordinary reading', () => {
    const failure = providerModelFailure(
      gatewayError(429, { code: 'rate_limited' }, 'Slow down', { 'retry-after': '3' }),
    );
    assert.equal(failure.kind, 'rate_limit');
    assert.equal(failure.retryable, true);
    assert.equal(failure.retryAfterMs, 3_000);
  });

  test('an account that cannot sign asks for a sign-in, or an update, wherever it surfaces', () => {
    const unavailable = (reason: string) =>
      Object.assign(new Error(`The organization account cannot sign this request: ${reason}`), {
        name: 'OrganizationAccountUnavailableError',
        reason,
      });
    for (const [reason, kind] of [
      ['signed_out', 'organization_sign_in'],
      ['sign_in_expired', 'organization_sign_in'],
      ['not_offered', 'organization_sign_in'],
      ['server_mismatch', 'organization_sign_in'],
      ['upgrade_required', 'organization_upgrade'],
      ['server_unreachable', 'network'],
    ] as const) {
      // Raised inside the SDK's fetch, it can arrive wrapped.
      const wrapped = new Error('request failed', { cause: unavailable(reason) });
      assert.equal(classifyError(wrapped), kind, reason);
    }
  });
});

describe("A provider's own answers on an organisation model", () => {
  const organizationModel = { organizationModel: true } as const;
  const providerError = (
    statusCode: number,
    body: unknown,
    headers: Record<string, string> = {},
    url = 'https://maka.example.com/model/anthropic/v1/messages',
  ) =>
    new APICallError({
      message: 'Provider error',
      url,
      requestBodyValues: {},
      statusCode,
      responseHeaders: headers,
      responseBody: JSON.stringify(body),
    });

  test("a refusal of the organisation's key, permissions or balance goes to its administrator", () => {
    for (const [statusCode, body] of [
      [
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      ],
      [403, { type: 'error', error: { type: 'permission_error', message: 'Not permitted' } }],
      [402, { error: { message: 'Payment required' } }],
      [429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }],
    ] as const) {
      const failure = providerModelFailure(providerError(statusCode, body), organizationModel);
      assert.equal(failure.kind, 'organization_provider_account', String(statusCode));
      assert.equal(failure.retryable, false);
      // The same answer on a person's own connection still sends them to their key.
      assert.notEqual(
        providerModelFailure(providerError(statusCode, body)).kind,
        'organization_provider_account',
      );
    }
    assert.equal(classifyError(providerError(401, { error: { message: 'bad key' } })), 'auth');
  });

  test('context overflow is recognised natively on every wire', () => {
    for (const [url, body] of [
      [
        'https://maka.example.com/model/anthropic/v1/messages',
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'prompt is too long: 250000 tokens > 200000 maximum',
          },
        },
      ],
      [
        'https://maka.example.com/model/openai/v1/chat/completions',
        {
          error: {
            message: "This model's maximum context length is 128000 tokens.",
            type: 'invalid_request_error',
            code: 'context_length_exceeded',
          },
        },
      ],
      [
        'https://maka.example.com/model/openai/v1/responses',
        {
          error: {
            message: 'Your input exceeds the context window of this model.',
            type: 'invalid_request_error',
            code: 'context_length_exceeded',
          },
        },
      ],
      [
        'https://maka.example.com/model/gemini/v1beta/models/gemini-2.5-pro:streamGenerateContent',
        {
          error: {
            code: 400,
            message:
              'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
            status: 'INVALID_ARGUMENT',
          },
        },
      ],
    ] as const) {
      const failure = providerModelFailure(providerError(400, body, {}, url), organizationModel);
      assert.equal(failure.kind, 'context_overflow', url);
      assert.equal(failure.retryable, false, url);
    }
  });

  test("the provider's throttle is paced by its own headers, and its `x-should-retry: false` holds", () => {
    const throttled = providerModelFailure(
      providerError(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } },
        { 'retry-after': '7' },
      ),
      organizationModel,
    );
    assert.equal(throttled.kind, 'rate_limit');
    assert.equal(throttled.retryAfterMs, 7_000);
    const overloaded = providerError(
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      { 'x-should-retry': 'false' },
    );
    assert.equal(providerModelFailure(overloaded, organizationModel).retryable, false);
    // A person's own connection keeps reading the kind alone.
    assert.equal(providerModelFailure(overloaded).retryable, true);
  });
});

describe('Provider error classification', () => {
  test('projects only bounded allowlisted facts into durable diagnostics', () => {
    const diagnostic = providerFailureDiagnostic(
      Object.assign(new Error('must not persist sk-secret-or-prompt'), {
        name: 'AI_APICallError',
        statusCode: 429,
        responseHeaders: {
          'x-request-id': 'req-123',
          authorization: 'Bearer secret',
        },
        data: {
          error: {
            code: 'rate_limit_exceeded',
            message: 'private provider payload',
          },
          prompt: 'private customer text',
        },
        requestBodyValues: { input: 'private request body' },
      }),
    );

    assert.deepEqual(diagnostic, {
      errorClass: 'rate_limit',
      httpStatus: 429,
      providerCode: 'rate_limit_exceeded',
      providerRequestId: 'req-123',
      retryable: true,
    });
    const serialized = JSON.stringify(diagnostic);
    assert.doesNotMatch(serialized, /secret|private|authorization|request body/i);
  });

  test('structured usage-limit codes project to billing regardless of status', () => {
    const quotaOn401 = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      statusCode: 401,
      data: { error: { code: 'insufficient_quota' } },
    });
    assert.equal(classifyError(quotaOn401), 'provider_billing');

    const balanceOn403 = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      statusCode: 403,
      data: { error: { code: 'insufficient_balance' } },
    });
    assert.equal(classifyError(balanceOn403), 'provider_billing');

    // Explicit provider evidence outranks the numeric HTTP fallback: an
    // exhausted quota is a closed window, not a transient throttle to retry.
    const quotaOn429 = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      statusCode: 429,
      data: { error: { code: 'insufficient_quota' } },
    });
    assert.equal(classifyError(quotaOn429), 'provider_billing');
    assert.equal(providerModelFailure(quotaOn429).retryable, false);
  });

  test('a Codex subscription window on 429 is an exhausted account, not a throttle', () => {
    // A real Codex refusal: 429, but the body names a plan window whose
    // `resets_in_seconds` was 398793 — 4.6 days, not a throttle.
    const usageLimit = Object.assign(
      new Error(
        'Codex OAuth request failed: HTTP 429 {"error":{"type":"usage_limit_reached",' +
          '"message":"The usage limit has been reached","plan_type":"prolite",' +
          '"resets_at":1790472699,"resets_in_seconds":398793}} ' +
          '(code=usage_limit_reached, status=429)',
      ),
      {
        name: 'AI_APICallError',
        statusCode: 429,
        data: { error: { type: 'usage_limit_reached' } },
      },
    );
    assert.equal(classifyError(usageLimit), 'provider_billing');
    assert.equal(providerModelFailure(usageLimit).retryable, false);

    // A Retry-After must not park the turn for the whole reset window.
    const withRetryAfter = Object.assign(new Error('The usage limit has been reached'), {
      name: 'AI_APICallError',
      statusCode: 429,
      data: { error: { type: 'usage_limit_reached' } },
      responseHeaders: { 'retry-after': '398793' },
    });
    const failure = providerModelFailure(withRetryAfter);
    assert.equal(failure.kind, 'provider_billing');
    assert.equal(failure.retryable, false);
    assert.equal(failure.retryAfterMs, undefined);
  });

  test('plan-window wording on a credential-shaped status projects to billing', () => {
    // Providers that gate subscription windows behind 401/403 for validly
    // signed-in users (#2516): their own wording outranks the bare status,
    // whether the SDK surfaces it as the error message or keeps it only in
    // the raw response body after a schema-parse failure.
    const planWindow = Object.assign(new Error('Your account plan usage limit has been reached.'), {
      name: 'AI_APICallError',
      statusCode: 401,
      data: { error: { type: 'authentication_error' } },
    });
    assert.equal(classifyError(planWindow), 'provider_billing');
    assert.equal(providerModelFailure(planWindow).retryable, false);

    const exhaustedCredits = Object.assign(new Error('Request failed with status code 403'), {
      name: 'AI_APICallError',
      statusCode: 403,
      responseBody: JSON.stringify({
        error: { message: 'Your credits have been exhausted for this billing period.' },
      }),
    });
    assert.equal(classifyError(exhaustedCredits), 'provider_billing');
  });

  test('genuine credential and permission failures stay auth on 401/403', () => {
    const invalidKey = Object.assign(new Error('Invalid API key provided'), {
      name: 'AI_APICallError',
      statusCode: 401,
      data: { error: { message: 'Invalid API key. Check your credentials and try again.' } },
    });
    assert.equal(classifyError(invalidKey), 'auth');

    const forbiddenModel = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      statusCode: 403,
      data: { error: { message: 'You do not have access to this model.' } },
    });
    assert.equal(classifyError(forbiddenModel), 'auth');
    const serverErrorOn403 = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      statusCode: 403,
      data: { error: { code: 'server_error' } },
    });
    assert.equal(classifyError(serverErrorOn403), 'auth');
  });

  test('classifies exhausted Codex HTML edge 403 retries as provider unavailable', () => {
    const exhaustedEdgeRejection = Object.assign(
      new Error('Codex OAuth request failed: HTTP 403 Request rejected'),
      {
        name: 'OpenAiCodexEdgeRejectionError',
        statusCode: 403,
        data: { error: { code: 'openai_codex_edge_rejection' } },
      },
    );

    assert.equal(classifyError(exhaustedEdgeRejection), 'provider_unavailable');
    assert.partialDeepStrictEqual(providerModelFailure(exhaustedEdgeRejection), {
      retryable: false,
    });
    assert.deepEqual(providerFailureDiagnostic(exhaustedEdgeRejection), {
      errorClass: 'provider_unavailable',
      httpStatus: 403,
      providerCode: 'openai_codex_edge_rejection',
      retryable: false,
    });
    const spoofedProviderPayload = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      statusCode: 403,
      data: { error: { code: 'openai_codex_edge_rejection' } },
    });
    assert.equal(classifyError(spoofedProviderPayload), 'auth');
    assert.notEqual(
      classifyError({ code: 'openai_codex_edge_rejection', message: 'provider payload' }),
      'provider_unavailable',
    );
  });

  test('recovers structured Codex HTTP facts through an SDK wrapper and truncates identifiers', () => {
    const cause = Object.assign(new Error('Codex OAuth request failed'), {
      name: 'OpenAiCodexHttpError',
      statusCode: 400,
      data: { error: { code: 'x'.repeat(1_024) } },
      responseHeaders: { 'x-request-id': 'r'.repeat(1_024) },
    });
    const diagnostic = providerFailureDiagnostic(
      Object.assign(new Error('Cannot connect to API'), {
        name: 'AI_APICallError',
        code: 'FETCH_FAILED',
        cause,
      }),
    );

    assert.equal(diagnostic.errorClass, 'request_rejected');
    assert.equal(diagnostic.httpStatus, 400);
    assert.ok((diagnostic.providerCode?.length ?? 0) <= 256);
    assert.ok((diagnostic.providerRequestId?.length ?? 0) <= 256);
    assert.equal(diagnostic.retryable, false);
  });

  test('durable diagnostics distinguish the provider failure classes used by fail-open handling', () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(new Error('bad request'), { statusCode: 400 }), 'request_rejected'],
      [Object.assign(new Error('slow down'), { statusCode: 429 }), 'rate_limit'],
      [Object.assign(new Error('upstream failed'), { statusCode: 503 }), 'provider_unavailable'],
      [new DOMException('request timed out', 'TimeoutError'), 'timeout'],
      [new TypeError('fetch failed'), 'network'],
      [
        Object.assign(new Error('input rejected'), {
          statusCode: 400,
          data: { error: { code: 'context_length_exceeded' } },
        }),
        'context_overflow',
      ],
    ];

    for (const [error, expected] of cases) {
      assert.equal(providerFailureDiagnostic(error).errorClass, expected);
    }
  });

  test('extracts allowlisted fields from JSON string failures without copying the payload', () => {
    const summary = providerModelFailure(
      JSON.stringify({
        error: { message: 'Invalid api_key=sk-test-diagnostic-value', code: 'bad_request' },
        request_id: 'req-123',
        prompt: 'private customer text',
        headers: { 'x-debug': 'internal' },
      }),
    );

    assert.partialDeepStrictEqual(summary, {
      message: 'Invalid api_key=sk-test-diagnostic-value (code=bad_request, requestId=req-123)',
      code: 'bad_request',
    });
    assert.equal(JSON.stringify(summary).includes('private customer text'), false);
    assert.equal(JSON.stringify(summary).includes('x-debug'), false);
    assert.partialDeepStrictEqual(
      providerModelFailure({
        error: JSON.stringify({
          message: 'nested provider rejection',
          code: 'nested_error',
          prompt: 'another private prompt',
        }),
      }),
      {
        message: 'nested provider rejection (code=nested_error)',
        code: 'nested_error',
      },
    );
    assert.equal(
      providerModelFailure(JSON.stringify([{ prompt: 'private list payload' }])).message,
      'Model request failed',
    );
  });

  test('retries incremental Responses transport failures with stable classification', () => {
    const websocketFailure = Object.assign(new Error('closed before completion'), {
      name: 'OpenAiResponsesTransportError',
      code: 'OPENAI_RESPONSES_WEBSOCKET_TRANSPORT_ERROR',
    });
    const missingContinuation = Object.assign(new Error('continuation unavailable'), {
      name: 'OpenAiResponsesTransportError',
      code: 'OPENAI_RESPONSES_CONTINUATION_UNAVAILABLE',
    });

    assert.equal(classifyError(websocketFailure), 'network');
    assert.equal(classifyError(missingContinuation), 'network');
    assert.partialDeepStrictEqual(providerModelFailure(websocketFailure), { retryable: true });
    assert.partialDeepStrictEqual(providerModelFailure(missingContinuation), { retryable: true });
  });

  test('treats a status-less provider server_error as temporarily unavailable', () => {
    const failure = {
      type: 'model_failure',
      kind: 'unknown',
      retryable: false,
      message:
        'Streaming response failed: [502] Upstream error from Nvidia: Service temporarily overloaded',
      code: 'server_error',
    };

    assert.equal(classifyError(failure), 'provider_unavailable');
    assert.partialDeepStrictEqual(providerModelFailure(failure), { retryable: true });
    assert.deepEqual(providerFailureDiagnostic(failure), {
      errorClass: 'provider_unavailable',
      providerCode: 'server_error',
      retryable: true,
    });
  });

  test('retries an AI SDK transport failure without an HTTP response', () => {
    const failure = Object.assign(
      new Error(
        'Cannot connect to API: 80E1BDF601000000:error:0A000119:SSL routines:tls_get_more_records:decryption failed or bad record mac:../deps/openssl/openssl/ssl/record/methods/tls_common.c:869:',
      ),
      {
        name: 'AI_APICallError',
        isRetryable: true,
        cause: Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('decryption failed or bad record mac'), {
            code: 'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
          }),
        }),
      },
    );

    assert.equal(classifyError(failure), 'network');
    assert.partialDeepStrictEqual(providerModelFailure(failure), { retryable: true });
    assert.equal(providerFailureDiagnostic(failure).retryable, true);
  });

  test('retries a transport failure identified only by a cause code', () => {
    const failure = Object.assign(new Error('request failed'), {
      cause: { code: 'ECONNRESET' },
    });

    assert.equal(classifyError(failure), 'network');
    assert.partialDeepStrictEqual(providerModelFailure(failure), { retryable: true });
  });

  test('retries a bare rate limit on local backoff', () => {
    // A throttle often ships no Retry-After (gateways especially); ending the
    // Turn on it leaves the user nothing to do but send again.
    const rateLimit = Object.assign(new Error('Rate limit exceeded'), {
      name: 'AI_APICallError',
      statusCode: 429,
    });
    const gatewayThrottle = Object.assign(
      new Error('Upstream model provider is temporarily unavailable. Please try again.'),
      {
        name: 'AI_APICallError',
        statusCode: 429,
        data: { error: { code: 'rate_limit_error' } },
      },
    );

    for (const failure of [rateLimit, gatewayThrottle]) {
      const model = providerModelFailure(failure);
      assert.equal(model.kind, 'rate_limit');
      assert.equal(model.retryable, true);
      assert.equal(model.retryAfterMs, undefined);
    }
  });

  test('paces a rate limit by the delay the provider names', () => {
    const delayedRateLimit = Object.assign(new Error('Too many requests'), {
      name: 'AI_APICallError',
      statusCode: 429,
      responseHeaders: { 'retry-after': '40' },
    });

    assert.partialDeepStrictEqual(providerModelFailure(delayedRateLimit), {
      retryable: true,
      retryAfterMs: 40_000,
    });
    assert.equal(providerFailureDiagnostic(delayedRateLimit).retryable, true);
  });

  test('fails fast on an exhausted free tier, named by its code', () => {
    const freeTier = Object.assign(new Error('Rate limit exceeded'), {
      name: 'AI_APICallError',
      statusCode: 429,
      data: { error: { code: 'FreeUsageLimitError', message: 'Rate limit exceeded' } },
    });

    assert.equal(classifyError(freeTier), 'provider_billing');
    assert.partialDeepStrictEqual(providerModelFailure(freeTier), { retryable: false });
    assert.equal(providerFailureDiagnostic(freeTier).retryable, false);
  });

  test('a malformed Retry-After never makes a transient failure fatal', () => {
    for (const statusCode of [429, 503]) {
      const failure = Object.assign(new Error('try later'), {
        name: 'AI_APICallError',
        statusCode,
        responseHeaders: { 'retry-after': 'soon' },
      });
      const model = providerModelFailure(failure);
      assert.equal(model.retryable, true, `status ${statusCode}`);
      assert.equal(model.retryAfterMs, undefined, `status ${statusCode}`);
    }
  });

  // Claude models before 4.5 refuse input + max_tokens past the window; the
  // input is what compaction can shrink.
  test("Anthropic's input-plus-output limit is an overflow compaction can fix", () => {
    const failure = Object.assign(
      new Error(
        'input length and `max_tokens` exceed context limit: 180000 + 64000 > 200000, decrease input length or `max_tokens` and try again',
      ),
      {
        name: 'AI_APICallError',
        statusCode: 400,
        data: { type: 'error', error: { type: 'invalid_request_error' } },
      },
    );
    assert.equal(classifyError(failure), 'context_overflow');
  });

  test('the failure kind alone decides whether to retry', () => {
    const timeout = Object.assign(new Error('Request timeout'), { name: 'AI_APICallError' });
    assert.equal(classifyError(timeout), 'timeout');
    assert.equal(providerModelFailure(timeout).retryable, true);

    // A 409 is a rejected request like any other 4xx, not a transient one.
    const conflict = Object.assign(new Error('conflict'), {
      name: 'AI_APICallError',
      statusCode: 409,
    });
    assert.equal(classifyError(conflict), 'request_rejected');
    assert.equal(providerModelFailure(conflict).retryable, false);

    // A truncated stream is retried only by the bounded incomplete-stream
    // recovery, which knows whether any output was already observed.
    const truncated = new Error('model stream ended without a finish chunk');
    assert.equal(classifyError(truncated), 'stream_truncated');
    assert.equal(providerModelFailure(truncated).retryable, false);

    for (const [kind, reason] of Object.entries(MODEL_FAILURE_RETRY)) {
      if (reason !== null) assert.equal(reason, kind, `${kind} retries under its own name`);
    }
  });

  test('classifies provider capacity errors and retries with backoff', () => {
    const capacity = () =>
      Object.assign(new Error('The model is currently at capacity due to high demand.'), {
        name: 'AI_APICallError',
        data: { error: { code: 'resource-exhausted' } },
      });

    assert.equal(classifyError(capacity()), 'provider_capacity');
    assert.partialDeepStrictEqual(providerModelFailure(capacity()), { retryable: true });
    assert.partialDeepStrictEqual(
      providerModelFailure(
        Object.assign(capacity(), {
          responseHeaders: { 'retry-after': '12' },
        }),
      ),
      { retryable: true, retryAfterMs: 12_000 },
    );
    assert.partialDeepStrictEqual(
      providerModelFailure(
        Object.assign(capacity(), {
          responseHeaders: { 'retry-after': 'not-a-delay' },
        }),
      ),
      { retryable: true },
    );

    const topLevelCode = Object.assign(new Error('The model is currently at capacity'), {
      code: 'resource-exhausted',
    });
    assert.equal(classifyError(topLevelCode), 'provider_capacity');

    const capacityWithAbortText = Object.assign(new Error('Request aborted by upstream'), {
      name: 'AI_APICallError',
      data: { error: { code: 'resource-exhausted' } },
    });
    assert.equal(classifyError(capacityWithAbortText), 'provider_capacity');

    const capacityWithRateLimitStatus = Object.assign(new Error('Too many requests'), {
      name: 'AI_APICallError',
      statusCode: 429,
      data: { error: { code: 'resource-exhausted' } },
    });
    assert.equal(classifyError(capacityWithRateLimitStatus), 'provider_capacity');
    assert.partialDeepStrictEqual(providerModelFailure(capacityWithRateLimitStatus), {
      retryable: true,
    });
    assert.deepEqual(providerFailureDiagnostic(capacityWithRateLimitStatus), {
      errorClass: 'provider_capacity',
      httpStatus: 429,
      providerCode: 'resource-exhausted',
      retryable: true,
    });
    assert.equal(
      providerFailureDiagnostic(
        Object.assign(new Error('The model is at capacity'), {
          name: 'AI_APICallError',
          statusCode: 503,
          data: { error: { code: 'resource-exhausted' } },
        }),
      ).errorClass,
      'provider_capacity',
    );

    const ambiguousQuotaCode = Object.assign(new Error('resource exhausted'), {
      name: 'AI_APICallError',
      data: { error: { code: 'resource_exhausted' } },
    });
    assert.notEqual(classifyError(ambiguousQuotaCode), 'provider_capacity');
  });

  test('classifies context overflow by predicate, carrier shape, and evidence precedence', () => {
    const overflow = (message: string, extra: Record<string, unknown> = {}) =>
      classifyError(Object.assign(new Error(message), { name: 'AI_APICallError', ...extra }));

    const textCases = [
      'prompt is too long: 213462 tokens > 200000 maximum',
      'request_too_large: Request exceeds the maximum size',
      'Your input exceeds the context window of this model',
      "Requested token count exceeds the model's maximum context length of 131072 tokens",
      'The input token count (1196265) exceeds the maximum number of tokens allowed',
      "This model's maximum prompt length is 131072 but the request contains 537812 tokens",
      'Please reduce the length of the messages or completion',
      "This endpoint's maximum context length is 262144 tokens",
      'Prompt contains 5000 tokens; too large for model with 4096 maximum context length',
      'invalid params, context window exceeds limit',
      'Your request exceeded model token limit: 200000',
      'prompt token count of 21000 exceeds the limit of 16384',
      'the prompt contains too many tokens',
      'Input token limit exceeded: 250000 tokens > 200000 maximum',
      'Failed to generate response: context_length_exceeded',
    ];
    for (const message of textCases) {
      assert.equal(overflow(message, { statusCode: 400 }), 'context_overflow', message);
    }

    assert.equal(
      overflow('Bad Request', {
        statusCode: 400,
        data: { error: { message: 'Bad Request', code: 'context_length_exceeded' } },
      }),
      'context_overflow',
    );
    assert.equal(
      overflow('Bad Request', {
        statusCode: 400,
        responseBody: '{"error":{"code":"context_length_exceeded"}}',
      }),
      'context_overflow',
    );
    assert.equal(
      overflow('Request Entity Too Large', {
        statusCode: 400,
        data: { error: { type: 'request_too_large', message: 'Request Entity Too Large' } },
      }),
      'context_overflow',
    );

    assert.equal(
      classifyError({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          message: 'Bad Request',
        },
      }),
      'context_overflow',
    );
    assert.equal(
      classifyError(
        "Requested token count exceeds the model's maximum context length of 131072 tokens.",
      ),
      'context_overflow',
    );
    assert.equal(
      classifyError({ type: 'invalid_request_error', message: 'missing required field' }),
      'unknown',
    );

    assert.equal(
      overflow('Service Unavailable', {
        statusCode: 503,
        data: { error: { message: 'Service Unavailable', code: 'context_length_exceeded' } },
      }),
      'context_overflow',
    );
    assert.equal(
      overflow(
        "503 proxy error: Requested token count exceeds the model's maximum context length",
        { statusCode: 503 },
      ),
      'context_overflow',
    );
    assert.equal(overflow('', { statusCode: 413 }), 'context_overflow');
    assert.equal(
      overflow('Please rate limit your requests', { statusCode: 503 }),
      'provider_unavailable',
    );
    assert.notEqual(overflow('Failed to generate response', { statusCode: 400 }), 'rate_limit');
    assert.equal(overflow('rate_limit_exceeded: slow down'), 'rate_limit');

    const vetoedTextCases = [
      'Rate limit reached: too many tokens, please wait',
      "Too many requests. This endpoint's maximum context length is 262144 tokens.",
      "ThrottlingException. This endpoint's maximum context length is 262144 tokens.",
      "Quota exceeded. This endpoint's maximum context length is 262144 tokens.",
      "Completion has too many tokens. This endpoint's maximum context length is 262144 tokens.",
      "Too many tokens were requested for the completion. This endpoint's maximum context length is 262144 tokens.",
      "Output token count of 8192 exceeds the limit. This endpoint's maximum context length is 262144 tokens.",
      "Too many completion tokens were requested. This endpoint's maximum context length is 262144 tokens.",
      "Maximum completion tokens exceeded. This endpoint's maximum context length is 262144 tokens.",
    ];
    for (const message of vetoedTextCases) {
      assert.notEqual(overflow(message, { statusCode: 400 }), 'context_overflow', message);
    }
    for (const message of [
      'invalid request: missing required field',
      'file size exceeds the limit of 10485760',
    ]) {
      assert.notEqual(overflow(message, { statusCode: 400 }), 'context_overflow', message);
    }

    assert.equal(
      overflow(
        "This model's maximum context length is 8192 tokens. However, you requested 10240 tokens (10140 in the messages, 100 in the completion).",
        { statusCode: 400 },
      ),
      'context_overflow',
    );
    assert.equal(
      overflow('Completion has too many tokens for this model', {
        statusCode: 400,
        data: {
          error: {
            message: 'Completion has too many tokens for this model',
            code: 'context_length_exceeded',
          },
        },
      }),
      'context_overflow',
    );
  });

  test('classifies wording retained only in schema-invalid response bodies', async () => {
    const handler = createJsonErrorResponseHandler({
      errorSchema: z.object({ error: z.object({ message: z.string() }) }),
      errorToMessage: (data) => data.error.message,
    });
    const errorFromBody = async (body: string) =>
      (
        await handler({
          response: new Response(body, { status: 400, statusText: 'Bad Request' }),
          url: 'https://api.example.test/v1/chat/completions',
          requestBodyValues: {},
        })
      ).value;

    const overflowError = await errorFromBody(
      '{"error":"Your input exceeds the context window of this model"}',
    );
    assert.equal(overflowError.message, 'Bad Request');
    assert.equal(overflowError.data, undefined);
    assert.equal(classifyError(overflowError), 'context_overflow');

    const outputCapError = await errorFromBody(
      '{"error":"Too many completion tokens were requested. This endpoint\'s maximum context length is 262144 tokens."}',
    );
    assert.notEqual(classifyError(outputCapError), 'context_overflow');
  });

  test('classifies a real SDK successful-response handler failure after HTTP headers', async () => {
    await assert.rejects(
      postJsonToApi({
        url: 'https://provider.invalid',
        body: {},
        fetch: async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(
                  Object.assign(new Error('connection closed'), { code: 'UND_ERR_SOCKET' }),
                );
              },
            }),
            { status: 200 },
          ),
        failedResponseHandler: async () => {
          throw new Error('unexpected non-2xx response');
        },
        successfulResponseHandler: async ({ response }) => {
          assert.equal(response.status, 200);
          return { value: await response.text() };
        },
      }),
      (error: unknown) => {
        assert.ok(APICallError.isInstance(error));
        assert.equal(error.statusCode, 200);
        assert.equal(error.message, 'Failed to process successful response');
        assert.equal(providerModelFailure(error).kind, 'network');
        assert.deepEqual(providerFailureDiagnostic(error), {
          errorClass: 'network',
          httpStatus: 200,
          retryable: true,
        });
        return true;
      },
    );
  });

  for (const statusCode of [200, 201, 204, 206, 299]) {
    for (const code of [
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
      'ECONNABORTED',
      'UND_ERR_SOCKET',
      'UND_ERR_BODY_TIMEOUT',
    ]) {
      test(`retries HTTP ${statusCode} response processing interrupted by ${code}`, () => {
        const failure = new APICallError({
          message: 'Failed to process successful response',
          url: 'https://provider.invalid',
          requestBodyValues: {},
          statusCode,
          responseHeaders: { 'x-request-id': 'request-5656' },
          cause: new TypeError('terminated', {
            cause: Object.assign(new Error('connection closed'), { code }),
          }),
        });

        // The SDK's default is false for 2xx; it is not evidence against a
        // transport failure while consuming an otherwise successful response.
        assert.equal(failure.isRetryable, false);
        assert.equal(classifyError(failure), 'network');
        assert.partialDeepStrictEqual(providerModelFailure(failure), {
          kind: 'network',
          retryable: true,
        });
        assert.deepEqual(providerFailureDiagnostic(failure), {
          errorClass: 'network',
          httpStatus: statusCode,
          providerRequestId: 'request-5656',
          retryable: true,
        });
      });
    }
  }

  test('does not infer a 2xx transport failure from SDK retryability or arbitrary causes', () => {
    for (const cause of [
      undefined,
      new SyntaxError('Unexpected token'),
      Object.assign(new Error('invalid certificate'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
      Object.assign(new Error('invalid argument'), { code: 'UND_ERR_INVALID_ARG' }),
      Object.assign(new Error('cancelled'), { code: 'UND_ERR_ABORTED' }),
      new Error('connection closed without a structured code'),
    ]) {
      const failure = new APICallError({
        message: 'Failed to process successful response',
        url: 'https://provider.invalid',
        requestBodyValues: {},
        statusCode: 200,
        isRetryable: true,
        cause,
      });
      assert.equal(classifyError(failure), 'unknown');
      assert.equal(providerModelFailure(failure).retryable, false);
      assert.equal(providerFailureDiagnostic(failure).retryable, false);
    }
  });

  test('keeps explicit HTTP and provider failures ahead of 2xx transport evidence', () => {
    const cause = Object.assign(new Error('connection closed'), { code: 'ECONNRESET' });
    for (const [statusCode, kind] of [
      [400, 'request_rejected'],
      [401, 'auth'],
      [403, 'auth'],
      [413, 'context_overflow'],
      [429, 'rate_limit'],
      [503, 'provider_unavailable'],
    ] as const) {
      const failure = new APICallError({
        message: 'request failed',
        url: 'https://provider.invalid',
        requestBodyValues: {},
        statusCode,
        cause,
      });
      assert.equal(classifyError(failure), kind);
      assert.equal(providerFailureDiagnostic(failure).errorClass, kind);
    }
    for (const [code, kind] of [
      ['insufficient_quota', 'provider_billing'],
      ['context_length_exceeded', 'context_overflow'],
    ] as const) {
      const failure = new APICallError({
        message: 'Failed to process successful response',
        url: 'https://provider.invalid',
        requestBodyValues: {},
        statusCode: 200,
        data: { error: { code } },
        cause,
      });
      assert.equal(classifyError(failure), kind);
      assert.equal(providerModelFailure(failure).retryable, false);
    }
  });

  test('bounds 2xx cause inspection and does not retry through cancellation or rejection', () => {
    const reset = Object.assign(new Error('connection closed'), { code: 'ECONNRESET' });
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    const throwing = ['cause', 'code', 'statusCode', 'name'].map((field) =>
      Object.defineProperty(new Error('opaque cause'), field, {
        get() {
          throw new Error('must not escape classification');
        },
      }),
    );
    const tooDeep = { cause: { cause: { cause: { cause: reset } } } };
    for (const cause of [
      cycle,
      ...throwing,
      tooDeep,
      Object.assign(new Error('cancelled', { cause: reset }), { name: 'AbortError' }),
      new APICallError({
        message: 'rejected',
        url: 'https://provider.invalid',
        requestBodyValues: {},
        statusCode: 401,
        cause: reset,
      }),
    ]) {
      const failure = new APICallError({
        message: 'Failed to process successful response',
        url: 'https://provider.invalid',
        requestBodyValues: {},
        statusCode: 200,
        cause,
      });
      assert.equal(providerModelFailure(failure).retryable, false);
      assert.equal(providerFailureDiagnostic(failure).retryable, false);
    }
  });

  test('preserves provider evidence through the official AI SDK retry wrapper', async () => {
    const handler = createJsonErrorResponseHandler({
      errorSchema: z.object({
        error: z.object({
          message: z.string(),
          code: z.string().optional(),
        }),
      }),
      errorToMessage: (data) => data.error.message,
    });
    const apiCallError = async (status: number, body: string) =>
      (
        await handler({
          response: new Response(body, { status, statusText: `HTTP ${status}` }),
          url: 'https://api.example.test/v1/chat/completions',
          requestBodyValues: {},
        })
      ).value;
    const retried = (
      lastError: unknown,
      reason: 'maxRetriesExceeded' | 'errorNotRetryable' = 'maxRetriesExceeded',
    ) =>
      new RetryError({
        message: 'Provider request failed after retries',
        reason,
        errors: [lastError, lastError, lastError],
      });

    const rateLimit = await apiCallError(429, '{"error":{"message":"Too many requests"}}');
    const unavailable = await apiCallError(503, '{"error":{"message":"Service unavailable"}}');
    const overflow = await apiCallError(
      503,
      '{"error":{"message":"Service unavailable","code":"context_length_exceeded"}}',
    );

    assert.equal(classifyError(retried(rateLimit)), 'rate_limit');
    assert.equal(classifyError(retried(unavailable)), 'provider_unavailable');
    assert.equal(classifyError(retried(overflow, 'errorNotRetryable')), 'context_overflow');
    const interruptedResponse = new APICallError({
      message: 'Failed to process successful response',
      url: 'https://provider.invalid',
      requestBodyValues: {},
      statusCode: 200,
      cause: Object.assign(new Error('connection closed'), { code: 'ECONNRESET' }),
    });
    assert.equal(classifyError(retried(interruptedResponse)), 'network');
    assert.deepEqual(providerFailureDiagnostic(retried(interruptedResponse)), {
      errorClass: 'network',
      httpStatus: 200,
      retryable: true,
    });
    const cancelledResponse = new RetryError({
      message: 'Retry stopped',
      reason: 'abort',
      errors: [interruptedResponse],
    });
    assert.equal(classifyError(cancelledResponse), 'abort');
    assert.equal(providerModelFailure(cancelledResponse).retryable, false);
    assert.equal(
      classifyError(
        new RetryError({
          message: 'Retry stopped',
          reason: 'abort',
          errors: [new Error('transport stopped')],
        }),
      ),
      'abort',
    );
    assert.equal(
      classifyError(
        new RetryError({
          message: 'Provider request failed after retries',
          reason: 'maxRetriesExceeded',
          errors: [],
        }),
      ),
      'unknown',
    );
    assert.equal(
      classifyError(
        Object.assign(new Error('Provider request failed after retries'), {
          name: 'AI_RetryError',
          lastError: rateLimit,
        }),
      ),
      'unknown',
    );
  });
});

test('auth classification matches authentication without matching authority', () => {
  assert.equal(classifyError(new Error('OAuth2 token expired')), 'auth');
  assert.equal(
    classifyError(new Error('Conversation copy contains durable runtime authority facts')),
    'unknown',
  );
});
