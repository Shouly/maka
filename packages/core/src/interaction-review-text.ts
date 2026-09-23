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

/**
 * Bounding and sanitising for text a person is about to read and act on.
 *
 * Every string an Interaction shows — a question, an option label, a form
 * field — reaches the reader through here, so none of them can carry the
 * characters that make displayed text lie about itself: C0/C1 controls, the
 * bidirectional overrides, and the line/paragraph separators. Secrets are
 * redacted on the same pass, because a prompt is also a place a credential
 * can leak into.
 */

import { redactSecrets } from './redaction.js';

const UTF8 = new TextEncoder();

const UNSAFE_REVIEW_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

export type InteractionReviewTextErrorReason = 'unrepresentable_review';

export class InteractionReviewTextError extends Error {
  readonly reason: InteractionReviewTextErrorReason = 'unrepresentable_review';

  constructor(message = 'Interaction review text cannot be safely represented') {
    super(message);
    this.name = 'InteractionReviewTextError';
  }
}

/**
 * The reviewable form of `value`, or a throw when it does not have one.
 *
 * Unsafe characters are escaped rather than dropped, so a string that tried to
 * hide something still shows that it did.
 */
export function projectInteractionReviewText(
  value: string,
  maxBytes: number,
  allowEmpty = false,
): string {
  if (!allowEmpty && value.length === 0) throw new InteractionReviewTextError();
  const safe = redactSecrets(value).replace(
    UNSAFE_REVIEW_CHARACTER,
    (char) => `\\u{${char.codePointAt(0)!.toString(16).toUpperCase()}}`,
  );
  if (UTF8.encode(safe).byteLength > maxBytes) throw new InteractionReviewTextError();
  return safe;
}
