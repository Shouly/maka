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
 * Pressing a transcript gap is a command, so it releases the tail pin before
 * it asks for the page (SessionView's rule: every command releases the pin
 * first). A reader who reached the gap without scrolling — Tab, then Enter —
 * keeps their place when the page lands instead of being carried back to the
 * tail.
 */
export function pressTranscriptGap(
  authority: { releasePin(): void },
  loadHistory: (target: 'earlier' | 'later') => unknown,
  direction: 'older' | 'newer',
): void {
  authority.releasePin();
  void loadHistory(direction === 'older' ? 'earlier' : 'later');
}
