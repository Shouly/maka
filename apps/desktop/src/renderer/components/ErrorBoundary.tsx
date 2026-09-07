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

// The renderer's last line of defence.
//
// `.maka-error-surface` is not a style hook: `main-window.ts`'s diagnostic
// snapshot probes for it, so a renderer that has crashed is distinguishable
// from one that is merely slow (contract doc §4). The class must survive any
// restyle of this component.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copyDiagnosticReport } from '../bridge/diagnostics.js';
import { Button } from './ui/button.js';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error('Renderer error boundary caught an error', error, info.componentStack);
  }

  private handleCopyReport = (): void => {
    const { error, componentStack } = this.state;
    void copyDiagnosticReport({
      surface: 'renderer_crash',
      title: error?.name ?? 'Renderer error',
      description: error?.message ?? 'The renderer stopped rendering.',
      // Main owns the rest of the report (versions, logs, host state); the
      // renderer contributes only what main cannot see.
      details: [error?.stack, componentStack].filter(Boolean).join('\n\n') || undefined,
    }).then((copied) => {
      this.setState({ copied });
    });
  };

  render(): ReactNode {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="maka-error-surface flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-surface-1 p-8 text-center">
        <div className="flex max-w-lg flex-col gap-2">
          <h1 className="font-display text-2xl leading-8 text-text-primary">
            Something went wrong
          </h1>
          <p className="text-sm leading-5 text-text-secondary">
            The interface stopped rendering. The report below has everything needed to file a bug;
            the window keeps running, so nothing was lost.
          </p>
          <p className="rounded-lg border border-hairline bg-surface-2 p-3 text-left font-mono text-xs leading-5 text-danger">
            {error.message || String(error)}
          </p>
        </div>
        <Button variant="secondary" onClick={this.handleCopyReport}>
          {copied ? 'Report copied' : 'Copy report'}
        </Button>
      </div>
    );
  }
}
