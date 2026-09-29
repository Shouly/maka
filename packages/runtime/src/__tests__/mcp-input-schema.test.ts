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
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import { modelFacingInputSchema } from '../mcp-input-schema.js';

const ajv = new Ajv2020({ strict: false });

function rewrite(schema: Record<string, unknown>): Record<string, unknown> {
  const before = structuredClone(schema);
  const out = modelFacingInputSchema(schema);
  assert.deepEqual(schema, before, 'the server declaration is left as it was');
  assert.equal(ajv.validateSchema(out), true, JSON.stringify(ajv.errors));
  return out;
}

test('a valid schema passes through, less its $schema', () => {
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { path: { type: 'string', default: { items: [1, 2], $schema: 'data' } } },
    required: ['path'],
    additionalProperties: false,
  };
  const { $schema: _dialect, ...rest } = schema;
  assert.deepEqual(rewrite(schema), rest);
  assert.deepEqual(rewrite({ properties: {} }), { properties: {}, type: 'object' });
});

test('a draft-07 tuple becomes one element schema with its length kept', () => {
  assert.deepEqual(
    rewrite({
      type: 'object',
      properties: {
        position: {
          type: 'array',
          items: [{ type: 'integer' }, { type: 'integer' }],
          additionalItems: false,
          minItems: 2,
        },
        pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
        rest: { type: 'array', items: [{ type: 'string' }], additionalItems: { type: 'boolean' } },
      },
    }).properties,
    {
      position: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
      pair: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
      rest: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } },
    },
  );
});

test('draft-04 boolean exclusive bounds become numeric ones', () => {
  assert.deepEqual(
    rewrite({
      type: 'object',
      properties: {
        above: { type: 'number', minimum: 0, exclusiveMinimum: true },
        below: { type: 'number', maximum: 10, exclusiveMaximum: false },
      },
    }).properties,
    {
      above: { type: 'number', exclusiveMinimum: 0 },
      below: { type: 'number', maximum: 10 },
    },
  );
});

test('a property the request cannot name is not offered, at any depth', () => {
  assert.deepEqual(
    rewrite({
      type: 'object',
      properties: {
        '$.xgafv': { type: 'string' },
        fileId: { type: 'string' },
        options: { type: 'object', properties: { 'x y': { type: 'string' }, 'a.b-c_d': {} } },
      },
      required: ['$.xgafv', 'fileId'],
    }),
    {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        options: { type: 'object', properties: { 'a.b-c_d': {} } },
      },
      required: ['fileId'],
    },
  );
});

test('a root anyOf/oneOf/allOf is flattened into one object', () => {
  assert.deepEqual(
    rewrite({
      type: 'object',
      properties: { mode: { type: 'string' } },
      required: ['mode'],
      allOf: [{ properties: { id: { type: 'string' } }, required: ['id'] }],
      oneOf: [
        { properties: { url: { type: 'string' } }, required: ['url'] },
        { properties: { path: { type: 'string' }, mode: { type: 'number' } }, required: ['path'] },
      ],
    }),
    {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        id: { type: 'string' },
        url: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['mode', 'id'],
    },
  );
  // Nested combinators are valid and stay.
  const nested = { type: 'object', properties: { v: { anyOf: [{ type: 'string' }] } } };
  assert.deepEqual(rewrite(nested), nested);
});

test('what cannot be repaired is offered as an open object', () => {
  assert.deepEqual(rewrite({ type: 'object', properties: { a: { type: 'strnig' } } }), {
    type: 'object',
  });
  assert.deepEqual(rewrite({ type: 'object', required: 'a' }), { type: 'object' });
  assert.deepEqual(rewrite({ type: 'array', items: { type: 'string' } }), { type: 'object' });
});
