# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.


# Configuration for the Maka organization server. Copy to env.local.sh (ignored
# by git), fill in, then: source apps/server/env.local.sh && npm --workspace @maka/server run start

# Where people and the desktop app reach this server (no trailing slash).
# Locally, port 3000 lets the server reuse the callbacks relx-copilot (Y)
# registered for development (see GOOGLE_REDIRECT_URI below). Stop Y's own
# frontend first if it is running on 3000.
export MAKA_SERVER_PUBLIC_URL=http://localhost:3000
export MAKA_SERVER_HOST=127.0.0.1
export MAKA_SERVER_PORT=3000
export DATABASE_URL=postgres://maka:maka@127.0.0.1:54329/maka
# openssl rand -base64 32
export MAKA_MASTER_KEY=
# Optional, comma separated. The identity providers already decide who can
# sign in; set this only for a Google OAuth client of the External type.
export MAKA_ALLOWED_EMAIL_DOMAINS=
# Comma separated. These people become organization admins on first sign-in.
export MAKA_BOOTSTRAP_ADMIN_EMAILS=
# Behind a reverse proxy: which proxies' X-Forwarded-For to believe (a hop count,
# or addresses/CIDRs). Unset, the peer address is the client.
# export MAKA_TRUST_PROXY=1
# Optional: refuse desktop apps older than this version.
export MAKA_MIN_CLIENT_VERSION=

# Google Workspace: Y's OAuth client (an Internal client admits only the company's accounts).
export GOOGLE_CLIENT_ID=
export GOOGLE_CLIENT_SECRET=
# The callback registered on that client; Y's development one by default.
export GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# RELX SSO: Y's application (Y calls these ENTERPRISE_* in its environment).
export RELX_SSO_CLIENT_ID=
export RELX_SSO_CLIENT_SECRET=
export RELX_SSO_AUTHORIZE_URL=
export RELX_SSO_TOKEN_URL=
export RELX_SSO_USERINFO_URL=
# The callback registered on that application; Y's development one by default.
export RELX_SSO_REDIRECT_URI=http://localhost:3000/auth/enterprise/callback
