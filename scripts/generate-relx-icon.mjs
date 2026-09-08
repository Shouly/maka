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

// The owner-supplied SVG remains the geometric source. Render the application
// tile from it, then encode each native ICNS representation at its own size.
// Usage: node scripts/generate-relx-icon.mjs [--check]
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = join(root, 'apps/desktop/assets/brand');
const symbol = await readFile(join(brand, 'relx-symbol.svg'), 'utf8');
const css = await readFile(join(root, 'apps/desktop/src/renderer/styles/globals.css'), 'utf8');
const colors = new Map(
  [...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2]]),
);
const brandColor = colors.get('fill-brand');
const brandHover = colors.get('fill-brand-hover');
if (!brandColor || !brandHover) throw new Error('Missing brand colours in globals.css');
const shade = `#${brandColor
  .slice(1)
  .match(/../g)
  .map((value) =>
    Math.round(parseInt(value, 16) * 0.88)
      .toString(16)
      .padStart(2, '0'),
  )
  .join('')}`;

const geometry = symbol.match(/<path d="([^"]+)"/)?.[1];
if (!geometry) throw new Error('The supplied symbol must contain its original path');
const license = symbol.slice(0, symbol.indexOf('-->') + 3);
const tile =
  'M320 100H704C784 100 831 107 866 142C911 187 924 236 924 320V704C924 784 917 831 882 866C837 911 788 924 704 924H320C240 924 193 917 158 882C113 837 100 788 100 704V320C100 240 107 193 142 158C187 113 236 100 320 100Z';
const svg = `${license}
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>RELX — system brand orange</title>
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2=".7" y2="1">
      <stop stop-color="${brandHover}"/><stop offset=".5" stop-color="${brandColor}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
    <radialGradient id="bloom" cx=".86" cy="1" r=".95">
      <stop stop-color="#FFFFFF" stop-opacity=".06"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2=".4" y2="1">
      <stop stop-color="#FFFFFF" stop-opacity=".48"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity=".1"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".18"/>
    </linearGradient>
    <linearGradient id="porcelain" x1="0" y1="0" x2=".32" y2="1">
      <stop stop-color="#FFFEF8"/><stop offset=".5" stop-color="#FBF7F0"/><stop offset="1" stop-color="#EEE6DD"/>
    </linearGradient>
    <filter id="tile-shadow" x="-15%" y="-15%" width="130%" height="135%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#24130D" flood-opacity=".24"/>
    </filter>
    <filter id="mark-shadow" x="-20%" y="-20%" width="140%" height="145%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#402015" flood-opacity=".32"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="8" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope=".025"/></feComponentTransfer>
      <feComposite in2="SourceGraphic" operator="in"/>
      <feBlend in2="SourceGraphic" mode="normal"/>
    </filter>
    <path id="tile" d="${tile}"/>
    <path id="mark" d="${geometry}"/>
  </defs>
  <use href="#tile" fill="url(#base)" filter="url(#tile-shadow)"/>
  <g filter="url(#grain)">
    <use href="#tile" fill="url(#base)"/>
    <use href="#tile" fill="url(#bloom)"/>
  </g>
  <use href="#tile" fill="none" stroke="url(#rim)" stroke-width="2"/>
  <g transform="translate(152 150) scale(1.5)">
    <use href="#mark" fill="url(#porcelain)" filter="url(#mark-shadow)"/>
    <use href="#mark" fill="none" stroke="#FFFFFF" stroke-opacity=".38" stroke-width=".7"/>
  </g>
</svg>
`;
const png = await sharp(Buffer.from(svg), { density: 144 }).resize(1024, 1024).png().toBuffer();
const chunks = [];
for (const [type, size] of [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
]) {
  const bytes = await sharp(Buffer.from(svg), { density: 144 }).resize(size, size).png().toBuffer();
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(bytes.length + 8, 4);
  chunks.push(header, bytes);
}
const payload = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write('icns');
header.writeUInt32BE(payload.length + 8, 4);
const outputs = [
  [join(brand, 'relx-app-icon.svg'), Buffer.from(svg)],
  [join(root, 'apps/desktop/assets/app-icons/relx.png'), png],
  [join(brand, 'relx.icns'), Buffer.concat([header, payload])],
];
await mkdir(brand, { recursive: true });
for (const [path, contents] of outputs) {
  if (process.argv.includes('--check')) {
    if (!(await readFile(path)).equals(contents)) throw new Error(`Outdated icon: ${path}`);
  } else {
    await writeFile(path, contents);
  }
}
console.log(
  process.argv.includes('--check')
    ? 'RELX icon assets match the vector source.'
    : 'Generated RELX SVG, 1024px PNG and 11 ICNS representations.',
);
