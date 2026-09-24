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

// Jupyter notebooks as the file tools see them, and as NotebookEdit changes them. Read shows each cell as
// `<cell id="…">source</cell id="…">`, a markdown cell tagged with
// `<cell_type>markdown</cell_type>`, and a cell's text outputs after it.

import { randomBytes } from 'node:crypto';

export interface NotebookOutput {
  readonly output_type?: string;
  readonly text?: string | readonly string[];
  readonly data?: Readonly<Record<string, unknown>>;
  readonly ename?: string;
  readonly evalue?: string;
  readonly traceback?: readonly string[];
}

export interface NotebookCell {
  readonly cell_type: string;
  readonly id?: string;
  readonly source: string | readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly outputs?: readonly NotebookOutput[];
  readonly execution_count?: number | null;
  readonly [key: string]: unknown;
}

export interface Notebook {
  readonly cells: readonly NotebookCell[];
  readonly [key: string]: unknown;
}

export function isNotebookPath(path: string): boolean {
  return path.toLowerCase().endsWith('.ipynb');
}

/** The notebook in `text`, or undefined when it is not one. */
export function parseNotebook(text: string): Notebook | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const cells = (value as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return undefined;
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object' || typeof (cell as NotebookCell).cell_type !== 'string') {
      return undefined;
    }
  }
  return value as Notebook;
}

/** A cell's id as Read shows it: its own, or `cell-<index>` for a notebook too old to carry one. */
export function notebookCellId(cell: NotebookCell, index: number): string {
  return typeof cell.id === 'string' && cell.id !== '' ? cell.id : `cell-${index}`;
}

export function notebookSource(source: string | readonly string[]): string {
  return typeof source === 'string' ? source : source.join('');
}

export function renderNotebookForRead(notebook: Notebook): string {
  return notebook.cells
    .map((cell, index) => {
      const id = notebookCellId(cell, index);
      const type = cell.cell_type === 'code' ? '' : `<cell_type>${cell.cell_type}</cell_type>`;
      const block = `<cell id="${id}">${type}${notebookSource(cell.source)}</cell id="${id}">`;
      const outputs = (cell.outputs ?? []).map(outputText).filter((text) => text !== '');
      return outputs.length === 0 ? block : `${block}\n\n${outputs.join('\n').trimEnd()}\n`;
    })
    .join('\n');
}

function outputText(output: NotebookOutput): string {
  switch (output.output_type) {
    case 'stream':
      return joined(output.text);
    case 'execute_result':
    case 'display_data': {
      const plain = output.data?.['text/plain'];
      if (typeof plain === 'string' || Array.isArray(plain)) return joined(plain as string[]);
      const image = Object.keys(output.data ?? {}).find((type) => type.startsWith('image/'));
      return image ? `[${image} output]` : '';
    }
    case 'error':
      return [
        `${output.ename ?? 'Error'}: ${output.evalue ?? ''}`,
        ...(output.traceback ?? []),
      ].join('\n');
    default:
      return '';
  }
}

function joined(text: string | readonly string[] | undefined): string {
  if (text === undefined) return '';
  return typeof text === 'string' ? text : text.join('');
}

export type NotebookEditMode = 'replace' | 'insert' | 'delete';

export interface NotebookEditInput {
  readonly cellId?: string | undefined;
  readonly newSource: string;
  readonly cellType?: 'code' | 'markdown' | undefined;
  readonly editMode?: NotebookEditMode | undefined;
}

/** A cell edit applied to a parsed notebook: the new notebook and the receipt. */
export function applyNotebookEdit(
  notebook: Notebook,
  input: NotebookEditInput,
): { notebook: Notebook; message: string } {
  const mode = input.editMode ?? 'replace';
  const cells = [...notebook.cells];
  const indexOf = (id: string): number => {
    const index = cells.findIndex((cell, at) => notebookCellId(cell, at) === id);
    if (index === -1) throw new Error(`Cell with ID "${id}" not found in notebook.`);
    return index;
  };
  if (mode === 'insert') {
    if (!input.cellType) throw new Error('Cell type is required when using edit_mode=insert.');
    const at = input.cellId === undefined ? 0 : indexOf(input.cellId) + 1;
    const id = randomBytes(4).toString('hex');
    cells.splice(at, 0, {
      cell_type: input.cellType,
      id,
      metadata: {},
      source: input.newSource,
      ...(input.cellType === 'code' ? { outputs: [], execution_count: null } : {}),
    });
    return {
      notebook: { ...notebook, cells },
      message: `Inserted cell ${id} with ${input.newSource}`,
    };
  }
  if (input.cellId === undefined) {
    throw new Error(`Cell ID is required when using edit_mode=${mode}.`);
  }
  const index = indexOf(input.cellId);
  if (mode === 'delete') {
    cells.splice(index, 1);
    return { notebook: { ...notebook, cells }, message: `Deleted cell ${input.cellId}` };
  }
  const current = cells[index]!;
  const cellType = input.cellType ?? current.cell_type;
  // A cell's outputs are what its old source produced. A code cell keeps
  // empty ones; a markdown cell may carry none at all, or nbformat rejects it.
  const { outputs: _outputs, execution_count: _count, ...rest } = current;
  cells[index] = {
    ...rest,
    cell_type: cellType,
    source: input.newSource,
    ...(cellType === 'code' ? { outputs: [], execution_count: null } : {}),
  };
  return {
    notebook: { ...notebook, cells },
    message: `Updated cell ${input.cellId} with ${input.newSource}`,
  };
}

/** The notebook as it is written back: nbformat's one-space indent, a final newline. */
export function serializeNotebook(notebook: Notebook): string {
  return `${JSON.stringify(notebook, null, 1)}\n`;
}
