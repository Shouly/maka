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

// The `artifacts` namespace of the preload bridge, wrapped.

import type {
  ArtifactBinaryReadResult,
  ArtifactDescriptor,
  ArtifactTextReadResult,
} from '@maka/core/artifacts';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

const artifacts = (): MakaBridge['artifacts'] => requireNamespace('artifacts');

export function listArtifacts(sessionId: string): Promise<ArtifactDescriptor[]> {
  return artifacts().list(sessionId);
}

export function readArtifactText(
  sessionId: string,
  artifactId: string,
): Promise<ArtifactTextReadResult> {
  return artifacts().readText(sessionId, artifactId);
}

export function readArtifactBinary(
  sessionId: string,
  artifactId: string,
): Promise<ArtifactBinaryReadResult> {
  return artifacts().readBinary(sessionId, artifactId);
}

export function deleteArtifact(sessionId: string, artifactId: string): Promise<void> {
  return artifacts().delete(sessionId, artifactId);
}
