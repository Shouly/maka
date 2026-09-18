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
 * The background memory pass, as the Runtime sees it: after each finished
 * turn the Host is handed the exchange and files what is durable. The Runtime
 * never waits on it and never learns what it wrote.
 */

/** One finished exchange, the way the pass re-reads it. */
export interface MemoryPassTurn {
  readonly sessionId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly userText: string;
  readonly assistantText: string;
  /**
   * A memory tool succeeded in this turn. The pass leaves such turns alone: an
   * explicit remember/forget is the one that stands, and a "forget" is a
   * boundary the pass never overrides by re-saving.
   */
  readonly wroteMemory: boolean;
}

export interface MemoryPassCapability {
  turnCompleted(turn: MemoryPassTurn): void;
}
