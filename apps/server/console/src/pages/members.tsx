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

// Members: everyone who has signed in, as a table the row of which opens the
// person. A search narrows it on the server, by name or email.

import { useState } from 'react';
import type { ConsoleUser } from '../../../src/admin-console/types.js';
import { SettingsSection } from '@desktop/components/settings/settings-row.js';
import {
  SettingsEmpty,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { Input } from '@desktop/components/ui/input.js';
import { api } from '../api.js';
import { useConsole } from '../context.js';
import { formatDate } from '../format.js';
import { navigate } from '../router.js';
import { Avatar, Chip, LoadFailed, LoadingRows } from '../ui.js';
import { useResource } from '../use-resource.js';

export function MembersPage() {
  const { copy, locale } = useConsole();
  const [query, setQuery] = useState('');
  const needle = query.trim();
  const users = useResource(
    () => api.get<ConsoleUser[]>(`/users${needle ? `?query=${encodeURIComponent(needle)}` : ''}`),
    needle,
  );
  const text = copy.members;

  return (
    <SettingsSection
      title={text.title}
      description={text.help}
      action={
        <Input
          type="search"
          aria-label={text.search}
          placeholder={text.search}
          className="w-56"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      }
    >
      {users.error && !users.data ? (
        <LoadFailed error={users.error} onRetry={users.reload} />
      ) : !users.data ? (
        <LoadingRows />
      ) : users.data.length === 0 ? (
        needle ? (
          <SettingsEmpty title={text.noMatch} />
        ) : (
          <SettingsEmpty title={text.empty} body={text.emptyHelp} />
        )
      ) : (
        <SettingsTable
          label={text.title}
          head={
            <>
              <SettingsTableHeadCell className="w-[46%]">
                {text.columns.person}
              </SettingsTableHeadCell>
              <SettingsTableHeadCell>{text.columns.role}</SettingsTableHeadCell>
              <SettingsTableHeadCell>{text.columns.lastLogin}</SettingsTableHeadCell>
              <SettingsTableHeadCell>{text.columns.devices}</SettingsTableHeadCell>
            </>
          }
        >
          {users.data.map((user) => (
            <SettingsTableRow
              key={user.id}
              onOpen={() => navigate({ page: 'member', id: user.id })}
              openLabel={text.open(user.name)}
            >
              <SettingsTableCell>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={user.name} url={user.avatarUrl} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{user.name}</span>
                      {user.status === 'deactivated' && (
                        <Chip tone="neutral">{text.deactivated}</Chip>
                      )}
                    </span>
                    <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                      {user.email}
                    </span>
                  </span>
                </span>
              </SettingsTableCell>
              <SettingsTableCell className="text-text-secondary">
                {user.orgRole === 'org_admin' ? (
                  <Chip tone="active">{text.admin}</Chip>
                ) : (
                  text.member
                )}
              </SettingsTableCell>
              <SettingsTableCell className="text-text-secondary">
                {user.lastLoginAt === null
                  ? copy.common.never
                  : formatDate(locale, user.lastLoginAt)}
              </SettingsTableCell>
              <SettingsTableCell className="text-text-secondary">
                {text.devicesOnline(user.activeDevices)}
              </SettingsTableCell>
            </SettingsTableRow>
          ))}
        </SettingsTable>
      )}
    </SettingsSection>
  );
}
