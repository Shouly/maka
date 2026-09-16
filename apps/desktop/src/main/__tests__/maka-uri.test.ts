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
import {
  isMakaUriCandidate,
  isSafeExternalScheme,
  parseMakaUri,
  parseComputerFileUri,
} from '@maka/ui/maka-uri';

describe('Maka URI safety boundary', () => {
  it('parses only supported settings and compose destinations', () => {
    assert.deepEqual(parseMakaUri('maka://settings/general'), {
      kind: 'settings',
      section: 'general',
    });
    assert.deepEqual(parseMakaUri('maka://compose?text=hello'), {
      kind: 'compose',
      text: 'hello',
    });
    assert.deepEqual(parseMakaUri('maka://compose/?text=%E4%BD%A0%E5%A5%BD'), {
      kind: 'compose',
      text: '你好',
    });
  });

  it('rejects malformed, case-variant, and oversized internal URIs', () => {
    const invalidInputs: unknown[] = [
      '',
      null,
      'https://example.com/',
      'Maka://settings/account',
      'maka://',
      'maka:settings/account',
      `maka://compose?text=${'x'.repeat(8192)}`,
    ];
    for (const input of invalidInputs) {
      assert.equal(parseMakaUri(input as string), null, String(input));
    }
  });

  it('rejects widened settings, compose, and action namespaces', () => {
    const invalidHrefs = [
      'maka://settings/zzz',
      'maka://settings/',
      'maka://settings/account/edit',
      'maka://settings/account?force=1',
      'maka://settings/account#section',
      'maka://SETTINGS/account',
      'maka://compose?text=',
      'maka://compose?other=value',
      'maka://compose/run?text=hi',
      'maka://tool/Bash?cmd=ls',
      'maka:///account',
      'maka://user@settings/account',
      'maka://settings:9999/account',
    ];
    for (const href of invalidHrefs) assert.equal(parseMakaUri(href), null, href);
  });

  it('flags case-variant internal candidates without allowing navigation', () => {
    for (const href of [
      'maka://settings/account',
      'Maka://settings/account',
    ]) {
      assert.equal(isMakaUriCandidate(href), true, href);
      if (!href.startsWith('maka:')) assert.equal(parseMakaUri(href), null, href);
    }
    for (const input of [
      'https://example.com/',
      'makafake://oops',
      null,
    ]) {
      assert.equal(isMakaUriCandidate(input as string), false, String(input));
    }
  });

  it('allows only explicit external schemes', () => {
    for (const href of [
      'http://example.com',
      'https://example.com/path?q=1',
      'mailto:user@example.com',
    ]) {
      assert.equal(isSafeExternalScheme(href), true, href);
    }

    const rejected: unknown[] = [
      '',
      null,
      'not a url',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'maka://settings/account',
      'ftp://host',
    ];
    for (const href of rejected) {
      assert.equal(isSafeExternalScheme(href as string), false, String(href));
    }
  });
});

describe('computer:// file citations', () => {
  it('reads a relative markdown link as a path, so a citation can be opened', () => {
    // The reference's own scheme for citing a file on the person's machine.
    assert.equal(parseComputerFileUri('computer://src/foo.ts'), 'src/foo.ts');
    assert.equal(parseComputerFileUri('computer://README.md'), 'README.md');
    assert.equal(parseComputerFileUri('computer://docs/a%20b.md'), 'docs/a b.md');
    // A single leading `./` is the same path spelled differently, and unlike
    // `..` it cannot change which file is named.
    assert.equal(parseComputerFileUri('computer://./docs/a%20b.md'), 'docs/a b.md');
  });

  it('refuses rather than repairs anything that is not a workspace-relative path', () => {
    for (const href of [
      'computer:///etc/passwd', // rooted
      'computer://../../etc/passwd', // traversal
      'computer://%2e%2e/etc/passwd', // traversal, encoded
      'computer://a/../b', // traversal in the middle
      'computer://a/./b', // non-canonical
      'computer://./', // names nothing
      'computer://.', // names nothing
      'computer://C:/Windows/system32', // drive letter
      'computer://a?b=1', // a query is not part of a path
      'computer://a\u0000b', // control character
      'computer://', // empty
      'https://example.com', // a different scheme
      'mailto:a@b.c', // a different scheme
      'maka://settings/models', // the internal surface owns this one
      'src/foo.ts', // a bare path is not a citation link
      '//evil.com', // protocol-relative, not a path
      '#heading', // an anchor
      '', // empty
    ]) {
      assert.equal(parseComputerFileUri(href), null, href);
    }
  });

  it('keeps the internal navigation surface closed to files', () => {
    // `maka:` stays settings + compose; file citations are their own scheme.
    assert.equal(parseMakaUri('maka://file/src/foo.ts'), null);
  });
});
