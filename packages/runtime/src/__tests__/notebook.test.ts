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

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyNotebookEdit,
  parseNotebook,
  renderNotebookForRead,
  serializeNotebook,
} from '../notebook.js';

const DEMO = {
  cells: [
    { cell_type: 'markdown', id: 'md1', metadata: {}, source: '# Title\nintro text' },
    {
      cell_type: 'code',
      id: 'code1',
      metadata: {},
      execution_count: 1,
      outputs: [{ output_type: 'stream', name: 'stdout', text: '3\n' }],
      source: ['x = 1 + 2\n', 'print(x)'],
    },
    {
      cell_type: 'code',
      id: 'code2',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: 'y = x * 10',
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
};

describe('notebook rendering', () => {
  test('each cell is a tagged block, markdown typed, outputs after the cell', () => {
    const notebook = parseNotebook(JSON.stringify(DEMO));
    assert.ok(notebook);
    assert.equal(
      renderNotebookForRead(notebook),
      [
        '<cell id="md1"><cell_type>markdown</cell_type># Title',
        'intro text</cell id="md1">',
        '<cell id="code1">x = 1 + 2',
        'print(x)</cell id="code1">',
        '',
        '3',
        '',
        '<cell id="code2">y = x * 10</cell id="code2">',
      ].join('\n'),
    );
  });

  test('errors and rich outputs are summarised; a non-notebook is not parsed', () => {
    const notebook = parseNotebook(
      JSON.stringify({
        cells: [
          {
            cell_type: 'code',
            source: '1/0',
            outputs: [
              {
                output_type: 'error',
                ename: 'ZeroDivisionError',
                evalue: 'division by zero',
                traceback: ['tb'],
              },
              { output_type: 'display_data', data: { 'image/png': 'iVBOR' } },
              { output_type: 'execute_result', data: { 'text/plain': ['42'] } },
            ],
          },
        ],
      }),
    );
    assert.ok(notebook);
    assert.equal(
      renderNotebookForRead(notebook),
      '<cell id="cell-0">1/0</cell id="cell-0">\n\nZeroDivisionError: division by zero\ntb\n[image/png output]\n42\n',
    );
    assert.equal(parseNotebook('{"cells": "no"}'), undefined);
    assert.equal(parseNotebook('not json'), undefined);
  });
});

describe('notebook editing', () => {
  const notebook = () => parseNotebook(JSON.stringify(DEMO))!;

  test("replace clears a code cell's outputs and drops them from a markdown cell", () => {
    const replaced = applyNotebookEdit(notebook(), { cellId: 'code1', newSource: 'x = 42' });
    assert.equal(replaced.message, 'Updated cell code1 with x = 42');
    assert.deepEqual(replaced.notebook.cells[1], {
      cell_type: 'code',
      id: 'code1',
      metadata: {},
      source: 'x = 42',
      outputs: [],
      execution_count: null,
    });
    const markdown = applyNotebookEdit(notebook(), {
      cellId: 'code2',
      newSource: 'now text',
      cellType: 'markdown',
    });
    // nbformat forbids outputs and execution_count on a markdown cell.
    assert.deepEqual(markdown.notebook.cells[2], {
      cell_type: 'markdown',
      id: 'code2',
      metadata: {},
      source: 'now text',
    });
  });

  test('insert goes after the named cell, or first, with a fresh 8-hex id', () => {
    const after = applyNotebookEdit(notebook(), {
      cellId: 'code1',
      newSource: '## note',
      cellType: 'markdown',
      editMode: 'insert',
    });
    assert.match(after.message, /^Inserted cell [0-9a-f]{8} with ## note$/);
    assert.deepEqual(
      after.notebook.cells.map((cell) => cell.cell_type),
      ['markdown', 'code', 'markdown', 'code'],
    );
    const first = applyNotebookEdit(notebook(), {
      newSource: 'import math',
      cellType: 'code',
      editMode: 'insert',
    });
    assert.deepEqual(first.notebook.cells[0], {
      cell_type: 'code',
      id: first.notebook.cells[0]!.id,
      metadata: {},
      source: 'import math',
      outputs: [],
      execution_count: null,
    });
  });

  test('delete removes the cell; the refusals name what is missing', () => {
    const deleted = applyNotebookEdit(notebook(), {
      cellId: 'md1',
      newSource: '',
      editMode: 'delete',
    });
    assert.equal(deleted.message, 'Deleted cell md1');
    assert.deepEqual(
      deleted.notebook.cells.map((cell) => cell.id),
      ['code1', 'code2'],
    );
    assert.throws(
      () => applyNotebookEdit(notebook(), { newSource: 'x', editMode: 'insert' }),
      /^Error: Cell type is required when using edit_mode=insert\.$/,
    );
    assert.throws(
      () => applyNotebookEdit(notebook(), { cellId: 'nope', newSource: 'x' }),
      /^Error: Cell with ID "nope" not found in notebook\.$/,
    );
    assert.throws(
      () => applyNotebookEdit(notebook(), { newSource: 'x', editMode: 'delete' }),
      /^Error: Cell ID is required when using edit_mode=delete\.$/,
    );
  });

  test("serialises with nbformat's one-space indent and a final newline", () => {
    const text = serializeNotebook(notebook());
    assert.ok(text.startsWith('{\n "cells": [\n  {\n'));
    assert.ok(text.endsWith('}\n'));
    assert.deepEqual(parseNotebook(text), notebook());
  });
});
