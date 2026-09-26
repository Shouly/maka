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

// Shared plumbing the modules receive instead of reaching for globals, so a
// test can pin the clock and swap the database.

import type { Kysely } from 'kysely';
import type { ServerConfig } from './config.js';
import type { SecretBox } from './crypto/secret-box.js';
import type { Database } from './db/schema.js';

export type Clock = () => Date;

export interface ServerContext {
  readonly config: ServerConfig;
  readonly db: Kysely<Database>;
  readonly secrets: SecretBox;
  readonly now: Clock;
}
