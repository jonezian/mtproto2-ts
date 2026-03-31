#!/usr/bin/env tsx
/**
 * TL Schema Differ
 *
 * Compares two TL schema files (old vs new) and reports differences.
 * Uses the TL parser from @mtproto2/tl-schema to parse both files.
 *
 * Usage:
 *   npx tsx scripts/diff-schema.ts [old-file] [new-file]
 *   npx tsx scripts/diff-schema.ts --ci   (uses backup vs current)
 *
 * Exit code:
 *   0 - no changes detected
 *   1 - changes detected
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseTLSchema } from '../packages/tl-schema/src/parser/parser.js';
import type { TLConstructor, TLSchema } from '../packages/tl-schema/src/parser/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Result of a schema diff comparison.
 */
export interface SchemaDiffResult {
  /** New constructors added (not in old schema) */
  addedConstructors: TLConstructor[];
  /** Constructors removed (in old but not in new) */
  removedConstructors: TLConstructor[];
  /** Constructors modified (same name but different params or type) */
  modifiedConstructors: Array<{
    name: string;
    old: TLConstructor;
    new: TLConstructor;
  }>;
  /** New methods/functions added */
  addedMethods: TLConstructor[];
  /** Methods/functions removed */
  removedMethods: TLConstructor[];
  /** Methods/functions modified */
  modifiedMethods: Array<{
    name: string;
    old: TLConstructor;
    new: TLConstructor;
  }>;
  /** Old layer number */
  oldLayer: number;
  /** New layer number */
  newLayer: number;
  /** Whether any changes were detected */
  hasChanges: boolean;
}

/**
 * Create a fingerprint string for a constructor/function for comparison.
 * Two constructors with the same name but different params or types are "modified".
 */
function constructorFingerprint(c: TLConstructor): string {
  const params = c.params
    .map((p) => {
      let s = `${p.name}:${p.type}`;
      if (p.isFlag) {
        s = `${p.flagField}.${p.flagIndex}?${s}`;
      }
      return s;
    })
    .join(' ');
  return `${c.name}#${c.id.toString(16)} ${params} = ${c.type}`;
}

/**
 * Diff two arrays of constructors/functions.
 */
function diffEntries(
  oldEntries: TLConstructor[],
  newEntries: TLConstructor[]
): {
  added: TLConstructor[];
  removed: TLConstructor[];
  modified: Array<{ name: string; old: TLConstructor; new: TLConstructor }>;
} {
  const oldByName = new Map<string, TLConstructor>();
  for (const c of oldEntries) {
    oldByName.set(c.name, c);
  }

  const newByName = new Map<string, TLConstructor>();
  for (const c of newEntries) {
    newByName.set(c.name, c);
  }

  const added: TLConstructor[] = [];
  const removed: TLConstructor[] = [];
  const modified: Array<{ name: string; old: TLConstructor; new: TLConstructor }> = [];

  // Find added and modified
  for (const [name, newEntry] of newByName) {
    const oldEntry = oldByName.get(name);
    if (!oldEntry) {
      added.push(newEntry);
    } else if (constructorFingerprint(oldEntry) !== constructorFingerprint(newEntry)) {
      modified.push({ name, old: oldEntry, new: newEntry });
    }
  }

  // Find removed
  for (const [name, oldEntry] of oldByName) {
    if (!newByName.has(name)) {
      removed.push(oldEntry);
    }
  }

  return { added, removed, modified };
}

/**
 * Compare two TL schemas and return the differences.
 */
export function diffSchemas(oldSchema: TLSchema, newSchema: TLSchema): SchemaDiffResult {
  const ctorDiff = diffEntries(oldSchema.constructors, newSchema.constructors);
  const methodDiff = diffEntries(oldSchema.functions, newSchema.functions);

  const hasChanges =
    ctorDiff.added.length > 0 ||
    ctorDiff.removed.length > 0 ||
    ctorDiff.modified.length > 0 ||
    methodDiff.added.length > 0 ||
    methodDiff.removed.length > 0 ||
    methodDiff.modified.length > 0 ||
    oldSchema.layer !== newSchema.layer;

  return {
    addedConstructors: ctorDiff.added,
    removedConstructors: ctorDiff.removed,
    modifiedConstructors: ctorDiff.modified,
    addedMethods: methodDiff.added,
    removedMethods: methodDiff.removed,
    modifiedMethods: methodDiff.modified,
    oldLayer: oldSchema.layer,
    newLayer: newSchema.layer,
    hasChanges,
  };
}

/**
 * Compare two TL schema strings and return the differences.
 */
export function diffSchemaStrings(oldContent: string, newContent: string): SchemaDiffResult {
  const oldSchema = parseTLSchema(oldContent);
  const newSchema = parseTLSchema(newContent);
  return diffSchemas(oldSchema, newSchema);
}

/**
 * Format a diff result as a human-readable summary string.
 */
export function formatDiffSummary(diff: SchemaDiffResult): string {
  const lines: string[] = [];

  lines.push('TL Schema Diff Summary');
  lines.push('======================');
  lines.push('');

  if (diff.oldLayer !== 0 || diff.newLayer !== 0) {
    lines.push(`Layer: ${diff.oldLayer || 'unknown'} -> ${diff.newLayer || 'unknown'}`);
    lines.push('');
  }

  if (!diff.hasChanges) {
    lines.push('No changes detected.');
    return lines.join('\n');
  }

  // Constructors
  lines.push('Constructors:');
  lines.push(`  Added:    ${diff.addedConstructors.length}`);
  lines.push(`  Removed:  ${diff.removedConstructors.length}`);
  lines.push(`  Modified: ${diff.modifiedConstructors.length}`);
  lines.push('');

  // Methods
  lines.push('Methods:');
  lines.push(`  Added:    ${diff.addedMethods.length}`);
  lines.push(`  Removed:  ${diff.removedMethods.length}`);
  lines.push(`  Modified: ${diff.modifiedMethods.length}`);
  lines.push('');

  // Details
  if (diff.addedConstructors.length > 0) {
    lines.push('New constructors:');
    for (const c of diff.addedConstructors) {
      lines.push(`  + ${c.name}#${c.id.toString(16)} = ${c.type}`);
    }
    lines.push('');
  }

  if (diff.removedConstructors.length > 0) {
    lines.push('Removed constructors:');
    for (const c of diff.removedConstructors) {
      lines.push(`  - ${c.name}#${c.id.toString(16)} = ${c.type}`);
    }
    lines.push('');
  }

  if (diff.modifiedConstructors.length > 0) {
    lines.push('Modified constructors:');
    for (const m of diff.modifiedConstructors) {
      lines.push(`  ~ ${m.name}`);
    }
    lines.push('');
  }

  if (diff.addedMethods.length > 0) {
    lines.push('New methods:');
    for (const m of diff.addedMethods) {
      lines.push(`  + ${m.name}#${m.id.toString(16)} = ${m.type}`);
    }
    lines.push('');
  }

  if (diff.removedMethods.length > 0) {
    lines.push('Removed methods:');
    for (const m of diff.removedMethods) {
      lines.push(`  - ${m.name}#${m.id.toString(16)} = ${m.type}`);
    }
    lines.push('');
  }

  if (diff.modifiedMethods.length > 0) {
    lines.push('Modified methods:');
    for (const m of diff.modifiedMethods) {
      lines.push(`  ~ ${m.name}`);
    }
    lines.push('');
  }

  const total =
    diff.addedConstructors.length +
    diff.removedConstructors.length +
    diff.modifiedConstructors.length +
    diff.addedMethods.length +
    diff.removedMethods.length +
    diff.modifiedMethods.length;
  lines.push(`Total changes: ${total}`);

  return lines.join('\n');
}

/**
 * Main entry point when run as a script.
 */
function main(): void {
  const args = process.argv.slice(2);

  let oldPath: string;
  let newPath: string;

  if (args.includes('--ci')) {
    // CI mode: compare backup (api.tl.bak) vs current
    oldPath = resolve(ROOT, 'packages/tl-schema/src/schema/api.tl.bak');
    newPath = resolve(ROOT, 'packages/tl-schema/src/schema/api.tl');
  } else if (args.length >= 2) {
    oldPath = resolve(args[0]);
    newPath = resolve(args[1]);
  } else {
    console.error('Usage: diff-schema.ts [old-file] [new-file]');
    console.error('       diff-schema.ts --ci');
    process.exit(2);
  }

  const oldContent = readFileSync(oldPath, 'utf-8');
  const newContent = readFileSync(newPath, 'utf-8');

  const diff = diffSchemaStrings(oldContent, newContent);
  const summary = formatDiffSummary(diff);

  console.log(summary);

  process.exit(diff.hasChanges ? 1 : 0);
}

// Run if executed directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('diff-schema.ts');

if (isMainModule) {
  main();
}
