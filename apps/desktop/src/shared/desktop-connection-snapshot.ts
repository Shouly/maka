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

import type { ChatModelChoice } from '@maka/core/chat-model-choice';
import type { ProjectedLlmConnection } from '@maka/core/llm-connections';

/** Immutable identity plus the human-readable locator last shown by Desktop. */
export interface DesktopConnectionIdentity {
  readonly connectionId: string;
  readonly slug: string;
}

export interface DesktopConnectionSnapshot {
  readonly connections: ProjectedLlmConnection[];
  readonly defaultConnection: string | null;
  readonly chatModelChoices: ChatModelChoice[];
}

/**
 * Where the Host's model metadata (models.dev) came from and how its refresh
 * is going; the Models settings page shows it so a stale or failing catalog
 * is visible instead of silently narrowing what the pickers offer.
 */
export interface DesktopModelCatalogStatus {
  readonly active: 'bundled' | 'cache' | 'refreshed';
  readonly fetchedAt: number | null;
  readonly lastAttempt: {
    readonly at: number;
    readonly outcome: 'changed' | 'unchanged' | 'failed' | 'skipped';
    /** The failure's message; for a skipped attempt, `privacy_mode` or `proxy_credential_not_configured`. */
    readonly error?: string;
  } | null;
  readonly nextAttemptAt: number | null;
}
