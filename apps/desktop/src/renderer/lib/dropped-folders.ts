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

import { MAX_ATTACHMENT_DROP_COUNT } from '@maka/core/attachments';

/**
 * What one drop or paste may stage. A folder copied in Finder or dragged in
 * arrives as a File that can never be read, so it would stage as a sendable
 * card and fail only on send; it is left out, and the files beside it stay.
 * A drop too large to check stages nothing: none may stage unchecked, and it
 * could never be sent anyway. A folder is not turned into a folder reference:
 * a reference is a live path the model reads, an attachment is uploaded
 * content.
 */
export type DroppedFiles =
  | { readonly kind: 'too_many' }
  | { readonly kind: 'checked'; readonly accepted: readonly File[]; readonly folders: number };

export async function withoutDroppedFolders(
  files: readonly File[],
  detectDirectories: (files: readonly File[]) => Promise<readonly boolean[]>,
): Promise<DroppedFiles> {
  if (files.length > MAX_ATTACHMENT_DROP_COUNT) return { kind: 'too_many' };
  let directories: readonly boolean[] = [];
  try {
    directories = await detectDirectories(files);
  } catch {
    // Best effort: a file that cannot be classified stages as before, and the
    // send names it if it turns out to be unreadable.
  }
  const accepted = files.filter((_, index) => directories[index] !== true);
  return { kind: 'checked', accepted, folders: files.length - accepted.length };
}
