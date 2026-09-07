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

// The `notifications` namespace of the preload bridge, wrapped.
//
// Fire-and-forget by contract: main gates on the product toggle and window
// focus before it raises anything, so a rejection here is not the caller's
// problem and never becomes one.

import { tryNamespace } from './bridge.js';

export function notifyRunEnded(payload: {
  kind: 'completed' | 'errored';
  title?: string;
  body?: string;
}): void {
  void tryNamespace('notifications')
    ?.runEnded(payload)
    .catch(() => {});
}
