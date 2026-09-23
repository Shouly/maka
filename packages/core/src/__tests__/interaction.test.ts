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

import {
  INTERACTION_MAX_QUESTIONS,
  INTERACTION_REQUEST_MAX_BYTES,
  decodeInteractionAnswer,
  decodeInteractionCanonicalOutcome,
  decodeInteractionFormResponse,
  decodeInteractionRequest,
  interactionCanonicalOutcomesEquivalent,
  isInteractionAnswerValidForRequest,
  isInteractionCanonicalOutcomeValidForRequest,
  isInteractionFormFieldValueValid,
  projectInteractionClientCapabilityRequest,
  projectInteractionFormRequest,
  projectInteractionQuestionRequest,
  projectInteractionSandboxBoundaryRequest,
} from '../interaction.js';

describe('Interaction projection', () => {
  test('projects bounded questions with exact arity', () => {
    assert.deepEqual(
      projectInteractionQuestionRequest({
        toolUseId: 'question-tool',
        questions: [
          {
            question: 'Proceed?',
            header: 'Proceed',
            options: [{ label: 'Yes' }, { label: 'No', description: 'Stop here' }],
          },
        ],
      }),
      {
        kind: 'question',
        toolUseId: 'question-tool',
        questions: [
          {
            question: 'Proceed?',
            header: 'Proceed',
            options: [{ label: 'Yes' }, { label: 'No', description: 'Stop here' }],
          },
        ],
      },
    );
    assert.throws(() => projectInteractionQuestionRequest({ toolUseId: 'q', questions: [] }));
    assert.throws(() =>
      projectInteractionQuestionRequest({
        toolUseId: 'q',
        questions: Array.from({ length: INTERACTION_MAX_QUESTIONS + 1 }, () => ({
          question: 'Q',
          header: 'Q',
          options: [{ label: 'A' }, { label: 'B' }],
        })),
      }),
    );
    assert.throws(() =>
      projectInteractionQuestionRequest({
        toolUseId: 'q',
        questions: [{ question: 'Q', header: 'Q', options: [{ label: 'only' }] }],
      }),
    );
  });

  test('projects secrets and unsafe review characters in question text', () => {
    const request = {
      toolUseId: 'question-tool',
      questions: [
        {
          question: '\u0007 password=question-secret',
          header: 'Secrets',
          options: [
            { label: '\u202e token=label-secret', description: '\napi_key=description-secret' },
            { label: 'Keep' },
          ],
        },
      ],
    };

    const projected = projectInteractionQuestionRequest(request);

    assert.deepEqual(projected.questions, [
      {
        question: '\\u{7} password=[redacted]',
        header: 'Secrets',
        options: [
          {
            label: '\\u{202E} token=[redacted]',
            description: '\\u{A}api_key=[redacted]',
          },
          { label: 'Keep' },
        ],
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(projected),
      /question-secret|label-secret|description-secret/,
    );
    assert.deepEqual(request.questions[0]?.options[0], {
      label: '\u202e token=label-secret',
      description: '\napi_key=description-secret',
    });
  });

  test('visibly escapes every omitted Bidi_Control code point in review labels', () => {
    const projected = projectInteractionQuestionRequest({
      toolUseId: 'question-tool',
      questions: [
        {
          question: 'Choose',
          header: 'Bidi',
          options: [{ label: '\u061cArabic' }, { label: '\u200eLTR' }, { label: '\u200fRTL' }],
        },
      ],
    });

    assert.deepEqual(projected.questions[0]?.options, [
      { label: '\\u{61C}Arabic' },
      { label: '\\u{200E}LTR' },
      { label: '\\u{200F}RTL' },
    ]);
  });

  test('rejects labels that collide with a Bidi_Control visible escape', () => {
    assert.throws(() =>
      projectInteractionQuestionRequest({
        toolUseId: 'question-tool',
        questions: [
          {
            question: 'Choose',
            header: 'Bidi',
            options: [{ label: '\u200eLTR' }, { label: '\\u{200E}LTR' }],
          },
        ],
      }),
    );
  });

  test('rejects option labels that collide after safe projection', () => {
    assert.throws(() =>
      projectInteractionQuestionRequest({
        toolUseId: 'question-tool',
        questions: [
          {
            question: 'Choose',
            header: 'Choose',
            options: [{ label: 'password=first-secret' }, { label: 'password=second-secret' }],
          },
        ],
      }),
    );
  });
});

describe('Interaction decoding and validity', () => {
  test('accepts independently bounded sandbox fields without an invented combined cap', () => {
    const request = projectInteractionSandboxBoundaryRequest({
      expansion: {
        filesystem: {
          entries: Array.from({ length: 32 }, (_, index) => ({
            path: `/opt/service-${index}/${'x'.repeat(1_980)}`,
            access: 'read' as const,
            scope: 'exact' as const,
          })),
        },
      },
      justification: '\u0001'.repeat(2_000),
    });

    assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') > 64 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') > INTERACTION_REQUEST_MAX_BYTES);
    assert.deepEqual(decodeInteractionRequest(request), request);
  });

  test('keeps sandbox boundary answers tied to exact boundary outcome semantics', () => {
    const request = projectInteractionSandboxBoundaryRequest({
      expansion: {
        filesystem: {
          entries: [{ path: '/outside/file.txt', access: 'read', scope: 'exact' }],
        },
      },
      justification: 'Read the selected file.',
    });
    const answer = decodeInteractionAnswer({ kind: 'sandbox_boundary', decision: 'allow' });
    const outcome = decodeInteractionCanonicalOutcome({
      kind: 'sandbox_boundary_decision',
      decision: 'allow',
      status: 'approved',
      committedAt: 2,
    });
    assert.equal(isInteractionAnswerValidForRequest(request, answer), true);
    assert.equal(isInteractionCanonicalOutcomeValidForRequest(request, outcome), true);
    assert.deepEqual(decodeInteractionRequest(request), request);
    assert.throws(() =>
      decodeInteractionCanonicalOutcome({
        kind: 'sandbox_boundary_decision',
        decision: 'deny',
        status: 'approved',
        committedAt: 2,
      }),
    );
    assert.equal(
      isInteractionCanonicalOutcomeValidForRequest(
        request,
        decodeInteractionCanonicalOutcome({
          kind: 'closure',
          reason: 'timed_out',
          committedAt: 3,
        }),
      ),
      false,
    );
  });

  test('keeps Client Capability approval tied to the exact Host grant target', () => {
    const request = projectInteractionClientCapabilityRequest({
      toolUseId: 'browser-call-1',
      target: {
        providerId: 'provider-1',
        contractId: 'contract-1',
        serverId: 'desktop_browser',
        toolName: 'BrowserSnapshot',
        capability: 'browser',
        scope: { kind: 'browser_origin', origin: 'https://example.com' },
      },
    });
    const answer = decodeInteractionAnswer({ kind: 'client_capability', decision: 'allow' });
    const outcome = decodeInteractionCanonicalOutcome({
      kind: 'client_capability_decision',
      decision: 'allow',
      committedAt: 2,
    });
    assert.equal(isInteractionAnswerValidForRequest(request, answer), true);
    assert.equal(isInteractionCanonicalOutcomeValidForRequest(request, outcome), true);
    assert.equal(
      isInteractionCanonicalOutcomeValidForRequest(
        request,
        decodeInteractionCanonicalOutcome({
          kind: 'closure',
          reason: 'timed_out',
          committedAt: 3,
        }),
      ),
      true,
    );
    assert.deepEqual(decodeInteractionRequest(request), request);
    assert.throws(() =>
      projectInteractionClientCapabilityRequest({
        ...request,
        target: {
          ...request.target,
          scope: { kind: 'browser_origin', origin: 'https://example.com/path' },
        },
      }),
    );
  });

  const question = projectInteractionQuestionRequest({
    toolUseId: 'q1',
    questions: [
      { question: 'Choose', header: 'Choose', options: [{ label: 'A' }, { label: 'B' }] },
      { question: 'Confirm', header: 'Confirm', options: [{ label: 'Y' }, { label: 'N' }] },
    ],
  });

  test('single-select is the absent multiSelect key, and projection agrees', () => {
    const decoded = decodeInteractionRequest({
      kind: 'question',
      toolUseId: 'q-single',
      questions: [
        { question: 'Choose', header: 'Choose', options: [{ label: 'A' }, { label: 'B' }] },
      ],
    });
    assert.equal(decoded.kind, 'question');
    assert.deepEqual(decoded.kind === 'question' ? decoded.questions[0] : undefined, {
      question: 'Choose',
      header: 'Choose',
      options: [{ label: 'A' }, { label: 'B' }],
    });
    assert.deepEqual(
      projectInteractionQuestionRequest({
        toolUseId: 'q-single',
        questions: [
          { question: 'Choose', header: 'Choose', options: [{ label: 'A' }, { label: 'B' }] },
        ],
      }),
      decoded,
    );
  });

  test('carries header and multiSelect through projection', () => {
    const projected = projectInteractionQuestionRequest({
      toolUseId: 'q-shape',
      questions: [
        {
          question: 'Which layout?',
          header: 'Layout',
          options: [
            { label: 'Grid', description: 'Three columns.' },
            { label: 'List', description: 'One column.' },
          ],
        },
        {
          question: 'Which surfaces?',
          header: 'Surfaces',
          multiSelect: true,
          options: [{ label: 'Desktop' }, { label: 'CLI' }, { label: 'Web' }, { label: 'Bot' }],
        },
      ],
    });
    assert.equal(projected.questions[0]?.header, 'Layout');
    assert.equal(projected.questions[0]?.options[0]?.description, 'Three columns.');
    assert.equal(projected.questions[1]?.multiSelect, true);
    assert.equal(projected.questions[1]?.options.length, 4);
    assert.deepEqual(decodeInteractionRequest(projected), projected);
  });

  test('accepts a multi-select answer only where the question asked for one', () => {
    const request = projectInteractionQuestionRequest({
      toolUseId: 'q-multi',
      questions: [
        {
          question: 'Which surfaces?',
          header: 'Surfaces',
          multiSelect: true,
          options: [{ label: 'Desktop' }, { label: 'CLI' }],
        },
        { question: 'Confirm', header: 'Confirm', options: [{ label: 'Y' }, { label: 'N' }] },
      ],
    });
    const multi = decodeInteractionAnswer({
      kind: 'question',
      answers: [['Desktop', 'CLI'], 'Y'],
    });
    assert.equal(isInteractionAnswerValidForRequest(request, multi), true);
    assert.equal(
      isInteractionAnswerValidForRequest(
        request,
        decodeInteractionAnswer({ kind: 'question', answers: ['Desktop', ['Y']] }),
      ),
      false,
    );
  });

  test('strictly rejects widened shapes, sparse arrays, unsafe text, and serialized overflow', () => {
    const sparse = new Array(2);
    sparse[1] = 'answer';
    const invalid = [
      () => decodeInteractionRequest({ ...question, extra: true }),
      () => decodeInteractionAnswer({ kind: 'question', answers: sparse }),
      () =>
        decodeInteractionAnswer({
          kind: 'question',
          answers: ['\\'.repeat(2048), '\\'.repeat(2048), '\\'.repeat(2048)],
        }),
      () =>
        projectInteractionQuestionRequest({
          toolUseId: 'q',
          questions: [
            {
              question: '界'.repeat(342),
              header: 'Long',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        }),
    ];
    for (const decode of invalid) assert.throws(decode);
  });

  test('validates answer kind and arity', () => {
    assert.equal(
      isInteractionAnswerValidForRequest(
        question,
        decodeInteractionAnswer({ kind: 'question', answers: ['A', null] }),
      ),
      true,
    );
    assert.equal(
      isInteractionAnswerValidForRequest(
        question,
        decodeInteractionAnswer({ kind: 'question', answers: ['A'] }),
      ),
      false,
    );
  });

  test('validates canonical closures, equivalence, and safe integer commit times', () => {
    const timeout = decodeInteractionCanonicalOutcome({
      kind: 'closure',
      reason: 'timed_out',
      committedAt: 3,
    });
    assert.equal(isInteractionCanonicalOutcomeValidForRequest(question, timeout), false);
    assert.equal(
      interactionCanonicalOutcomesEquivalent(
        timeout,
        decodeInteractionCanonicalOutcome({
          kind: 'closure',
          reason: 'host_restarted',
          committedAt: 4,
        }),
      ),
      false,
    );
    for (const committedAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() =>
        decodeInteractionCanonicalOutcome({
          kind: 'closure',
          reason: 'turn_terminal',
          committedAt,
        }),
      );
    }
  });

  test('decodes the complete bounded primitive form contract', () => {
    const request = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: 'Choose deployment settings',
      requester: { name: 'deploy', source: 'Example MCP server' },
      fields: [
        {
          kind: 'string',
          name: 'owner',
          label: 'Owner email',
          required: true,
          format: 'email',
          minLength: 3,
          maxLength: 100,
        },
        {
          kind: 'number',
          name: 'ratio',
          label: 'Traffic ratio',
          required: false,
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
        {
          kind: 'integer',
          name: 'replicas',
          label: 'Replicas',
          required: true,
          minimum: 1,
          maximum: 10,
        },
        {
          kind: 'boolean',
          name: 'confirm',
          label: 'Confirm deployment',
          required: true,
          default: false,
        },
        {
          kind: 'single_select',
          name: 'environment',
          label: 'Environment',
          required: true,
          options: [
            { value: 'staging', label: 'Staging' },
            { value: 'production', label: 'Production' },
          ],
          default: 'staging',
        },
        {
          kind: 'multi_select',
          name: 'regions',
          label: 'Regions',
          required: false,
          options: [
            { value: 'us', label: 'US' },
            { value: 'eu', label: 'EU' },
          ],
          minItems: 1,
          maxItems: 2,
          default: ['us'],
        },
      ],
    });

    const accepted = decodeInteractionAnswer({
      kind: 'form',
      action: 'accept',
      values: {
        owner: 'owner@example.test',
        ratio: 0.25,
        replicas: 3,
        confirm: true,
        environment: 'production',
        regions: ['us', 'eu'],
      },
    });
    assert.equal(isInteractionAnswerValidForRequest(request, accepted), true);
    assert.equal(
      isInteractionAnswerValidForRequest(
        request,
        decodeInteractionAnswer({ kind: 'form', action: 'decline' }),
      ),
      true,
    );
    assert.equal(
      isInteractionAnswerValidForRequest(
        request,
        decodeInteractionAnswer({ kind: 'form', action: 'cancel' }),
      ),
      true,
    );
  });

  test('projects every human-facing form label through the safe review boundary', () => {
    const projected = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: '\u202e password=message-secret',
      requester: {
        name: 'token=requester-secret',
        source: '\napi_key=source-secret',
      },
      fields: [
        {
          kind: 'single_select',
          name: 'environment',
          label: '\u0007 password=field-secret',
          description: '\nclient_secret=description-secret',
          required: true,
          options: [
            { value: 'production', label: '\u202e token=option-secret' },
            { value: 'staging', label: 'Staging' },
          ],
        },
      ],
    });

    assert.equal(projected.message, '\\u{202E} password=[redacted]');
    assert.deepEqual(projected.requester, {
      name: 'token=[redacted]',
      source: '\\u{A}api_key=[redacted]',
    });
    assert.deepEqual(projected.fields[0], {
      kind: 'single_select',
      name: 'environment',
      label: '\\u{7} password=[redacted]',
      description: '\\u{A}client_secret=[redacted]',
      required: true,
      options: [
        { value: 'production', label: '\\u{202E} token=[redacted]' },
        { value: 'staging', label: 'Staging' },
      ],
    });
    assert.doesNotMatch(JSON.stringify(projected), /message-secret|requester-secret|source-secret/);
  });

  test('drops string defaults that cannot be represented without changing canonical semantics', () => {
    const bidiDefault = '\u202e';
    const secretDefault = 'sk-live-secret';
    const projected = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: 'Review defaults',
      requester: { name: 'deploy' },
      fields: [
        {
          kind: 'string',
          name: 'direction',
          label: 'Direction',
          required: false,
          default: bidiDefault,
          minLength: 1,
          maxLength: 1,
        },
        {
          kind: 'string',
          name: 'token',
          label: 'Token',
          required: false,
          default: secretDefault,
          minLength: secretDefault.length,
          maxLength: secretDefault.length,
        },
        {
          kind: 'string',
          name: 'contact',
          label: 'Contact',
          required: false,
          default: 'password=secret@example.test',
          format: 'email',
          maxLength: 512,
        },
        {
          kind: 'string',
          name: 'safe-contact',
          label: 'Safe contact',
          required: false,
          default: 'owner@example.test',
          format: 'email',
          maxLength: 512,
        },
      ],
    });

    assert.equal(projected.fields[0]?.default, undefined);
    assert.equal(projected.fields[1]?.default, undefined);
    assert.equal(projected.fields[2]?.default, undefined);
    assert.equal(projected.fields[3]?.default, 'owner@example.test');
  });

  test('rejects form option labels that collide after safe projection', () => {
    assert.throws(() =>
      projectInteractionFormRequest({
        toolUseId: 'tool-form',
        message: 'Choose settings',
        requester: { name: 'deploy' },
        fields: [
          {
            kind: 'single_select',
            name: 'environment',
            label: 'Environment',
            required: true,
            options: [
              { value: 'first', label: 'password=first-secret' },
              { value: 'second', label: 'password=second-secret' },
            ],
          },
        ],
      }),
    );
  });

  test('reserves canonical outcome overhead before admitting an accepted form answer', () => {
    const values = {
      a: 'x'.repeat(2_048),
      b: 'x'.repeat(2_048),
      c: 'x'.repeat(2_048),
      d: 'x'.repeat(1_950),
    };
    assert.ok(
      Buffer.byteLength(JSON.stringify({ kind: 'form', action: 'accept', values })) < 8 * 1_024,
    );
    assert.throws(
      () => decodeInteractionAnswer({ kind: 'form', action: 'accept', values }),
      /Interaction form outcome exceeds serialized byte limit/,
    );
  });

  test('validates date-time calendar and clock fields without Date.parse normalization', () => {
    const field = {
      kind: 'string' as const,
      name: 'when',
      label: 'When',
      required: true,
      format: 'date-time' as const,
    };
    assert.equal(isInteractionFormFieldValueValid(field, '2024-02-29T23:59:59Z'), true);
    assert.equal(isInteractionFormFieldValueValid(field, '2023-02-29T00:00:00Z'), false);
    assert.equal(isInteractionFormFieldValueValid(field, '2023-02-30T00:00:00Z'), false);
    assert.equal(isInteractionFormFieldValueValid(field, '2024-01-01T24:00:00Z'), false);
    assert.equal(isInteractionFormFieldValueValid(field, '2024-01-01T00:00:00+24:00'), false);
  });

  test('rejects malformed form schemas and invalid accepted values', () => {
    const request = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: 'Choose settings',
      requester: { name: 'deploy' },
      fields: [
        {
          kind: 'integer',
          name: 'replicas',
          label: 'Replicas',
          required: true,
          minimum: 1,
          maximum: 10,
        },
        {
          kind: 'multi_select',
          name: 'regions',
          label: 'Regions',
          required: false,
          options: [
            { value: 'us', label: 'US' },
            { value: 'eu', label: 'EU' },
          ],
          minItems: 1,
        },
      ],
    });

    for (const values of [
      {},
      { replicas: 1.5 },
      { replicas: 11 },
      { replicas: 2, unknown: true },
      { replicas: 2, regions: [] },
      { replicas: 2, regions: ['elsewhere'] },
    ]) {
      const answer = decodeInteractionAnswer({ kind: 'form', action: 'accept', values });
      assert.equal(isInteractionAnswerValidForRequest(request, answer), false);
    }

    assert.throws(() =>
      decodeInteractionAnswer({
        kind: 'form',
        action: 'accept',
        values: { replicas: 2, regions: ['us', 'us'] },
      }),
    );

    assert.throws(() =>
      projectInteractionFormRequest({
        toolUseId: 'tool-form',
        message: 'Choose settings',
        requester: { name: 'deploy' },
        fields: [
          { kind: 'boolean', name: 'same', label: 'First', required: false },
          { kind: 'boolean', name: 'same', label: 'Second', required: false },
        ],
      }),
    );
    assert.throws(() =>
      projectInteractionFormRequest({
        toolUseId: 'tool-form',
        message: 'Choose settings',
        requester: { name: 'deploy' },
        fields: [
          {
            kind: 'single_select',
            name: 'environment',
            label: 'Environment',
            required: true,
            options: [{ value: 'staging', label: 'Staging' }],
            default: 'production',
          },
        ],
      }),
    );
  });

  test('rejects forms that cannot produce a bounded accepted answer', () => {
    assert.throws(
      () =>
        projectInteractionFormRequest({
          toolUseId: 'tool-form',
          message: 'Enter required values',
          requester: { name: 'deploy' },
          fields: Array.from({ length: 5 }, (_, index) => ({
            kind: 'string' as const,
            name: `value-${index}`,
            label: `Value ${index}`,
            required: true,
            minLength: 2_048,
            maxLength: 2_048,
          })),
        }),
      /Interaction form answer exceeds serialized byte limit/,
    );

    assert.doesNotThrow(() =>
      projectInteractionFormRequest({
        toolUseId: 'tool-form',
        message: 'Enter a timestamp',
        requester: { name: 'deploy' },
        fields: [
          {
            kind: 'string',
            name: 'when',
            label: 'When',
            required: true,
            format: 'date-time',
            minLength: 22,
            maxLength: 22,
          },
        ],
      }),
    );

    assert.throws(
      () =>
        projectInteractionFormRequest({
          toolUseId: 'tool-form',
          message: 'Optional values still consume the persisted answer envelope',
          requester: { name: 'deploy' },
          fields: Array.from({ length: 4 }, (_, index) => ({
            kind: 'string' as const,
            name: `optional-${index}`,
            label: `Optional ${index}`,
            required: false,
            maxLength: 2_048,
          })),
        }),
      /Interaction form (answer|outcome) exceeds serialized byte limit/,
    );
  });

  test('reserves the worst-case escaped answer envelope at admission', () => {
    // String constraints keep their schema semantics — maxLength in code
    // points, raw UTF-8 bytes bounded per value — so admission must prove that
    // even a fully JSON-escaped legal answer still fits the canonical
    // envelope. A form whose limits allow an undeliverable answer is rejected
    // instead of stranding the pending interaction after the user submits.
    const stringField = (name: string, maxLength?: number) => ({
      kind: 'string' as const,
      name,
      label: name,
      required: true,
      ...(maxLength === undefined ? {} : { maxLength }),
    });
    for (const fields of [
      [stringField('a', 2_048), stringField('b', 2_048)],
      [stringField('loose')],
    ]) {
      assert.throws(
        () =>
          projectInteractionFormRequest({
            toolUseId: 'tool-form',
            message: 'Enter required values',
            requester: { name: 'deploy' },
            fields,
          }),
        /Interaction form (answer|outcome) exceeds serialized byte limit/,
      );
    }

    // A form whose escaped worst case fits stays admissible, and its
    // escape-heavy legal answers — backslashes, newlines, control characters —
    // decode and deliver.
    const request = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: 'Enter a value',
      requester: { name: 'deploy' },
      fields: [stringField('value', 1_024)],
    });
    for (const heavy of ['\\'.repeat(1_024), '\n'.repeat(1_024), '\u0001'.repeat(1_024)]) {
      const answer = {
        kind: 'form' as const,
        action: 'accept' as const,
        values: { value: heavy },
      };
      assert.equal(isInteractionAnswerValidForRequest(request, answer), true);
      decodeInteractionAnswer(answer);
    }

    // The displayed character constraint keeps its meaning: 2,048 plain
    // characters or 1,024 backslashes satisfy a maxLength: 2_048 field.
    const wideField = stringField('wide', 2_048);
    assert.equal(isInteractionFormFieldValueValid(wideField, 'a'.repeat(2_048)), true);
    assert.equal(isInteractionFormFieldValueValid(wideField, '\\'.repeat(1_024)), true);

    // Select envelopes are measured in the serialized domain too: the
    // raw-longest option is not always the serialized-longest one.
    const options = [
      { value: 'a'.repeat(1_200), label: 'Plain' },
      { value: '\\'.repeat(1_000), label: 'Escaped' },
    ];
    const selectFields = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'single_select' as const,
        name: `select-${index}`,
        label: `Select ${index}`,
        required: true,
        options,
      }));
    assert.throws(() =>
      projectInteractionFormRequest({
        toolUseId: 'tool-form',
        message: 'Pick five values',
        requester: { name: 'deploy' },
        fields: selectFields(5),
      }),
    );
    assert.doesNotThrow(() =>
      projectInteractionFormRequest({
        toolUseId: 'tool-form',
        message: 'Pick three values',
        requester: { name: 'deploy' },
        fields: selectFields(3),
      }),
    );
  });

  test('admits date and date-time strings without an explicit maxLength', () => {
    // The admission envelope reserves the worst value inside each format's
    // legal language: date is fixed-length over [0-9-], and date-time adds
    // only characters that never JSON-escape. Neither may inflate to the
    // unconstrained control-character worst case.
    const request = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: 'Schedule the deploy',
      requester: { name: 'deploy' },
      fields: [
        { kind: 'string', name: 'day', label: 'Day', required: true, format: 'date' },
        { kind: 'string', name: 'at', label: 'At', required: true, format: 'date-time' },
      ],
    });
    const answer = {
      kind: 'form' as const,
      action: 'accept' as const,
      values: { day: '2024-02-29', at: '2024-02-29T23:59:59Z' },
    };
    assert.equal(isInteractionAnswerValidForRequest(request, answer), true);
    decodeInteractionAnswer(answer);

    // Fractional seconds leave the date-time length unbounded up to the field
    // caps, and the envelope reserves exactly that plain-character worst case.
    const fractional = projectInteractionFormRequest({
      toolUseId: 'tool-form',
      message: 'Schedule the deploy',
      requester: { name: 'deploy' },
      fields: [{ kind: 'string', name: 'at', label: 'At', required: true, format: 'date-time' }],
    });
    const longFraction = {
      kind: 'form' as const,
      action: 'accept' as const,
      values: { at: `2024-02-29T23:59:59.${'0'.repeat(2_020)}Z` },
    };
    assert.equal(isInteractionAnswerValidForRequest(fractional, longFraction), true);
    decodeInteractionAnswer(longFraction);
  });

  test('compares canonical accepted form values structurally', () => {
    const first = decodeInteractionCanonicalOutcome({
      kind: 'form_answer',
      action: 'accept',
      values: { regions: ['us', 'eu'], replicas: 2 },
      committedAt: 1,
    });
    const retry = decodeInteractionCanonicalOutcome({
      kind: 'form_answer',
      action: 'accept',
      values: { replicas: 2, regions: ['us', 'eu'] },
      committedAt: 2,
    });
    assert.equal(interactionCanonicalOutcomesEquivalent(first, retry), true);
    assert.equal(
      interactionCanonicalOutcomesEquivalent(
        first,
        decodeInteractionCanonicalOutcome({
          kind: 'form_answer',
          action: 'accept',
          values: { replicas: 2, regions: ['eu', 'us'] },
          committedAt: 3,
        }),
      ),
      false,
    );
  });

  test('decodes form responses as a closed renderer-to-runtime shape', () => {
    assert.deepEqual(
      decodeInteractionFormResponse({
        requestId: 'form-1',
        action: 'accept',
        values: { replicas: 3, regions: ['us', 'eu'] },
      }),
      {
        requestId: 'form-1',
        action: 'accept',
        values: { replicas: 3, regions: ['us', 'eu'] },
      },
    );
    assert.deepEqual(decodeInteractionFormResponse({ requestId: 'form-1', action: 'decline' }), {
      requestId: 'form-1',
      action: 'decline',
    });
    for (const invalid of [
      { requestId: 'form-1', action: 'accept' },
      { requestId: 'form-1', action: 'cancel', values: {} },
      { requestId: 'form-1', action: 'accept', values: {}, extra: true },
      { requestId: '', action: 'decline' },
    ]) {
      assert.throws(() => decodeInteractionFormResponse(invalid));
    }
  });
});
