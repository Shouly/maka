<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# patches

Applied on root `postinstall` via `scripts/apply-dependency-patches.mjs`
(`patch-package --error-on-fail`). After bumping a patched dependency, re-run
`npx patch-package <name>` so the filename tracks the installed version.

Keep this directory small. Prefer product code that uses the dependency's
published API; only patch for bugs that block shipping and cannot be worked
around at the call site.

## `@tufjs/models@5.0.0` and `@sigstore/core@4.0.1`

The published ECDSA verification paths rely on Node choosing a digest when
`crypto.verify` receives `undefined`. Electron 43's crypto runtime rejects that
call with `ERR_OSSL_EVP_NO_DEFAULT_DIGEST`, so packaged Desktop cannot load the
Sigstore TUF root or verify Rekor and DSSE signatures for an update. The patches
select SHA-256 for RSA/ECDSA and preserve digest-free EdDSA verification at the
two shared crypto seams.

Delete each patch when the corresponding package ships explicit SHA-256
verification and the Electron regression tests pass without it.

## `node-pty@1.2.0-beta.15`

On Unix, `CustomWriteStream` submits raw file-descriptor writes through libuv.
Those writes can survive PTY exit and target an unrelated file after descriptor
reuse. The patch keeps writes synchronous on node-pty's non-blocking PTY master,
checks an `fstat` fingerprint before retries, yields between attempts, and cancels
the queue at the native exit fence. See #2978.

Delete when node-pty ships an equivalent Unix write-lifecycle fix.

## `@ai-sdk/provider-utils@5.0.34`

Streaming tool-call association for gateways that reuse or omit `index` / `id`
(Ollama-style, Anthropic→OpenAI translators). See #1967 / #1976 and
`packages/runtime/src/__tests__/model-factory-tool-call-index.test.ts`.

Delete when that guard passes against an unpatched package.
