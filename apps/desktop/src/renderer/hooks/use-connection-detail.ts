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

// The two facts a connection's detail page cannot read from the catalog
// snapshot, and the busy state its buttons share.
//
// `hasSecret` and the saved request-header names live in the credential vault,
// not in the projected connection, so they are separate reads with their own
// three states. The distinction that matters is UNKNOWN versus ABSENT: a page
// that renders "no key set" while the read is still in flight tells the user
// their credential is gone every time they open it, and the honest answer for
// that fraction of a second is "still looking".

import { useCallback, useState } from 'react';
import {
  connectionHasSecret,
  getConnectionRequestHeaders,
  type DesktopConnectionIdentity,
} from '../bridge/connections.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';
import { useAsync } from './use-async.js';

/** What the API-key row knows about the stored credential. */
export type CredentialState = 'loading' | 'set' | 'missing' | 'unknown';

export interface ConnectionDetailReads {
  readonly credential: CredentialState;
  readonly savedHeaderNames: readonly string[] | undefined;
  readonly headersLoading: boolean;
  readonly reloadCredential: () => void;
  readonly reloadHeaders: () => void;
}

export function useConnectionDetailReads(
  connection: DesktopConnectionIdentity,
  host: DesktopRuntimeHostRef | undefined,
): ConnectionDetailReads {
  const secret = useAsync(
    () => connectionHasSecret(connection, host),
    [connection.connectionId, host?.profileId, host?.hostId],
  );
  const headers = useAsync(
    () => getConnectionRequestHeaders(connection, host),
    [connection.connectionId, host?.profileId, host?.hostId],
  );
  return {
    // A failed read is `unknown`, never `missing`: the vault not answering is
    // not evidence that it holds nothing, and offering "set a key" on that
    // basis invites the user to overwrite one that is already there.
    credential: secret.loading
      ? 'loading'
      : secret.error !== undefined
        ? 'unknown'
        : secret.data
          ? 'set'
          : 'missing',
    savedHeaderNames: headers.data?.names,
    headersLoading: headers.loading,
    reloadCredential: secret.reload,
    reloadHeaders: headers.reload,
  };
}

/**
 * One busy flag for a page whose buttons all write to the same connection.
 *
 * Not per-button: testing a connection while its model catalog is being
 * refetched is two Host operations against one revision, and the second one
 * comes back `superseded`. One flag makes that unreachable instead of
 * recoverable.
 */
export function useConnectionAction(): {
  readonly busy: boolean;
  readonly run: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
} {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await operation();
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
