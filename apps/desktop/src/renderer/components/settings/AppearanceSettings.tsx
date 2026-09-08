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

// Theme, dock artwork, and how big the text is.
//
// Nothing here applies the change itself. `app.tsx` already watches the client
// settings and calls `applyTheme` / `applyUiFontSize` / `applyTerminalFontSize`
// — the same path the command palette's theme commands take — so this page
// only writes, and a write that fails leaves the UI showing what is actually
// stored instead of a preference that only exists on this screen.
//
// The app icon is the exception, and deliberately: `clientOwnedSettingsPatch`
// strips `appIcon` out of a generic settings patch so the main process's icon
// seam can serialize selection against import and removal. It gets its own
// call (`app.selectIcon`) and no optimistic state — the tile follows the
// settings snapshot main pushes back.
//
// The picker offers the current brand mark and imported artwork only.

import { useState } from 'react';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_UI_FONT_SIZE,
  DEFAULT_APP_ICON,
  isCustomAppIcon,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  type AppIconChoice,
  type ThemePreference,
} from '@maka/core/settings';
import { useUiLocale } from '@maka/ui';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import { Skeleton } from '../ui/skeleton.js';
import { cn } from '../../lib/cn.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { importAppIcon, listIconPreviews, removeAppIcon, selectAppIcon } from '../../bridge/app.js';
import { useAsync } from '../../hooks/use-async.js';
import { useClientSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { settingsStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { getSettingsPreferencesCopy } from '../../locales/settings-preferences-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';

const THEME_ICONS: Record<ThemePreference, AnthropiconName> = {
  light: 'sun',
  dark: 'moon',
  auto: 'computer',
};

export function AppearanceSettings() {
  const locale = useUiLocale();
  const preferences = getSettingsPreferencesCopy(locale);
  const copy = preferences.appearance;
  const sections = preferences.sections;
  const shared = getSettingsSharedCopy(locale);
  const report = useSettingsErrorReporter();
  const client = useClientSettings();
  const appearance = client.data?.appearance;
  const icons = useAsync(() => listIconPreviews(), []);
  const [iconBusy, setIconBusy] = useState(false);

  const write = (patch: Parameters<typeof settingsStore.updateClient>[0]) => {
    void settingsStore
      .updateClient(patch)
      .catch((error: unknown) => report(copy.saveFailed, error));
  };

  const chooseIcon = (icon: AppIconChoice) => {
    setIconBusy(true);
    void selectAppIcon(icon, 'both')
      .then((result) => {
        if (!result.ok) toast({ title: copy.appIconSelectFailed, variant: 'destructive' });
      })
      .catch((error: unknown) => report(copy.appIconSelectFailed, error))
      .finally(() => setIconBusy(false));
  };

  return (
    <>
      <SettingsSection title={sections.theme} description={sections.themeHelp}>
        <SettingsRow
          title={copy.theme}
          description={appearance ? copy.themeOptions[appearance.theme].help : shared.loading}
          control={
            appearance ? (
              <SegmentedControl
                ariaLabel={copy.theme}
                value={appearance.theme}
                onChange={(theme: ThemePreference) => write({ appearance: { theme } })}
                options={(['light', 'dark', 'auto'] as const).map((value) => ({
                  value,
                  label: copy.themeOptions[value].label,
                  icon: THEME_ICONS[value],
                  showLabel: true,
                }))}
              />
            ) : (
              <Skeleton className="h-8 w-56 rounded-lg" />
            )
          }
        />
      </SettingsSection>

      <SettingsSection title={sections.appIcon} description={sections.appIconHelp}>
        {icons.error !== undefined ? (
          <SettingsRow title={copy.appIconUnavailable} control={null} />
        ) : (
          <SettingsRow layout="stacked" title={sections.appIcon}>
            <div role="radiogroup" aria-label={sections.appIcon} className="flex flex-wrap gap-2">
              {(icons.data ?? [])
                .filter((preview) => preview.id === DEFAULT_APP_ICON || isCustomAppIcon(preview.id))
                .map((preview) => {
                  const selected = (appearance?.appIcon ?? DEFAULT_APP_ICON) === preview.id;
                  const label =
                    preview.id === DEFAULT_APP_ICON ? copy.appIconDefault : copy.appIconCustom;
                  return (
                    <div key={preview.id} className="group/icon relative">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={label}
                        title={label}
                        disabled={iconBusy}
                        onClick={() => chooseIcon(preview.id)}
                        className={cn(
                          'flex size-14 cursor-pointer items-center justify-center rounded-xl p-1 outline-none transition-shadow',
                          'shadow-[inset_0_0_0_1px_var(--hairline)] hover:shadow-[inset_0_0_0_1px_var(--border-strong)]',
                          'focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-not-allowed disabled:opacity-50',
                          selected && 'shadow-[inset_0_0_0_2px_var(--fill-accent)]',
                        )}
                      >
                        <img src={preview.dataUrl} alt="" className="size-full rounded-lg" />
                      </button>
                      {preview.removable === true && (
                        <button
                          type="button"
                          aria-label={`${copy.appIconRemove} ${label}`}
                          disabled={iconBusy}
                          onClick={(event) => {
                            event.stopPropagation();
                            setIconBusy(true);
                            void removeAppIcon(preview.id)
                              .then((result) => {
                                if (!result.ok)
                                  toast({
                                    title: copy.appIconRemoveFailed,
                                    variant: 'destructive',
                                  });
                                icons.reload();
                              })
                              .catch((error: unknown) => report(copy.appIconRemoveFailed, error))
                              .finally(() => setIconBusy(false));
                          }}
                          className="absolute -right-1.5 -top-1.5 flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-surface-3 opacity-0 shadow-[0_0_0_1px_var(--alpha-2)] transition-opacity group-hover/icon:opacity-100 focus-visible:opacity-100 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                        >
                          <Anthropicon name="x" size={12} className="text-text-secondary" />
                        </button>
                      )}
                    </div>
                  );
                })}
              {icons.loading &&
                [0].map((index) => <Skeleton key={index} className="size-14 rounded-xl" />)}
            </div>
          </SettingsRow>
        )}
        <SettingsRow
          title={copy.appIconImport}
          description={copy.appIconImportHelp}
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={iconBusy}
              onClick={() => {
                setIconBusy(true);
                void importAppIcon()
                  .then((result) => {
                    if (result.ok) {
                      icons.reload();
                      return selectAppIcon(result.icon, 'both').then((selection) => {
                        if (!selection.ok)
                          toast({ title: copy.appIconSelectFailed, variant: 'destructive' });
                      });
                    }
                    // The user closing the picker is not a failure.
                    if (result.reason !== 'cancelled')
                      toast({
                        title: copy.appIconImportError,
                        description: copy.appIconImportFailed[result.reason],
                        variant: 'destructive',
                      });
                    return undefined;
                  })
                  .catch((error: unknown) => report(copy.appIconImportError, error))
                  .finally(() => setIconBusy(false));
              }}
            >
              {iconBusy ? copy.appIconImporting : copy.appIconImport}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title={sections.fontSize} description={sections.fontSizeHelp}>
        <SettingsRow
          title={copy.fontSize.uiLabel}
          description={copy.fontSize.uiHelp}
          control={
            <FontSizeInput
              label={copy.fontSize.uiLabel}
              value={appearance?.uiFontSize ?? DEFAULT_UI_FONT_SIZE}
              min={UI_FONT_SIZE_MIN}
              max={UI_FONT_SIZE_MAX}
              onChange={(uiFontSize) => write({ appearance: { uiFontSize } })}
            />
          }
        />
        <SettingsRow
          title={copy.fontSize.terminalLabel}
          description={copy.fontSize.terminalHelp}
          control={
            <FontSizeInput
              label={copy.fontSize.terminalLabel}
              value={appearance?.terminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE}
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              onChange={(terminalFontSize) => write({ appearance: { terminalFontSize } })}
            />
          }
        />
      </SettingsSection>
    </>
  );
}

/**
 * A bounded numeric stepper. The bounds are the settings module's, so a value
 * typed by hand cannot leave the UI at a size nothing can be read at.
 */
function FontSizeInput(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        aria-label={props.label}
        className="w-24"
        value={props.value}
        min={props.min}
        max={props.max}
        step={1}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (!Number.isFinite(next)) return;
          props.onChange(Math.min(props.max, Math.max(props.min, next)));
        }}
      />
      <span className="text-[13px] leading-[18px] text-text-muted">px</span>
    </span>
  );
}
