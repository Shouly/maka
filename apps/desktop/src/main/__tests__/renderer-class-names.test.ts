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

// `cn` is one line, and the one line is the whole point: every ported
// component ends its class list with `className`, and that only overrides the
// component's defaults because `twMerge` resolves Tailwind conflicts last-wins.
// Swap it for a plain join and nothing fails to compile — the caller's class
// just silently loses to the default it was written to replace.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cn } from '../../renderer/lib/cn.js';

test('the caller’s class wins the conflict, which is why twMerge is here', () => {
  assert.equal(cn('bg-surface-1', 'bg-surface-2'), 'bg-surface-2');
  assert.equal(cn('px-2 py-1', 'px-4'), 'py-1 px-4');
});

test('non-conflicting classes are all kept, in order', () => {
  assert.equal(
    cn('inline-flex items-center', 'text-text-primary'),
    'inline-flex items-center text-text-primary',
  );
});

test('the conditional forms every component uses are flattened', () => {
  assert.equal(cn('base', false && 'skipped', undefined, null), 'base');
  assert.equal(cn('base', { active: true, disabled: false }), 'base active');
  assert.equal(cn(['a', ['b', 'c']]), 'a b c');
});

test('no arguments is the empty string, not "undefined"', () => {
  assert.equal(cn(), '');
});
