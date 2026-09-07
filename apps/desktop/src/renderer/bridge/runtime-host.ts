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

// The `runtimeHost` namespace of the preload bridge, wrapped.
//
// The renderer may call Runtime Host directly for exactly seven operations —
// four read-only queries and three commands (`runtime-host-renderer-operations`
// is the allowlist, and the preload enforces it). Everything else goes through
// a purpose-built namespace. The operation type parameter is what keeps a
// caller from widening that list by accident.

import type { OperationInput, OperationOutput } from '@maka/runtime-host/protocol';
import type {
  RendererRuntimeHostCommandOperation,
  RendererRuntimeHostQueryOperation,
} from '../../preload/runtime-host-renderer-operations.js';
import { requireNamespace } from './bridge.js';

export type { RendererRuntimeHostQueryOperation, RendererRuntimeHostCommandOperation };

export function queryRuntimeHost<K extends RendererRuntimeHostQueryOperation>(
  operation: K,
  input: OperationInput<K>,
): Promise<OperationOutput<K>> {
  return requireNamespace('runtimeHost').query(operation, input);
}

export function commandRuntimeHost<K extends RendererRuntimeHostCommandOperation>(
  operation: K,
  input: OperationInput<K>,
): Promise<OperationOutput<K>> {
  return requireNamespace('runtimeHost').command(operation, input);
}
