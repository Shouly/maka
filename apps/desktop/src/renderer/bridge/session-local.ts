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

import { requireNamespace, tryNamespace, toUnsubscribe } from './bridge.js';
export type {
  DesktopLocalMessage,
  DesktopLocalMessageState,
} from '../../shared/session-local-contract.js';
export const listLocalMessages = (sessionId: string) =>
  requireNamespace('sessionLocal').listMessages(sessionId);
export const cancelLocalMessage = (sessionId: string, messageId: string) =>
  requireNamespace('sessionLocal').cancelMessage(sessionId, messageId);
export const reconcileLocalMessage = (sessionId: string, messageId: string) =>
  requireNamespace('sessionLocal').reconcileMessage(sessionId, messageId);
export const subscribeLocalMessageChanges = (handler: (sessionId: string) => void) =>
  toUnsubscribe(tryNamespace('sessionLocal')?.subscribeChanges(handler));
