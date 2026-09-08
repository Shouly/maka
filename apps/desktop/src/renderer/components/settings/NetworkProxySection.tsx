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

// The proxy every outbound request goes through, and a way to prove it works.
//
// Three things make this section different from the switches above it:
//
//   - the password is never part of the settings object. It travels as a
//     `credential` operation on its own patch and comes back only as
//     `passwordConfigured: true`, so the field shows a placeholder rather than
//     a value and an empty field means "leave it alone", not "clear it".
//   - a saved password has to be on disk before a test can use it, so the test
//     button commits the pending secret first and only then asks the Host.
//   - the field values are optimistic (`useSettingsDraft`): a proxy host typed
//     into a text box must not snap back while the write is in flight, and a
//     write that fails must restore what is stored rather than what was typed.
//
// Validation is the Host's. The renderer normalizes the bypass list and trims
// the host, and everything else comes back as a `SettingsTestResult` code.

import { useState } from 'react';
import type { ProxyProtocol, RuntimeHostNetworkProxySettings } from '@maka/core/settings';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from './settings-row.js';
import { testNetworkProxy } from '../../bridge/settings.js';
import { useSettingsDraft } from '../../hooks/use-settings-draft.js';
import { useHostSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { settingsStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { getSettingsPreferencesCopy } from '../../locales/settings-preferences-copy.js';
import { settingsTestResultMessage } from '../../locales/settings-test-result-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

const PROTOCOLS: readonly ProxyProtocol[] = ['http', 'https', 'socks5'];
const PROTOCOL_LABELS: Record<ProxyProtocol, string> = {
  http: 'HTTP/HTTPS',
  https: 'HTTPS',
  socks5: 'SOCKS5',
};

const EMPTY_PROXY: RuntimeHostNetworkProxySettings = {
  enabled: false,
  protocol: 'http',
  host: '',
  port: 0,
  authEnabled: false,
  username: '',
  bypassList: [],
  autoBypassDomains: [],
  passwordConfigured: false,
};

export function NetworkProxySection(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const preferences = getSettingsPreferencesCopy(locale);
  const copy = preferences.general;
  const sections = preferences.sections;
  const password = preferences.password;
  const report = useSettingsErrorReporter();
  const host = props.host;
  const settings = useHostSettings().data;
  const persisted = settings?.network.proxy ?? EMPTY_PROXY;
  const [secret, setSecret] = useState('');
  const [testing, setTesting] = useState(false);

  const proxy = useSettingsDraft<RuntimeHostNetworkProxySettings>(
    persisted,
    async (patch) => {
      if (!host) throw new Error('No Runtime Host is selected');
      // `passwordConfigured` is a read projection, never something to write.
      const { passwordConfigured: _readOnly, ...writable } = patch;
      const result = await settingsStore.updateHost({ network: { proxy: writable } }, host);
      return result.settings.network.proxy;
    },
    (error) => report(copy.saveNetworkFailed, error),
  );

  if (!settings) {
    return (
      <SettingsSection title={sections.network} description={sections.networkHelp}>
        <SettingsRow
          title={sections.network}
          control={<Skeleton className="h-8 w-14 rounded-lg" />}
        />
      </SettingsSection>
    );
  }

  const value = proxy.draft;
  const savePassword = async () => {
    if (!host || secret.length === 0) return;
    await settingsStore.updateHost(
      { network: { proxy: { credential: { kind: 'replace', secret } } } },
      host,
    );
    setSecret('');
  };

  return (
    <SettingsSection title={sections.network} description={sections.networkHelp}>
      <SettingsRow
        title={copy.proxy}
        description={copy.proxyHelp}
        control={
          <Switch
            aria-label={copy.enableProxy}
            checked={value.enabled}
            onCheckedChange={(enabled) => void proxy.update({ enabled })}
          />
        }
      />
      {value.enabled && (
        <SettingsRow
          title={copy.proxyProtocol}
          control={
            <Select
              value={value.protocol}
              onValueChange={(next) => void proxy.update({ protocol: next as ProxyProtocol })}
            >
              <SelectTrigger aria-label={copy.proxyProtocol} className={settingsFieldWidthClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOLS.map((protocol) => (
                  <SelectItem key={protocol} value={protocol}>
                    {PROTOCOL_LABELS[protocol]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      )}
      {value.enabled && (
        <SettingsRow
          title={copy.serverAddress}
          control={
            <Input
              aria-label={copy.serverAddress}
              className={settingsFieldWidthClass}
              placeholder="127.0.0.1"
              value={value.host}
              onChange={(event) => proxy.edit({ host: event.target.value })}
              onBlur={() => void proxy.update({ host: value.host.trim() })}
            />
          }
        />
      )}
      {value.enabled && (
        <SettingsRow
          title={copy.port}
          control={
            <Input
              type="number"
              inputMode="numeric"
              aria-label={copy.port}
              className="w-32"
              placeholder="7890"
              value={value.port === 0 ? '' : String(value.port)}
              onChange={(event) =>
                proxy.edit({ port: Number.parseInt(event.target.value, 10) || 0 })
              }
              onBlur={() => void proxy.update({ port: value.port })}
            />
          }
        />
      )}
      {value.enabled && (
        <SettingsRow
          title={copy.proxyAuth}
          description={copy.proxyAuthHelp}
          control={
            <Switch
              aria-label={copy.enableProxyAuth}
              checked={value.authEnabled}
              onCheckedChange={(authEnabled) => {
                setSecret('');
                void proxy.update({ authEnabled });
              }}
            />
          }
        />
      )}
      {value.enabled && value.authEnabled && (
        <SettingsRow
          title={copy.username}
          control={
            <Input
              aria-label={copy.username}
              className={settingsFieldWidthClass}
              value={value.username}
              onChange={(event) => proxy.edit({ username: event.target.value })}
              onBlur={() => void proxy.update({ username: value.username.trim() })}
            />
          }
        />
      )}
      {value.enabled && value.authEnabled && (
        <SettingsRow
          title={copy.password}
          control={
            <Input
              type="password"
              aria-label={password.value}
              className={settingsFieldWidthClass}
              placeholder={value.passwordConfigured ? copy.passwordSavedPlaceholder : undefined}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              onBlur={() => {
                void savePassword().catch((error: unknown) =>
                  report(copy.saveNetworkFailed, error),
                );
              }}
            />
          }
        />
      )}
      {value.enabled && (
        <SettingsRow
          title={copy.bypassList}
          description={`${copy.bypassHelp} ${copy.autoBypass(value.autoBypassDomains.length)}`}
          control={
            <Input
              aria-label={copy.bypassList}
              className={settingsFieldWidthClass}
              placeholder="metaso.cn, baidu.com"
              value={value.bypassList.join(', ')}
              onChange={(event) => proxy.edit({ bypassList: csvList(event.target.value) })}
              onBlur={() => void proxy.update({ bypassList: value.bypassList })}
            />
          }
        />
      )}
      <SettingsRow
        title={copy.testCurrent}
        control={
          <Button
            variant="secondary"
            size="sm"
            disabled={testing || !host}
            onClick={() => {
              setTesting(true);
              // Flush the pending secret first: a test that runs before the
              // credential is on disk reports "credential missing" for a
              // password the user has already typed.
              void savePassword()
                .then(() =>
                  testNetworkProxy(
                    {
                      proxy: {
                        enabled: value.enabled,
                        type: value.protocol,
                        host: value.host.trim(),
                        port: value.port,
                        authEnabled: value.authEnabled,
                        ...(value.authEnabled && value.username.trim()
                          ? { username: value.username.trim() }
                          : {}),
                        bypassList: value.bypassList,
                      },
                    },
                    host,
                  ),
                )
                .then((result) => {
                  const message = settingsTestResultMessage(result, locale);
                  const latency = result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : '';
                  toast({
                    title: result.ok ? copy.proxyReachable : copy.proxyTestFailed,
                    description: `${message}${latency}`,
                    variant: result.ok ? 'success' : 'destructive',
                  });
                })
                .catch((error: unknown) => report(copy.proxyTestError, error))
                .finally(() => setTesting(false));
            }}
          >
            {testing ? copy.testing : copy.testCurrent}
          </Button>
        }
      />
    </SettingsSection>
  );
}

/** `a, b , ,c` → `['a','b','c']`. */
function csvList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
