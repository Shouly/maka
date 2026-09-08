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

// The bridge barrel.
//
// Namespaced re-exports rather than a flat `export *`: the preload API has
// thirty-odd namespaces with colliding verbs (`list`, `create`, `remove`,
// `subscribeChanges`), and a flat surface would either rename all of them or
// collide. Callers write `sessions.listSessions(...)`, which also makes every
// bridge call greppable by namespace.

export * as app from './app.js';
export * as appWindow from './app-window.js';
export * as artifacts from './artifacts.js';
export * as attachments from './attachments.js';
export * as browser from './browser.js';
export * as config from './config.js';
export * as connections from './connections.js';
export * as diagnostics from './diagnostics.js';
export * as e2eFixture from './e2e-fixture.js';
export * as externalLinks from './external-links.js';
export * as gitReview from './git-review.js';
export * as goal from './goal.js';
export * as inspector from './inspector.js';
export * as mcp from './mcp.js';
export * as memory from './memory.js';
export * as newTasks from './new-tasks.js';
export * as notifications from './notifications.js';
export * as oauth from './oauth.js';
export * as onboarding from './onboarding.js';
export * as permissions from './permissions.js';
export * as projects from './projects.js';
export * as runtimeHost from './runtime-host.js';
export * as runtimeHostProfiles from './runtime-host-profiles.js';
export * as scheduledTasks from './scheduled-tasks.js';
export * as search from './search.js';
export * as sessionKeys from './session-keys.js';
export * as sessions from './sessions.js';
export * as settings from './settings.js';
export * as shellRuns from './shell-runs.js';
export * as skills from './skills.js';
export * as taskReadiness from './task-readiness.js';
export * as transcripts from './transcripts.js';
export * as webSearch from './web-search.js';
export * as workspace from './workspace.js';

export { BridgeUnavailableError, isBridgeAvailable } from './bridge.js';
