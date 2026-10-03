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

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeWebSearchLimit, normalizeWebSearchQuery } from '../web-search.js';

describe('web search', () => {
  it('normalizes bounded queries and result limits', () => {
    assert.equal(normalizeWebSearchQuery('  hello world  '), 'hello world');
    for (const value of ['   ', undefined]) {
      assert.equal(normalizeWebSearchQuery(value), null);
    }
    assert.equal(normalizeWebSearchQuery('a'.repeat(201))?.length, 200);

    const limits: Array<[unknown, number]> = [
      [undefined, 5],
      [NaN, 5],
      [0, 1],
      [3.7, 3],
      [11, 10],
    ];
    for (const [value, expected] of limits) assert.equal(normalizeWebSearchLimit(value), expected);
  });
});
