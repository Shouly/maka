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

import type { UserQuestion, UserQuestionOption, UserQuestionRequest } from './user-question.js';
import { defineObjectShape, hasExactShape, isOptionalString, isRecord } from './record-schema.js';

const QUESTION_REQUEST_SHAPE = defineObjectShape<UserQuestionRequest>()(
  ['requestId', 'toolUseId', 'questions'],
  [],
);
const QUESTION_SHAPE = defineObjectShape<UserQuestion>()(
  ['question', 'header', 'options'],
  ['multiSelect'],
);
const QUESTION_OPTION_SHAPE = defineObjectShape<UserQuestionOption>()(['label'], ['description']);

export function isUserQuestionRequest(value: unknown): value is UserQuestionRequest {
  return (
    isRecord(value) &&
    hasExactShape(value, QUESTION_REQUEST_SHAPE) &&
    typeof value.requestId === 'string' &&
    typeof value.toolUseId === 'string' &&
    Array.isArray(value.questions) &&
    value.questions.every(isUserQuestion)
  );
}

function isUserQuestion(value: unknown): value is UserQuestion {
  return (
    isRecord(value) &&
    hasExactShape(value, QUESTION_SHAPE) &&
    typeof value.question === 'string' &&
    typeof value.header === 'string' &&
    (value.multiSelect === undefined || typeof value.multiSelect === 'boolean') &&
    Array.isArray(value.options) &&
    value.options.every(isUserQuestionOption)
  );
}

function isUserQuestionOption(value: unknown): value is UserQuestionOption {
  return (
    isRecord(value) &&
    hasExactShape(value, QUESTION_OPTION_SHAPE) &&
    typeof value.label === 'string' &&
    isOptionalString(value.description)
  );
}
