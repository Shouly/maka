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

import * as api from '../bridge/connections.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';
import { createResourceStore } from './resource-store.js';

export function createConnectionsStore() {
  const store = createResourceStore<api.DesktopConnectionSnapshot>();
  return {
    ...store,
    observe(sessionId: string | undefined, host: DesktopRuntimeHostRef) {
      return store.connect(
        () => api.getConnectionSnapshot(sessionId, host),
        (refresh) => api.subscribeConnectionEvents(refresh, host),
      );
    },
    setDefault: (
      connection: Parameters<typeof api.setDefaultConnection>[0],
      host: DesktopRuntimeHostRef,
    ) => store.mutate(() => api.setDefaultConnection(connection, host)),
    setDefaultModel: (
      input: Parameters<typeof api.setDefaultModel>[0],
      host: DesktopRuntimeHostRef,
    ) => store.mutate(() => api.setDefaultModel(input, host)),
    create: (input: Parameters<typeof api.createConnection>[0], host: DesktopRuntimeHostRef) =>
      store.mutate(() => api.createConnection(input, host)),
    update: (
      id: api.DesktopConnectionIdentity,
      input: Parameters<typeof api.updateConnection>[1],
      host: DesktopRuntimeHostRef,
    ) => store.mutate(() => api.updateConnection(id, input, host)),
    remove: (id: api.DesktopConnectionIdentity, host: DesktopRuntimeHostRef) =>
      store.mutate(() => api.deleteConnection(id, host)),
  };
}
export const connectionsStore = createConnectionsStore();
