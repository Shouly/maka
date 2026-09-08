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

// What the OS has granted, and what the agent can therefore do.
//
// Two reads side by side because they answer one question in two halves: the
// permission snapshot says what the system allows, the capability snapshot
// says what each feature makes of it. A capability can be `denied` with every
// permission granted (its own switch is off), and granted permissions can
// leave a capability `not_configured` — neither half explains the other.
//
// Whether a row can open System Settings, ask for consent, or offer the
// drag-to-grant gesture is main's answer, not a platform check here:
// `canOpenSettings` / `canRequest` are only true where the flow exists, so a
// non-macOS build shows the rows and none of the buttons.

import { useEffect, useState } from 'react';
import {
  isDragGrantPermissionId,
  OS_PERMISSION_IDS,
  type CapabilitySnapshot,
  type OsPermissionId,
} from '@maka/core/capabilities';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { cn } from '../../lib/cn.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import {
  getCapabilitySnapshot,
  getPermissionSnapshot,
  openPermissionSystemSettings,
  requestPermissionAccess,
  startPermissionDragOnboarding,
} from '../../bridge/permissions.js';
import { useAsync } from '../../hooks/use-async.js';
import { toast } from '../../store/toast-store.js';
import { getPermissionCenterCopy } from '../../locales/permission-center-copy.js';
import type { PermissionCenterCopy } from '../../locales/permission-center-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

type PermissionActionKind = 'open' | 'request' | 'drag';

export function PermissionsSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getPermissionCenterCopy(locale);
  const host = props.host;
  const [pending, setPending] = useState<string | null>(null);
  const permissions = useAsync(() => getPermissionSnapshot(host), [host?.profileId, host?.hostId]);
  const capabilities = useAsync(() => getCapabilitySnapshot(host), [host?.profileId, host?.hostId]);

  // A grant made in System Settings never notifies anyone; coming back to the
  // window is the only signal that it may have changed.
  const reloadPermissions = permissions.reload;
  useEffect(() => {
    const onFocus = () => reloadPermissions();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadPermissions();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reloadPermissions]);

  const run = (id: OsPermissionId, kind: PermissionActionKind) => {
    const key = `${id}:${kind}`;
    if (pending) return;
    setPending(key);
    const call =
      kind === 'open'
        ? openPermissionSystemSettings(id, host)
        : kind === 'request'
          ? requestPermissionAccess(id, host)
          : startPermissionDragOnboarding(id, host);
    void call
      .then((result) => {
        if (!result.ok)
          toast({
            title: copy.actionFailed,
            description: copy.actionFailures[result.reason] ?? result.message,
            variant: 'destructive',
          });
        // Consent dialogs settle before they resolve; opening System Settings
        // and the drag overlay do not, and the focus listener covers those.
        else if (kind === 'request') reloadPermissions();
      })
      .catch((error: unknown) => {
        toast({
          title: copy.actionFailed,
          description: error instanceof Error ? error.message : copy.actionFailures.failed,
          variant: 'destructive',
        });
      })
      .finally(() => setPending(null));
  };

  const permissionData = permissions.data;
  return (
    <>
      <SettingsSection
        title={copy.osSection}
        description={copy.osSectionHelp}
        action={
          <Button variant="secondary" size="sm" onClick={reloadPermissions}>
            {copy.detectAgain}
          </Button>
        }
      >
        {permissions.loading && !permissions.data ? (
          <SettingsSkeletonRows label={copy.loading} />
        ) : !permissionData ? (
          <SettingsRow
            title={copy.readFailed}
            control={
              <Button variant="secondary" size="sm" onClick={reloadPermissions}>
                {copy.readAgain}
              </Button>
            }
          />
        ) : (
          OS_PERMISSION_IDS.map((id) => {
            const snapshot = permissionData.permissions[id];
            if (!snapshot) return null;
            const granted = snapshot.status === 'granted';
            const showRequest = snapshot.canRequest && !granted;
            const showOpen = snapshot.canOpenSettings && !granted;
            const showDrag = isDragGrantPermissionId(id) && snapshot.canOpenSettings && !granted;
            return (
              <SettingsRow
                key={id}
                title={copy.osPermissions[id].label}
                description={
                  <span className="flex flex-col gap-0.5">
                    <span>{copy.osPermissions[id].purpose}</span>
                    <span className="text-text-muted">
                      {`${copy.impact} ${copy.osPermissions[id].impact}`}
                    </span>
                    {snapshot.reason && <span className="text-text-muted">{snapshot.reason}</span>}
                  </span>
                }
                control={
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        statusChipClass,
                        statusChipToneClass(copy.osStates[snapshot.status].tone),
                      )}
                    >
                      {copy.osStates[snapshot.status].label}
                    </span>
                    {showDrag && (
                      <Button size="sm" disabled={pending !== null} onClick={() => run(id, 'drag')}>
                        {pending === `${id}:drag` ? copy.dragGranting : copy.dragGrant}
                      </Button>
                    )}
                    {showOpen && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => run(id, 'open')}
                      >
                        {pending === `${id}:open` ? copy.opening : copy.openSettings}
                      </Button>
                    )}
                    {showRequest && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => run(id, 'request')}
                      >
                        {pending === `${id}:request` ? copy.requesting : copy.request}
                      </Button>
                    )}
                  </span>
                }
              />
            );
          })
        )}
      </SettingsSection>

      <SettingsSection
        title={copy.capabilitiesSection}
        description={copy.capabilitiesHelp}
        action={
          <Button variant="secondary" size="sm" onClick={capabilities.reload}>
            {copy.readAgain}
          </Button>
        }
      >
        {capabilities.loading && !capabilities.data ? (
          <SettingsSkeletonRows label={copy.loading} />
        ) : !capabilities.data ? (
          <SettingsRow title={copy.readFailed} control={null} />
        ) : capabilities.data.capabilities.length === 0 ? (
          <SettingsRow title={copy.noData} control={null} />
        ) : (
          capabilities.data.capabilities.map((capability) => (
            <CapabilityRow key={capability.id} capability={capability} copy={copy} />
          ))
        )}
      </SettingsSection>
      <p className="text-[13px] leading-[18px] text-text-muted">{copy.footnote}</p>
    </>
  );
}

function CapabilityRow(props: { capability: CapabilitySnapshot; copy: PermissionCenterCopy }) {
  const { capability, copy } = props;
  const readiness = copy.readiness[capability.readiness];
  const layers: readonly [string, string][] = [
    [copy.layers.feature, copy.layers.featureStates[capability.feature.state]],
    [copy.layers.configuration, copy.layers.configurationStates[capability.configuration.state]],
    [copy.layers.approval, copy.layers.approvalStates[capability.actionApproval.state]],
    [copy.layers.memory, copy.layers.memoryStates[capability.memoryAcceptance.state]],
    [copy.layers.runtime, copy.layers.runtimeStates[capability.runtimeProbe.state]],
  ];
  return (
    <SettingsRow
      layout="stacked"
      title={
        <span className="flex items-center gap-2">
          <span>{capability.label}</span>
          <span className={cn(statusChipClass, statusChipToneClass(readiness.tone))}>
            {readiness.label}
          </span>
        </span>
      }
      description={readiness.detail}
    >
      <dl
        className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-[13px] leading-[18px]"
        aria-label={copy.layers.aria(capability.label)}
      >
        {layers.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-text-secondary">{value}</dd>
          </div>
        ))}
      </dl>
      {capability.osPermissions.length > 0 && (
        <p className="text-[13px] leading-[18px] text-text-muted">
          {`${copy.requiredPermissions} ${capability.osPermissions
            .map(
              (permission) =>
                `${copy.osPermissions[permission.id].label} · ${copy.osStates[permission.status].label}`,
            )
            .join(' · ')}`}
        </p>
      )}
      {capability.guidance.length > 0 && (
        <ul
          className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-[18px] text-text-secondary"
          aria-label={copy.guidance}
        >
          {capability.guidance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </SettingsRow>
  );
}

function SettingsSkeletonRows(props: { label: string }) {
  return (
    <div className="flex flex-col gap-2 py-3" role="status" aria-label={props.label}>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}
