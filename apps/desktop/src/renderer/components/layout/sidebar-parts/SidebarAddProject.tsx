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

import { useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { prepareProjectDirectory, createPreparedProject } from '../../../bridge/projects.js';
import { newTaskStore, uiStore } from '../../../store/index.js';
import { errorMessage } from '../../../store/resource-store.js';
import { getCreateProjectCopy } from '../../../locales/create-project-copy.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '../../ui/dialog.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { SidebarTooltip } from '../../ui/sidebar-tooltip.js';
import { labelActionButtonClass } from './SidebarGroup.js';
import { cn } from '../../../lib/cn.js';

export function SidebarAddProject() {
  const copy = getCreateProjectCopy(useUiLocale());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <SidebarTooltip content={copy.title} alwaysShow side="top">
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={copy.title}
            className={cn(labelActionButtonClass, 'cursor-pointer')}
          >
            <Anthropicon name="add" size={16} />
          </button>
        </DialogTrigger>
      </SidebarTooltip>
      {open && (
        <DialogContent data-maka-contract="create-project-dialog">
          <CreateProjectForm busy={busy} onBusy={setBusy} onClose={() => setOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function CreateProjectForm({
  busy,
  onBusy,
  onClose,
}: {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const copy = getCreateProjectCopy(useUiLocale());
  const catalog = useStore(newTaskStore, (state) => state.catalog);
  const hosts = (catalog?.hosts ?? []).filter(
    (host) =>
      host.readiness === 'ready' &&
      host.state === 'available' &&
      host.capabilities.chooseClientDirectory,
  );
  const [profileId, setProfileId] = useState(catalog?.defaultProfileId);
  const host = hosts.find((entry) => entry.profile.id === profileId) ?? hosts[0];
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState<{
    selectionId: string;
    path: string;
    profileId: string;
    hostId: string;
  }>();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const valid =
    host?.readiness === 'ready' &&
    host.state === 'available' &&
    directory?.profileId === host.profile.id &&
    directory.hostId === host.hostId;
  async function choose() {
    if (busy || host?.readiness !== 'ready' || host.state !== 'available') return;
    onBusy(true);
    setError('');
    try {
      const target = { profileId: host.profile.id, hostId: host.hostId };
      const result = await prepareProjectDirectory(target);
      if (result.ok) {
        setDirectory({ ...result, ...target });
        if (!name.trim()) setName(result.path.split(/[/\\]/).filter(Boolean).at(-1) ?? '');
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      onBusy(false);
    }
  }
  async function create() {
    if (busy || !valid || !directory || !name.trim()) return;
    onBusy(true);
    setCreating(true);
    setError('');
    try {
      const project = await createPreparedProject(directory.selectionId, name, {
        profileId: directory.profileId,
        hostId: directory.hostId,
      });
      await newTaskStore.refresh();
      uiStore.setSidebarExpanded('section:projects', true);
      uiStore.setSidebarExpanded(`project:${project.id}`, true);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      onBusy(false);
      setCreating(false);
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription className="sr-only">{copy.choose}</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        {hosts.length > 0 && (catalog?.hosts.length ?? 0) > 1 && (
          <label className="flex flex-col gap-2 text-sm text-text-secondary">
            {copy.host}
            <select
              aria-label={copy.host}
              disabled={busy}
              value={host?.profile.id}
              onChange={(event) => {
                setProfileId(event.target.value);
                setDirectory(undefined);
              }}
              className="h-9 rounded-lg border border-alpha-2 bg-transparent px-3 text-sm text-text-primary md:h-8"
            >
              {hosts.map((entry) => (
                <option key={entry.profile.id} value={entry.profile.id}>
                  {entry.profile.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="relative">
          <Anthropicon
            name="folder"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <Input
            aria-label={copy.name}
            placeholder={copy.name}
            autoFocus
            value={name}
            disabled={busy || hosts.length === 0}
            onChange={(event) => setName(event.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text-primary">{copy.folder}</span>
          {hosts.length ? (
            <button
              type="button"
              onClick={() => void choose()}
              disabled={busy}
              aria-label={directory ? copy.change : copy.choose}
              className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-alpha-2 p-4 text-sm text-text-secondary transition-colors hover:bg-alpha-1 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-default disabled:opacity-50"
            >
              <Anthropicon name={directory ? 'folder' : 'folderAdd'} size={20} />
              <span className="max-w-full break-all text-center">
                {directory?.path ?? copy.choose}
              </span>
            </button>
          ) : (
            <div className="rounded-xl border border-alpha-2 p-4 text-sm text-text-secondary">
              {copy.noHost}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onClose();
                  uiStore.openSettings('projects');
                }}
              >
                {copy.settings}
              </Button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {copy.failed}: {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" disabled={busy || !valid || !name.trim()}>
            {creating ? copy.busy : copy.create}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
