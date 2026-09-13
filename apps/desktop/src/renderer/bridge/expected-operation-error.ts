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

// Ported from upstream `application/contracts/operation-diagnostics.ts`
// (#4878): the transport for an expected operation failure that crosses IPC
// as a stable code. The shell copy recognizes it by name and renders the
// code's reason instead of a redacted diagnostic.

export class ExpectedOperationError<Code extends string = string> extends Error {
  constructor(readonly code: Code) {
    super(code);
    this.name = 'ExpectedOperationError';
  }
}
