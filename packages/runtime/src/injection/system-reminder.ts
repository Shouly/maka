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

// The envelope every system-delivered block wears in the conversation.
//
// The provider wire has two speaking roles and one system prompt. Anything
// the system has to say mid-conversation therefore rides in a user-role
// message, and the envelope is the only thing that marks it as not the
// user's words. It is data to the model, never a message to answer — the
// block itself says so where that matters.

export const SYSTEM_REMINDER_OPEN = '<system-reminder>';
export const SYSTEM_REMINDER_CLOSE = '</system-reminder>';

/** One block, on its own lines; a one-line body stays on one line. */
export function wrapSystemReminder(body: string): string {
  const text = body.trim();
  return text.includes('\n')
    ? `${SYSTEM_REMINDER_OPEN}\n${text}\n${SYSTEM_REMINDER_CLOSE}`
    : `${SYSTEM_REMINDER_OPEN}${text}${SYSTEM_REMINDER_CLOSE}`;
}

/**
 * The text that follows any leading reminder blocks — the user's own words in
 * a user message that carries reminders, or the empty string when the message
 * is nothing but reminders (a per-turn block).
 */
export function textAfterSystemReminders(content: string): string {
  let rest = content;
  for (;;) {
    const trimmed = rest.trimStart();
    if (!trimmed.startsWith(SYSTEM_REMINDER_OPEN)) return rest.trim();
    const close = trimmed.indexOf(SYSTEM_REMINDER_CLOSE);
    if (close === -1) return '';
    rest = trimmed.slice(close + SYSTEM_REMINDER_CLOSE.length);
  }
}
