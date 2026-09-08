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

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LocaleProvider,
  createTranscriptProjection,
  applyLiveTurnEvent,
  SessionAttachmentProvider,
  MakaUriContext,
} from '@maka/ui';
import { TooltipProvider } from '../../components/ui/tooltip';
import { SessionView } from '../../components/session/SessionView';
import { TipTapEditor } from '../../components/composer/TipTapEditor';
import Markdown from '../../components/ui/Markdown';
import { activeSessionStore, sessionsStore, revisionDraftStore } from '../../store/index';
import { textDocument } from '../../lib/composer-document';
const calls: any[] = [];
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: async (text: string) => calls.push(['clipboard', text]) },
  configurable: true,
});
let resolveCopy: any;
const sid = JSON.stringify(['host', 'source']);
const fork = JSON.stringify(['host', 'fork']);
const source = {
  id: sid,
  runtimeHostId: 'host',
  profileId: 'local',
  name: 'Source',
  status: 'idle',
  revision: 1,
  permissionMode: 'ask',
  runningTurnIds: [],
};
const copy = { ...source, id: fork, name: 'Copy' };
const entry = {
  entryId: 'qe',
  messageId: 'qm',
  placement: 'next_turn',
  state: 'queued',
  content: { text: 'queued original' },
};
const messages: any[] = [
  { type: 'user', id: 'u', turnId: 'turn', ts: 1, text: 'original request' },
  { type: 'assistant', id: 'a1', turnId: 'turn', ts: 2, text: 'I will inspect the code.' },
  { type: 'assistant', id: 'a2', turnId: 'turn', ts: 3, text: 'Final answer.' },
];
(window as any).maka = {
  sessions: {
    updateQueueEntry: async (...args: any[]) => {
      calls.push(['queue-edit', ...args]);
    },
    listWithCoverage: async () => ({ sessions: [source, copy], completeHostIds: ['host'] }),
    reviseBeforeTurn: async (...args: any[]) => {
      calls.push(['revise', ...args]);
      return new Promise((resolve) => {
        resolveCopy = () => resolve(copy);
      });
    },
    submitMessage: async (...args: any[]) => {
      calls.push(['send', ...args]);
      return { ok: true };
    },
    abandonSessionCopy: async (...args: any[]) => {
      calls.push(['abandon', ...args]);
    },
  },
  transcripts: {
    open: async (id: string, receive: any) => {
      receive({
        sessionId: 'fork',
        generation: 'g',
        hostEpoch: 'h',
        deliverySequence: 0,
        durableThrough: null,
        reset: true,
        ready: true,
        hasOlder: false,
        hasNewer: false,
        evictedDurableSequences: [],
        completedOverlayMessageIds: [],
        fragments: [],
      });
      return { close: async () => {} };
    },
  },
  taskReadiness: { getSnapshot: async () => ({ state: 'ready', blockers: [] }) },
};
sessionsStore.setState({ activeId: sid, sessions: [source] as any });
activeSessionStore.setState({
  sessionId: sid,
  messages,
  observationReady: true,
  loading: false,
  transientMessages: [
    {
      id: 'pending',
      text: 'pending intent',
      ts: 4,
      inlineReferences: [],
      transientPlacement: 'next_turn',
    },
  ],
  queues: { [sid]: { queueRevision: 1, entries: [entry] as any } },
});
function TestEditor() {
  const [doc, setDoc] = useState(textDocument('line one'));
  return (
    <TipTapEditor
      scopeKey="test"
      document={doc}
      onChange={setDoc}
      label="Review editor"
      placeholder="Type"
      disabled={false}
      running={true}
      onSubmit={(mode) => calls.push(['editor-submit', mode])}
      onCommand={() => {}}
      onEditor={() => {}}
      onArrow={() => false}
    />
  );
}
function App() {
  return (
    <LocaleProvider locale="en">
      <TooltipProvider>
        <div id="session">
          <SessionView
            sessionId={sid}
            composerSlot={<div />}
            onError={(...a) => calls.push(['error', ...a])}
          />
        </div>
        <div id="outside-marker" className="review-marker">
          outside Markdown
        </div>
        <div id="editor">
          <TestEditor />
        </div>
        <div id="markdown">
          <MakaUriContext.Provider value={(dest) => calls.push(['internal', dest])}>
            <SessionAttachmentProvider
              sessionId={sid}
              readBytes={async () =>
                ({
                  ok: true,
                  mimeType: 'image/png',
                  base64:
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
                }) as any
              }
            >
              <Markdown onOpenExternal={(url) => calls.push(['external', url])}>
                {
                  '[email](mailto:test@example.com)\n\n[task](maka://settings/models)\n\n```mermaid\ngraph TD; A-->B\n```\n\n![inline](maka://runtime/attachments/artifact_11111111111111111111111111111111)\n\n<style>.review-marker {color: red}</style><div class="review-marker">raw html</div>'
                }
              </Markdown>
            </SessionAttachmentProvider>
          </MakaUriContext.Provider>
        </div>
      </TooltipProvider>
    </LocaleProvider>
  );
}
Object.assign(window, {
  reviewCore: {
    calls,
    earlyReply(settled = false) {
      sessionsStore.setState({ activeId: sid, sessions: [source] as any });
      activeSessionStore.setState({
        sessionId: sid,
        messages: settled
          ? [
              {
                type: 'user',
                id: 'early-user',
                turnId: 'early-turn',
                ts: 1,
                text: 'early user prompt',
              },
            ]
          : [],
        liveTurns: {
          [sid]: applyLiveTurnEvent(
            undefined,
            {
              type: 'text_delta',
              id: 'early-event',
              turnId: 'early-turn',
              messageId: 'early-reply',
              ts: 2,
              text: 'early assistant answer',
            },
            'en',
          )!,
        },
        transientMessages: [
          {
            id: 'early-user',
            ts: 1,
            text: 'early user prompt',
            transientPlacement: 'current_turn',
            inlineReferences: [],
          },
        ],
        queues: {},
        observationReady: true,
      });
    },
    bumpQueue: () =>
      activeSessionStore.setState({
        queues: {
          [sid]: {
            queueRevision: 2,
            entries: [{ ...entry, content: { text: 'edited elsewhere' } }] as any,
          },
        },
      }),
    releaseCopy: () => resolveCopy(),
    draft: () => revisionDraftStore.getState().draft,
    turns: () => createTranscriptProjection().project({ sessionId: sid, messages, locale: 'en' }),
  },
});
createRoot(document.getElementById('root')!).render(<App />);
