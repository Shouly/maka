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

// Where the session stands, then what happened.
//
// Two zoom levels of one question, read top to bottom rather than through a
// switcher: the overview answers how full the context is, what the tokens and
// the clock did and what it cost; the timeline under it answers turn by turn.
// A session with no metered overview simply starts at the timeline.
//
// Every judgement lives in the two ported pure models
// (`session-inspector-overview-model.ts`, `session-inspector-panel-model.ts`);
// this file lays their answers out. That is why nothing here decides what a
// number means — including the two rules those models exist to enforce: an
// unpriced call is not a free one (cost renders as words, never `$0.00`), and
// a byte-based estimate is never presented as a decomposition of a
// provider-reported token count (every one carries `≈`).
//
// The pre-rewrite panel drew the two session-wide ledgers as donuts. They are
// horizontal bands here, the same shape as the context bar directly under
// them: the pane's floor is 340px, and three different chart idioms stacked in
// that column read as three unrelated widgets rather than one panel.

import { useMemo, type ReactNode } from 'react';
import { uiLocaleToIntlLocale, type UiLocale } from '@maka/core/ui-locale';
import { traceTurnIdentityKey } from '@maka/core/session-trace';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { PreviewNotice } from './PreviewNotice.js';
import { cn } from '../../lib/cn.js';
import { toast } from '../../store/toast-store.js';
import { useSessionTrace } from '../../hooks/use-session-trace.js';
import {
  deriveInspectorOverviewModel,
  estimatedSessionCost,
  hasUnavailableSessionUsage,
  type InspectorDurationUsageKind,
  type InspectorOverviewModel,
  type InspectorTokenUsageKind,
} from '../../lib/ported/session-inspector-overview-model.js';
import {
  deriveInspectorPanelModel,
  type InspectorStepRow,
  type InspectorTurnRow,
} from '../../lib/ported/session-inspector-panel-model.js';
import {
  getDesktopConversationCopy,
  inspectorStepKindLabel,
  type InspectorCopy,
} from '../../locales/conversation-copy.js';

/** Band colours, by what the band means. Semantic classes only. */
const TOKEN_BAND: Record<InspectorTokenUsageKind, string> = {
  cacheRead: 'bg-accent-fill',
  cacheMiss: 'bg-warning-fill',
  output: 'bg-success-fill',
};
const DURATION_BAND: Record<InspectorDurationUsageKind, string> = {
  model: 'bg-accent-fill',
  tool: 'bg-warning-fill',
};
const CONTEXT_BAND: Record<'cacheRead' | 'fresh' | 'used' | 'free', string> = {
  cacheRead: 'bg-accent-fill',
  fresh: 'bg-accent-line',
  used: 'bg-accent-fill',
  free: 'bg-alpha-2',
};
const COMPOSITION_BAND: Record<string, string> = {
  system_instructions: 'bg-accent-fill',
  tool_definitions: 'bg-warning-fill',
  messages: 'bg-success-fill',
  other: 'bg-alpha-4',
};

export function InspectorTab(props: { sessionId: string; active: boolean }) {
  const locale = useUiLocale();
  const copy = getDesktopConversationCopy(locale).inspector;
  const snapshot = useSessionTrace(props.sessionId, props.active, {
    loadFailed: copy.loadFailed,
    locale,
  });
  const model = useMemo(() => deriveInspectorPanelModel(snapshot.trace), [snapshot.trace]);
  const overview = useMemo(
    () => deriveInspectorOverviewModel(snapshot.context, snapshot.summary),
    [snapshot.context, snapshot.summary],
  );

  const copyPricingKey = (key: string) => {
    void navigator.clipboard
      .writeText(key)
      .then(() => toast({ title: copy.pricingKeyCopied, description: key, variant: 'success' }))
      .catch(() =>
        toast({
          title: copy.copyFailed,
          description: copy.copyFailedDetail,
          variant: 'destructive',
        }),
      );
  };

  const nothingYet = model.empty && !snapshot.nextCursor && !snapshot.loading && !snapshot.error;
  const showTotals = Boolean(snapshot.summary && snapshot.summary.totalRequests > 0);
  const showOverview = Boolean(
    overview.tokenUsage ||
      overview.durationUsage ||
      overview.context ||
      overview.composition ||
      showTotals,
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-maka-contract="session-inspector"
      role="region"
      aria-label={copy.ariaLabel}
      aria-busy={snapshot.loading || snapshot.summaryLoading || undefined}
    >
      <div className="flex flex-col gap-6 px-3 py-3">
        {snapshot.error && (
          <div className="rounded-lg bg-danger-subtle px-3 py-2">
            <p className="text-xs leading-5 text-danger">{snapshot.error}</p>
            <Button variant="ghost" size="sm" onClick={snapshot.retry}>
              {copy.retry}
            </Button>
          </div>
        )}

        {nothingYet && !showOverview && (
          <PreviewNotice icon="chartLine" title={copy.empty} detail={copy.emptyHelp} />
        )}

        {snapshot.loading && !snapshot.trace && (
          <p className="text-xs leading-5 text-text-muted">{copy.loadingTrace}</p>
        )}
        {snapshot.summaryLoading && !snapshot.summary && (
          <p className="text-xs leading-5 text-text-muted">{copy.loadingSummary}</p>
        )}
        {((snapshot.summaryError && !snapshot.summary) ||
          (snapshot.summary && hasUnavailableSessionUsage(snapshot.summary))) && (
          <p className="text-xs leading-5 text-text-muted">{copy.summaryUnavailable}</p>
        )}

        {/* Gated on what the OVERVIEW can actually draw, not on the summary
            arriving: a session whose backend metered nothing has a summary
            object full of zeros, and rendering the block for it would leave an
            empty container above the timeline. */}
        {showOverview && (
          <Overview
            copy={copy}
            locale={locale}
            overview={overview}
            cost={estimatedSessionCost(snapshot.summary)}
            showTotals={showTotals}
          />
        )}

        {(!model.empty || snapshot.nextCursor) && (
          <section
            className="flex flex-col gap-2"
            data-maka-contract="session-inspector-trace"
            aria-label={copy.overview.timelineTab}
          >
            <SectionHead title={copy.overview.timelineTab} />
            {model.coverage && (
              <p
                className="flex items-start gap-1.5 text-xs leading-5 text-warning"
                data-maka-contract="session-inspector-coverage"
              >
                <Anthropicon name="warning" size={16} />
                <span>
                  {(model.coverage.kind === 'absent' ? copy.coverageAbsent : copy.coveragePartial)(
                    [
                      model.coverage.turnsMissing > 0 &&
                        copy.turnsMissing(model.coverage.turnsMissing),
                      model.coverage.turnsShort > 0 && copy.turnsShort(model.coverage.turnsShort),
                      model.coverage.unreadableRecords > 0 &&
                        copy.unreadable(model.coverage.unreadableRecords),
                      model.coverage.oversizedRuns > 0 &&
                        copy.oversizedRuns(model.coverage.oversizedRuns),
                    ].filter((part): part is string => typeof part === 'string'),
                  )}
                </span>
              </p>
            )}
            <ol className="flex flex-col gap-3">
              {model.turns.map((turn) => (
                <TurnRow
                  key={traceTurnIdentityKey(turn)}
                  turn={turn}
                  copy={copy}
                  locale={locale}
                  onCopyPricingKey={copyPricingKey}
                />
              ))}
            </ol>
            {(snapshot.nextCursor || snapshot.canHideEarlier) && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={snapshot.loading || snapshot.loadingEarlier}
                onClick={snapshot.canHideEarlier ? snapshot.hideEarlier : snapshot.loadEarlier}
              >
                {snapshot.canHideEarlier
                  ? copy.hideEarlier
                  : snapshot.loadingEarlier
                    ? copy.loadingEarlier
                    : copy.loadEarlier}
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Overview(props: {
  copy: InspectorCopy;
  locale: UiLocale;
  overview: InspectorOverviewModel;
  cost: number | undefined;
  showTotals: boolean;
}) {
  const { copy, overview } = props;
  const number = numberFormatter(props.locale);
  const compact = compactNumberFormatter();
  const tokens = overview.tokenUsage;
  const duration = overview.durationUsage;
  const context = overview.context;
  const level = context
    ? context.ratio >= 0.9
      ? 'error'
      : context.ratio >= 0.7
        ? 'warning'
        : undefined
    : undefined;

  return (
    <div className="flex flex-col gap-6" data-maka-contract="session-inspector-usage">
      {tokens && (
        <section className="flex flex-col gap-2">
          <SectionHead title={copy.tokenUsage.title} readout={compact(tokens.total)} />
          <BandTrack
            bands={tokens.segments.map((segment) => ({
              key: segment.kind,
              weight: segment.tokens,
              className: TOKEN_BAND[segment.kind],
            }))}
          />
          <FactList
            rows={tokens.segments.map((segment) => ({
              key: segment.kind,
              swatch: TOKEN_BAND[segment.kind],
              label: copy.tokenUsage.segment[segment.kind],
              value: `${compact(segment.tokens)} · ${percent(segment.tokens / tokens.total)}`,
            }))}
          />
        </section>
      )}

      {duration && (
        <section className="flex flex-col gap-2">
          <SectionHead
            title={copy.durationUsage.title}
            readout={formatDuration(duration.totalDurationMs)}
          />
          <BandTrack
            bands={duration.segments.map((segment) => ({
              key: segment.kind,
              weight: segment.durationMs,
              className: DURATION_BAND[segment.kind],
            }))}
          />
          <FactList
            rows={duration.segments.map((segment) => ({
              key: segment.kind,
              swatch: DURATION_BAND[segment.kind],
              label: copy.durationUsage.segment[segment.kind](segment.count),
              value: `${formatDuration(segment.durationMs)} · ${percent(
                duration.totalDurationMs > 0 ? segment.durationMs / duration.totalDurationMs : 0,
              )}`,
            }))}
          />
        </section>
      )}

      {props.showTotals && (
        <section className="flex flex-col gap-2" data-maka-contract="session-inspector-stats">
          <SectionHead
            title={copy.totals.cost}
            readout={formatCost(props.cost, copy.costUnavailable)}
          />
          {overview.cacheHitRate !== undefined && (
            <SectionHead title={copy.overview.cacheHit} readout={percent(overview.cacheHitRate)} />
          )}
          <p className="text-xs leading-4 text-text-muted">{copy.costEstimateHelp}</p>
        </section>
      )}

      {context && (
        <section className="flex flex-col gap-2" data-maka-contract="session-inspector-context">
          <SectionHead
            title={copy.overview.context}
            readout={`${compact(context.usedTokens)} / ${compact(context.windowTokens)} · ${percent(
              context.ratio,
            )}`}
            level={level}
          />
          <BandTrack
            bands={context.segments.map((segment) => ({
              key: segment.kind,
              weight: segment.tokens,
              className:
                segment.kind === 'free'
                  ? CONTEXT_BAND.free
                  : level === 'error'
                    ? 'bg-danger-fill'
                    : level === 'warning'
                      ? 'bg-warning-fill'
                      : CONTEXT_BAND[segment.kind],
            }))}
          />
          <FactList
            rows={context.segments.map((segment) => ({
              key: segment.kind,
              swatch: CONTEXT_BAND[segment.kind],
              label: copy.overview.segment[segment.kind],
              value: number(segment.tokens),
            }))}
          />
        </section>
      )}

      {overview.composition && (
        <section className="flex flex-col gap-2" data-maka-contract="session-inspector-composition">
          <SectionHead title={copy.overview.composition.title} />
          <p className="text-xs leading-4 text-text-muted">{copy.overview.composition.basis}</p>
          {overview.composition.status === 'unrecorded' ? (
            <p className="text-xs leading-4 text-text-muted">
              {copy.overview.composition.unrecorded}
            </p>
          ) : (
            <>
              <BandTrack
                bands={overview.composition.composition.parts.map((part) => ({
                  key: part.kind,
                  weight: part.estimatedTokens,
                  className: COMPOSITION_BAND[part.kind] ?? 'bg-alpha-4',
                }))}
              />
              <FactList
                rows={overview.composition.composition.parts.map((part) => ({
                  key: part.kind,
                  swatch: COMPOSITION_BAND[part.kind] ?? 'bg-alpha-4',
                  label: copy.overview.composition.part[part.kind],
                  value: `≈${number(part.estimatedTokens)}`,
                }))}
              />
              {(overview.composition.composition.tools.length > 0 ||
                overview.composition.composition.unlabelledTools) && (
                <>
                  <h4 className="pt-1 text-xs font-medium leading-4 text-text-secondary">
                    {copy.overview.composition.tools}
                  </h4>
                  <FactList
                    rows={[
                      ...overview.composition.composition.tools.map((tool) => ({
                        key: tool.name,
                        label: tool.name,
                        value: `≈${number(tool.estimatedTokens)}`,
                      })),
                      ...(overview.composition.composition.remainingTools
                        ? [
                            {
                              key: '__remaining',
                              label: copy.overview.composition.remainingTools(
                                overview.composition.composition.remainingTools.count,
                              ),
                              value: `≈${number(
                                overview.composition.composition.remainingTools.estimatedTokens,
                              )}`,
                            },
                          ]
                        : []),
                      ...(overview.composition.composition.unlabelledTools
                        ? [
                            {
                              key: '__unlabelled',
                              label: copy.overview.composition.unlabelled,
                              value: `≈${number(
                                overview.composition.composition.unlabelledTools.estimatedTokens,
                              )}`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function SectionHead(props: { title: string; readout?: ReactNode; level?: 'warning' | 'error' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="min-w-0 truncate text-xs font-medium leading-5 text-text-secondary">
        {props.title}
      </h3>
      {props.readout !== undefined && (
        <span
          className={cn(
            'shrink-0 font-mono text-xs leading-5 tabular-nums',
            props.level === 'error'
              ? 'text-danger'
              : props.level === 'warning'
                ? 'text-warning'
                : 'text-text-primary',
          )}
        >
          {props.readout}
        </span>
      )}
    </div>
  );
}

/**
 * One track, weighted by value rather than sized in percent: a prompt that
 * overran its own window still fills exactly one track instead of spilling.
 */
function BandTrack(props: {
  bands: readonly { key: string; weight: number; className: string }[];
}) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-alpha-1" aria-hidden="true">
      {props.bands
        .filter((band) => band.weight > 0)
        .map((band) => (
          <span key={band.key} className={band.className} style={{ flexGrow: band.weight }} />
        ))}
    </div>
  );
}

/** The accessible copy of a track: name left, figure right. */
function FactList(props: {
  rows: readonly { key: string; label: string; value: string; swatch?: string }[];
}) {
  return (
    <dl className="flex flex-col gap-1">
      {props.rows.map((row) => (
        <div key={row.key} className="flex items-baseline justify-between gap-3">
          <dt className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-text-secondary">
            {row.swatch && (
              <span className={cn('size-2 shrink-0 rounded-full', row.swatch)} aria-hidden="true" />
            )}
            <span className="truncate">{row.label}</span>
          </dt>
          <dd className="shrink-0 font-mono text-xs leading-5 tabular-nums text-text-muted">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TurnRow(props: {
  turn: InspectorTurnRow;
  copy: InspectorCopy;
  locale: UiLocale;
  onCopyPricingKey: (key: string) => void;
}) {
  const { copy, turn } = props;
  return (
    <li data-maka-contract="session-inspector-turn" data-failed={turn.failed || undefined}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-xs font-medium leading-5 text-text-primary">
          {copy.turnLabel(formatTurnStartedAt(turn.startedAt, props.locale))}
        </span>
        {turn.failed && (
          <span
            className="shrink-0 text-xs leading-5 text-danger"
            data-maka-contract="session-inspector-turn-failed"
          >
            {copy.turnFailure(turn.failureCode ?? '')}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs leading-5 tabular-nums text-text-muted">
          {formatDuration(turn.durationMs)} · {formatCost(turn.costUsd, copy.costUnavailable)}
        </span>
      </div>
      <ol className="flex flex-col pl-2">
        {turn.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            copy={copy}
            onCopyPricingKey={props.onCopyPricingKey}
          />
        ))}
      </ol>
    </li>
  );
}

function StepRow(props: {
  step: InspectorStepRow;
  copy: InspectorCopy;
  onCopyPricingKey: (key: string) => void;
}) {
  const { copy, step } = props;
  const label = step.label ?? inspectorStepKindLabel(copy, step.kind);
  const qualifier = [
    step.callKind !== undefined ? copy.callKind(step.callKind) : undefined,
    step.decision !== undefined ? copy.permissionDecision(step.decision) : undefined,
    step.detail,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  const meta = [
    step.retries !== undefined ? copy.retries(step.retries) : undefined,
    step.durationMs !== undefined ? formatDuration(step.durationMs) : undefined,
  ].filter((part): part is string => part !== undefined);

  return (
    <li
      className="flex items-baseline gap-2 py-0.5"
      data-maka-contract="session-inspector-step"
      data-failed={step.failed || undefined}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
        <span
          className={cn(
            'min-w-0 truncate text-xs leading-5',
            step.failed ? 'text-danger' : 'text-text-secondary',
          )}
        >
          {label}
        </span>
        {qualifier && <span className="text-xs leading-5 text-text-muted">{qualifier}</span>}
        {step.unpricedPricingKey && (
          <span className="flex items-center gap-1 text-xs leading-5 text-text-muted">
            <span>{copy.unpricedPricingKey}</span>
            <code className="font-mono">{step.unpricedPricingKey}</code>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`${copy.copyPricingKey}: ${step.unpricedPricingKey}`}
              onClick={() => props.onCopyPricingKey(step.unpricedPricingKey ?? '')}
            >
              <Anthropicon name="copy" size={16} />
            </Button>
          </span>
        )}
        {step.recovered && (
          <span className="text-xs leading-5 text-warning">{copy.recoveredAs(step.recovered)}</span>
        )}
      </span>
      {meta.length > 0 && (
        <span className="shrink-0 font-mono text-xs leading-5 tabular-nums text-text-muted">
          {meta.join(' · ')}
        </span>
      )}
    </li>
  );
}

function numberFormatter(locale: UiLocale): (value: number) => string {
  const formatter = new Intl.NumberFormat(uiLocaleToIntlLocale(locale));
  return (value) => formatter.format(value);
}

/** Compact, and deliberately locale-independent: `12.3K` reads the same everywhere. */
function compactNumberFormatter(): (value: number) => string {
  return (value) => {
    if (value < 1_000) return String(value);
    if (value < 1_000_000) {
      const thousands = Math.round(value / 100) / 10;
      return thousands >= 1_000 ? '1M' : `${thousands}K`;
    }
    return `${Math.round(value / 100_000) / 10}M`;
  };
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1_000)}s`;
}

function formatTurnStartedAt(startedAt: number, locale: UiLocale): string {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat(uiLocaleToIntlLocale(locale), {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

/**
 * Absent cost renders as words, never as `$0.00`: the canonical record keeps
 * "nobody could price this" and "this was free" apart, and so does the panel.
 */
function formatCost(costUsd: number | undefined, unavailable: string): string {
  if (costUsd === undefined) return unavailable;
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;
}
