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

// The input schema a model is offered for a tool the runtime did not write.
//
// Anthropic rejects the whole request, not just the call, when any offered
// tool's input_schema is not valid JSON Schema 2020-12, has anyOf/oneOf/allOf
// at its root, or names a property outside ^[a-zA-Z0-9_.-]{1,64}$ — so one MCP
// tool written to an older draft fails every turn once it is activated. The
// schema is rewritten here into a form any request can carry. The server stays
// the authority on arguments: nothing here validates a call, it only changes
// what the model reads.

import Ajv2020 from 'ajv/dist/2020.js';

type Schema = Record<string, unknown>;

const PROPERTY_KEY = /^[a-zA-Z0-9_.-]{1,64}$/u;
const ROOT_COMBINATORS = ['allOf', 'anyOf', 'oneOf'] as const;
const SCHEMA_MAPS = new Set(['patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_SINGLES = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

let metaValidator: Ajv2020 | undefined;

export function modelFacingInputSchema(schema: Schema): Schema {
  const rewritten = rewriteNode(
    Object.hasOwn(schema, 'type') ? schema : { ...schema, type: 'object' },
  );
  if (!isRecord(rewritten) || rewritten.type !== 'object') return { type: 'object' };
  const root = flattenRootCombinators(rewritten);
  // Whatever the rewrite cannot repair still must not reach the request: the
  // tool stays callable with its description, and the server checks the call.
  return isValidDraft2020(root) ? root : { type: 'object' };
}

function rewriteNode(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const out: Schema = {};
  const dropped = new Set<string>();
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (key === 'properties' && isRecord(value)) {
      const properties: Schema = {};
      for (const [name, property] of Object.entries(value)) {
        if (PROPERTY_KEY.test(name)) properties[name] = rewriteNode(property);
        else dropped.add(name);
      }
      out[key] = properties;
    } else if (SCHEMA_MAPS.has(key) && isRecord(value)) {
      out[key] = mapValues(value, rewriteNode);
    } else if (key === 'dependencies' && isRecord(value)) {
      // Draft-07 mixes the two forms: a list of property names or a schema.
      out[key] = mapValues(value, (entry) => (Array.isArray(entry) ? entry : rewriteNode(entry)));
    } else if ((SCHEMA_LISTS.has(key) || key === 'items') && Array.isArray(value)) {
      out[key] = value.map(rewriteNode);
    } else if (SCHEMA_SINGLES.has(key) || key === 'items') {
      out[key] = rewriteNode(value);
    } else {
      out[key] = value;
    }
  }
  if (dropped.size > 0 && Array.isArray(out.required)) {
    out.required = out.required.filter((name) => !dropped.has(name as string));
  }
  if (Array.isArray(out.items)) collapseTuple(out);
  for (const [exclusive, inclusive] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    // Draft-04 wrote an exclusive bound as a flag on the inclusive one.
    if (typeof out[exclusive] !== 'boolean') continue;
    if (out[exclusive] === true && typeof out[inclusive] === 'number') {
      out[exclusive] = out[inclusive];
      delete out[inclusive];
    } else {
      delete out[exclusive];
    }
  }
  return out;
}

/**
 * A draft-07 tuple (`items: [A, B]`) as one element schema. 2020-12 would say
 * `prefixItems`, but OpenAI-shaped providers want `items` on every array, so the
 * positions merge into one `anyOf` and the length bound carries over.
 */
function collapseTuple(schema: Schema): void {
  const entries = [...(schema.items as unknown[])];
  const extra = schema.additionalItems;
  if (extra === false) schema.maxItems ??= entries.length;
  else if (extra !== undefined && extra !== true) entries.push(extra);
  delete schema.additionalItems;
  const seen = new Set<string>();
  const variants = entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (variants.length === 0) delete schema.items;
  else schema.items = variants.length === 1 ? variants[0] : { anyOf: variants };
}

/**
 * anyOf/oneOf/allOf at the root become one object: every branch's properties
 * are offered, and only what all of `allOf` requires stays required.
 */
function flattenRootCombinators(root: Schema): Schema {
  if (!ROOT_COMBINATORS.some((key) => Object.hasOwn(root, key))) return root;
  const { allOf, anyOf, oneOf, ...rest } = root;
  const properties: Schema = isRecord(rest.properties) ? { ...rest.properties } : {};
  const required = new Set(Array.isArray(rest.required) ? rest.required : []);
  for (const [key, branches] of [
    ['allOf', allOf],
    ['anyOf', anyOf],
    ['oneOf', oneOf],
  ] as const) {
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      if (!isRecord(branch)) continue;
      if (isRecord(branch.properties)) {
        for (const [name, property] of Object.entries(branch.properties)) {
          if (!Object.hasOwn(properties, name)) properties[name] = property;
        }
      }
      if (key === 'allOf' && Array.isArray(branch.required)) {
        for (const name of branch.required) required.add(name);
      }
    }
  }
  const flattened: Schema = { ...rest };
  if (Object.keys(properties).length > 0) flattened.properties = properties;
  if (required.size > 0) flattened.required = [...required];
  else delete flattened.required;
  return flattened;
}

function isValidDraft2020(schema: Schema): boolean {
  metaValidator ??= new Ajv2020({ strict: false });
  try {
    return metaValidator.validateSchema(schema) === true;
  } catch {
    return false;
  }
}

function mapValues(value: Schema, map: (entry: unknown) => unknown): Schema {
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, map(entry)]));
}

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
