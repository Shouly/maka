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

import { createSqliteArtifactStoreWriteAuthority } from '../../artifact-store.js';
const root = process.argv[2];
if (!root || !process.send) throw new Error('Crash fixture requires a test root and IPC');
const { store } = createSqliteArtifactStoreWriteAuthority(root);
const candidate = {
  sessionId: 'session-1',
  turnId: 'turn-1',
  kind: 'file' as const,
  source: 'user_delivery' as const,
};
await store.createBatch([
  {
    ...candidate,
    id: 'first',
    name: 'first.txt',
    readContent: async () => 'durable but unreferenced',
  },
  {
    ...candidate,
    id: 'second',
    name: 'second.txt',
    readContent: async () => {
      process.send!({ phase: 'staged' });
      await new Promise(() => {
        process.on('message', () => {});
      });
      return 'unreachable';
    },
  },
]);
