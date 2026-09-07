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

// What the task changed on disk, as git sees it.
//
// Three bounds, all pre-rewrite and all kept: files are paged twenty at a time,
// each diff is capped at 500 lines, and every line goes through display
// redaction before it reaches the DOM — a diff is the surface most likely to
// carry a key someone just pasted into a config file.
//
// It re-reads on the same two signals the pre-rewrite panel used: a settled
// tool result or a finished turn (debounced), plus window focus, because the
// worktree also changes from outside the app while the reader is in an editor.
//
// A source that cannot be read is a FAILURE, not an absence: it takes the
// danger notice with a retry, never the empty state, so "this is not a git
// repository" is never mistaken for "nothing changed".

import { useCallback, useEffect, useRef, useState } from 'react';
import { redactSecrets } from '@maka/core/display-redaction';
import { generalizedErrorMessageForLocale } from '@maka/core/redaction';
import type { GitReviewReadResult } from '@maka/core/git-review';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import DiffRenderer from '../ui/DiffRenderer.js';
import { LoadingSpinner } from '../ui/LoadingSpinner.js';
import { PreviewNotice } from './PreviewNotice.js';
import { cn } from '../../lib/cn.js';
import { readGitReview } from '../../bridge/git-review.js';
import { activeSessionStore } from '../../store/index.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';

const REVIEW_FILE_PAGE_SIZE = 20;
const REVIEW_DIFF_LINE_CAP = 500;
const REVIEW_REFRESH_DEBOUNCE_MS = 250;

function boundedDiff(diff: string): { body: string; hiddenLines: number } {
  const lines = redactSecrets(diff).split('\n');
  if (lines.length <= REVIEW_DIFF_LINE_CAP) return { body: lines.join('\n'), hiddenLines: 0 };
  return {
    body: lines.slice(0, REVIEW_DIFF_LINE_CAP).join('\n'),
    hiddenLines: lines.length - REVIEW_DIFF_LINE_CAP,
  };
}

export function ReviewTab(props: { sessionId: string; active: boolean }) {
  const { active, sessionId } = props;
  const locale = useUiLocale();
  const copy = getDesktopConversationCopy(locale).reviewPanel;
  const [result, setResult] = useState<GitReviewReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleFiles, setVisibleFiles] = useState(REVIEW_FILE_PAGE_SIZE);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const revisionRef = useRef(0);

  const load = useCallback(async () => {
    const revision = ++revisionRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await readGitReview({ sessionId, source: 'branch' });
      if (revision !== revisionRef.current) return;
      setResult(next);
    } catch (unknownError) {
      if (revision !== revisionRef.current) return;
      setError(generalizedErrorMessageForLocale(unknownError, copy.loadFailed, locale));
    } finally {
      if (revision === revisionRef.current) setLoading(false);
    }
  }, [copy.loadFailed, locale, sessionId]);

  useEffect(() => {
    setResult(null);
    setOpenPath(null);
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), REVIEW_REFRESH_DEBOUNCE_MS);
    };
    const off = activeSessionStore.subscribeSessionEvents((eventSessionId, event) => {
      if (eventSessionId !== sessionId) return;
      if (event.type !== 'tool_result' && event.type !== 'complete') return;
      schedule();
    });
    // The worktree also changes from outside the app; returning to the window
    // is the moment a reader expects the panel to have caught up.
    const onFocus = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    void load();
    return () => {
      revisionRef.current += 1;
      clearTimeout(timer);
      off();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [active, load, sessionId]);

  const snapshot = result?.ok ? result.snapshot : null;
  const files = snapshot?.files ?? [];

  // A new revision is a different set of files; keeping the reader's page depth
  // across it would show twenty rows of a list that no longer has twenty.
  const revision = snapshot?.revision;
  useEffect(() => {
    setVisibleFiles(REVIEW_FILE_PAGE_SIZE);
  }, [revision]);

  const sourceError =
    result && !result.ok
      ? result.reason === 'not_git_repository'
        ? copy.notGitRepository
        : result.reason === 'workspace_unavailable'
          ? copy.workspaceUnavailable
          : result.reason === 'unborn_repository'
            ? copy.unbornRepository
            : result.reason === 'invalid_base_branch'
              ? copy.invalidBaseBranch
              : copy.gitFailed
      : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-maka-contract="session-review"
      role="region"
      aria-label={copy.ariaLabel}
      aria-busy={loading || undefined}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {files.length > 0 && (
            <>
              <span className="truncate text-xs leading-4 text-text-secondary">
                {copy.changedFiles(files.length)}
              </span>
              <span className="shrink-0 font-mono text-xs leading-4 tabular-nums text-success">
                {copy.addedLines(snapshot?.additions ?? 0)}
              </span>
              <span className="shrink-0 font-mono text-xs leading-4 tabular-nums text-danger">
                {copy.deletedLines(snapshot?.deletions ?? 0)}
              </span>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={copy.retry}
          disabled={loading}
          onClick={() => void load()}
        >
          <Anthropicon name="arrowClockwise" size={16} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading && result === null && (
          <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
            <LoadingSpinner size={24} />
          </div>
        )}
        {error && (
          <PreviewNotice
            tone="danger"
            title={copy.loadFailed}
            detail={error}
            action={{ label: copy.retry, icon: 'arrowClockwise', onClick: () => void load() }}
          />
        )}
        {sourceError && (
          <PreviewNotice
            tone="danger"
            title={sourceError}
            action={{
              label: copy.retry,
              icon: 'arrowClockwise',
              onClick: () => void load(),
              pending: loading,
            }}
          />
        )}
        {!loading && !error && !sourceError && files.length === 0 && result !== null && (
          <PreviewNotice icon="pullRequest" title={copy.empty} detail={copy.emptyHelp} />
        )}
        {snapshot?.truncated && (
          <p className="mb-2 rounded-lg bg-alpha-1 px-3 py-2 text-xs leading-5 text-text-secondary">
            {copy.truncated}
          </p>
        )}
        {files.length > 0 && (
          <ul className="flex flex-col" aria-label={copy.changedFiles(files.length)}>
            {files.slice(0, visibleFiles).map((file) => {
              const open = openPath === file.path;
              const preview = open ? boundedDiff(file.diff) : null;
              return (
                <li key={file.path} className="border-b-[0.5px] border-hairline last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenPath(open ? null : file.path)}
                    className="ui-control-squish ui-control-squish-ghost flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                  >
                    <Anthropicon
                      name="caretRight"
                      size={12}
                      className={cn('shrink-0 text-text-muted', open && 'rotate-90')}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs leading-5 text-text-primary">
                      {file.path}
                    </span>
                    {file.additions > 0 && (
                      <span className="shrink-0 font-mono text-xs leading-4 tabular-nums text-success">
                        {copy.added(file.additions)}
                      </span>
                    )}
                    {file.deletions > 0 && (
                      <span className="shrink-0 font-mono text-xs leading-4 tabular-nums text-danger">
                        {copy.deleted(file.deletions)}
                      </span>
                    )}
                  </button>
                  {open && preview && (
                    <div className="pb-2 pl-6 pr-2">
                      <DiffRenderer content={preview.body} />
                      {preview.hiddenLines > 0 && (
                        <p className="pt-1 text-xs leading-4 text-text-muted">
                          {copy.hiddenLines(preview.hiddenLines)}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {files.length > visibleFiles && (
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setVisibleFiles((current) =>
                  Math.min(files.length, current + REVIEW_FILE_PAGE_SIZE),
                )
              }
            >
              {copy.showMore(files.length - visibleFiles)}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
