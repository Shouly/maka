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
 * A variable a sandboxed command does not inherit: anything whose name says
 * it holds a credential. The sandbox limits what a command can touch on disk,
 * not what it can send over the network Manual leaves open, so the keys in the
 * desktop's own environment stay out of it. Full access inherits everything,
 * as the user's own shell would.
 */
const SENSITIVE_ENV_NAME = /KEY|SECRET|TOKEN/i;

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_NAME.test(name);
}

/** The environment a sandboxed command is launched with. */
export function sandboxedEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !isSensitiveEnvName(name)),
  ) as NodeJS.ProcessEnv;
}
