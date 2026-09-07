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

// The `attachments` namespace of the preload bridge, wrapped.
//
// Picking happens in main (a native dialog), so the renderer never sees a path
// — it gets an `approvalId` it can preview and hand back on send.

import type { ArtifactBinaryReadResult } from '@maka/core/artifacts';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

type Attachments = MakaBridge['attachments'];

export type AttachmentPickDirectoryResult = Awaited<ReturnType<Attachments['pickDirectory']>>;
export type AttachmentPickFilesResult = Awaited<ReturnType<Attachments['pickFiles']>>;
export type AttachmentPreviewResult = Awaited<ReturnType<Attachments['previewApproval']>>;

const attachments = (): Attachments => requireNamespace('attachments');

export function pickAttachmentDirectory(): Promise<AttachmentPickDirectoryResult> {
  return attachments().pickDirectory();
}

export function pickAttachmentFiles(): Promise<AttachmentPickFilesResult> {
  return attachments().pickFiles();
}

export function previewAttachmentApproval(approvalId: string): Promise<AttachmentPreviewResult> {
  return attachments().previewApproval(approvalId);
}

export function readAttachmentBytes(
  sessionId: string,
  artifactId: string,
): Promise<ArtifactBinaryReadResult> {
  return attachments().readBytes(sessionId, artifactId);
}
