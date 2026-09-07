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

// The `browser` namespace of the preload bridge, wrapped.
//
// `setActiveSession` and `setViewport` are synchronous `void` on the contract
// — they publish geometry for a native `WebContentsView` that main positions
// over the renderer, and a Promise there would put the view a frame behind the
// layout it is tracking.

import type { BrowserState, BrowserViewRect } from '@maka/core/browser';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Browser = MakaBridge['browser'];

export type { BrowserState, BrowserViewRect };

const browser = (): Browser => requireNamespace('browser');

export function setActiveBrowserSession(sessionId: string | null): void {
  tryNamespace('browser')?.setActiveSession(sessionId);
}

export function setBrowserViewport(input: {
  sessionId: string;
  rect: BrowserViewRect | null;
}): void {
  tryNamespace('browser')?.setViewport(input);
}

export function navigateBrowser(sessionId: string, url: string): Promise<void> {
  return browser().navigate(sessionId, url);
}

export function browserBack(sessionId: string): Promise<void> {
  return browser().back(sessionId);
}

export function browserForward(sessionId: string): Promise<void> {
  return browser().forward(sessionId);
}

export function reloadBrowser(sessionId: string): Promise<void> {
  return browser().reload(sessionId);
}

export function stopBrowser(sessionId: string): Promise<void> {
  return browser().stop(sessionId);
}

export function closeBrowser(sessionId: string): Promise<void> {
  return browser().close(sessionId);
}

export function getBrowserState(sessionId: string): Promise<BrowserState | null> {
  return browser().getState(sessionId);
}

export function subscribeBrowserState(
  handler: (payload: { sessionId: string; state: BrowserState }) => void,
): () => void {
  return toUnsubscribe(tryNamespace('browser')?.onState(handler));
}

export function subscribeBrowserLive(
  handler: (payload: { sessionIds: string[] }) => void,
): () => void {
  return toUnsubscribe(tryNamespace('browser')?.onLive(handler));
}
