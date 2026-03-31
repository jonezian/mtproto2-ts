#!/usr/bin/env tsx
/**
 * TL Schema Update Orchestrator
 *
 * Combines fetch + diff + generate into one script.
 *
 * Steps:
 *   1. Copy current api.tl to a temp backup
 *   2. Fetch latest schema
 *   3. Diff old vs new
 *   4. If changes detected: run the code generator
 *   5. Print summary of changes
 *
 * Exit codes:
 *   0 - no changes detected
 *   1 - updated successfully
 *   2 - error occurred
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchSchema, extractLayerNumber } from './fetch-schema.js';
import { diffSchemaStrings, formatDiffSummary } from './diff-schema.js';
import { generateAll } from '../packages/tl-schema/src/generator/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCHEMA_DIR = resolve(ROOT, 'packages/tl-schema/src/schema');
const SCHEMA_PATH = resolve(SCHEMA_DIR, 'api.tl');
const BACKUP_PATH = resolve(SCHEMA_DIR, 'api.tl.bak');
const MTPROTO_PATH = resolve(SCHEMA_DIR, 'mtproto.tl');
const OUTPUT_DIR = resolve(ROOT, 'packages/tl-types/src/generated');

async function main(): Promise<void> {
  console.log('TL Schema Update Orchestrator');
  console.log('=============================');
  console.log('');

  // Step 1: Read current schema and create backup
  let oldContent = '';
  if (existsSync(SCHEMA_PATH)) {
    oldContent = readFileSync(SCHEMA_PATH, 'utf-8');
    copyFileSync(SCHEMA_PATH, BACKUP_PATH);
    const oldLayer = extractLayerNumber(oldContent);
    console.log(`Step 1: Backed up current schema (${oldContent.length} bytes, layer ${oldLayer || 'unknown'})`);
  } else {
    console.log('Step 1: No existing schema found, will create new');
  }
  console.log('');

  // Step 2: Fetch latest schema
  console.log('Step 2: Fetching latest schema...');
  let newContent: string;
  try {
    newContent = await fetchSchema();
  } catch (err) {
    console.error(`Failed to fetch schema: ${(err as Error).message}`);
    // Restore backup if needed
    if (existsSync(BACKUP_PATH)) {
      copyFileSync(BACKUP_PATH, SCHEMA_PATH);
      unlinkSync(BACKUP_PATH);
    }
    process.exit(2);
  }

  // Write fetched schema
  writeFileSync(SCHEMA_PATH, newContent, 'utf-8');
  const newLayer = extractLayerNumber(newContent);
  console.log(`Fetched schema: ${newContent.length} bytes, layer ${newLayer || 'unknown'}`);
  console.log('');

  // Step 3: Diff old vs new
  console.log('Step 3: Comparing schemas...');
  const diff = diffSchemaStrings(oldContent, newContent);
  const summary = formatDiffSummary(diff);
  console.log(summary);
  console.log('');

  // Clean up backup
  if (existsSync(BACKUP_PATH)) {
    unlinkSync(BACKUP_PATH);
  }

  // Step 4: If changes detected, run code generator
  if (!diff.hasChanges) {
    console.log('No changes detected. Schema is up to date.');
    process.exit(0);
  }

  console.log('Step 4: Generating TypeScript code...');
  const apiTL = readFileSync(SCHEMA_PATH, 'utf-8');
  const mtprotoTL = readFileSync(MTPROTO_PATH, 'utf-8');

  const files = generateAll(apiTL, mtprotoTL);

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const [filename, content] of Object.entries(files)) {
    const outputPath = resolve(OUTPUT_DIR, filename);
    writeFileSync(outputPath, content, 'utf-8');
    const lineCount = content.split('\n').length;
    console.log(`  Wrote ${filename}: ${content.length} bytes (${lineCount} lines)`);
  }
  console.log('');

  // Step 5: Summary
  console.log('Step 5: Update complete!');
  console.log(`Schema updated to layer ${newLayer || 'unknown'}`);
  console.log('Generated files written to:', OUTPUT_DIR);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review the generated changes');
  console.log('  2. Run tests: npx vitest run');
  console.log('  3. Commit the changes');

  process.exit(1);
}

main().catch((err) => {
  console.error('Unexpected error:', (err as Error).message);
  process.exit(2);
});
