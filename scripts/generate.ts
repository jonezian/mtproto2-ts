#!/usr/bin/env tsx
/**
 * TL Code Generator CLI
 *
 * Reads api.tl and mtproto.tl schema files, parses them,
 * generates TypeScript code, and writes to packages/tl-types/src/generated/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateAll } from '../packages/tl-schema/src/generator/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCHEMA_DIR = resolve(ROOT, 'packages/tl-schema/src/schema');
const OUTPUT_DIR = resolve(ROOT, 'packages/tl-types/src/generated');

console.log('TL Code Generator');
console.log('=================');
console.log(`Schema dir: ${SCHEMA_DIR}`);
console.log(`Output dir: ${OUTPUT_DIR}`);
console.log('');

// Read schema files
const apiTL = readFileSync(resolve(SCHEMA_DIR, 'api.tl'), 'utf-8');
const mtprotoTL = readFileSync(resolve(SCHEMA_DIR, 'mtproto.tl'), 'utf-8');

console.log(`Read api.tl: ${apiTL.length} bytes`);
console.log(`Read mtproto.tl: ${mtprotoTL.length} bytes`);

// Generate all output
const files = generateAll(apiTL, mtprotoTL);

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Write output files
for (const [filename, content] of Object.entries(files)) {
  const outputPath = resolve(OUTPUT_DIR, filename);
  writeFileSync(outputPath, content, 'utf-8');
  const lines = content.split('\n').length;
  console.log(`Wrote ${filename}: ${content.length} bytes (${lines} lines)`);
}

console.log('');
console.log('Done! Generated files in:', OUTPUT_DIR);
