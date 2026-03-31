#!/usr/bin/env tsx
/**
 * TL Schema Fetcher
 *
 * Fetches the latest TL schema from Telegram's public sources
 * and saves it to packages/tl-schema/src/schema/api.tl.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCHEMA_PATH = resolve(ROOT, 'packages/tl-schema/src/schema/api.tl');

/** Primary source: raw TL schema from GitHub */
const PRIMARY_URL =
  'https://raw.githubusercontent.com/nicegram/nicegram-schema/main/api.tl';

/** Fallback source: Telegram's JSON schema page */
const FALLBACK_URL = 'https://core.telegram.org/schema/json';

/**
 * Extract the layer number from a TL schema string.
 * Looks for `// LAYER N` comment, or `invokeWithLayer#...` as a fallback.
 */
export function extractLayerNumber(content: string): number {
  // Check for explicit layer comment
  const layerComment = content.match(/\/\/\s*LAYER\s+(\d+)/i);
  if (layerComment) {
    return parseInt(layerComment[1], 10);
  }

  // Fallback: try to extract from the schema content patterns
  // Some schemas don't have the LAYER comment, so we return 0
  return 0;
}

/**
 * Fetch the TL schema from the primary source.
 */
async function fetchFromPrimary(): Promise<string | null> {
  console.log(`Fetching from primary source: ${PRIMARY_URL}`);
  try {
    const response = await fetch(PRIMARY_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.warn(`Primary source returned ${response.status}: ${response.statusText}`);
      return null;
    }
    const text = await response.text();
    if (!text.includes('=') || !text.includes('#')) {
      console.warn('Primary source returned unexpected content (not a TL schema)');
      return null;
    }
    console.log(`Fetched ${text.length} bytes from primary source`);
    return text;
  } catch (err) {
    console.warn(`Primary source fetch failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Fetch the TL schema from the fallback (JSON) source and convert to TL format.
 */
async function fetchFromFallback(): Promise<string | null> {
  console.log(`Fetching from fallback source: ${FALLBACK_URL}`);
  try {
    const response = await fetch(FALLBACK_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.warn(`Fallback source returned ${response.status}: ${response.statusText}`);
      return null;
    }
    const json = await response.json() as {
      constructors?: Array<{
        id: string;
        predicate: string;
        params: Array<{ name: string; type: string }>;
        type: string;
      }>;
      methods?: Array<{
        id: string;
        method: string;
        params: Array<{ name: string; type: string }>;
        type: string;
      }>;
    };

    // Convert JSON schema to TL format
    const lines: string[] = [];

    if (json.constructors) {
      for (const ctor of json.constructors) {
        const id = (parseInt(ctor.id) >>> 0).toString(16);
        const params = ctor.params
          .map((p) => `${p.name}:${p.type}`)
          .join(' ');
        lines.push(
          params
            ? `${ctor.predicate}#${id} ${params} = ${ctor.type};`
            : `${ctor.predicate}#${id} = ${ctor.type};`
        );
      }
    }

    lines.push('');
    lines.push('---functions---');
    lines.push('');

    if (json.methods) {
      for (const method of json.methods) {
        const id = (parseInt(method.id) >>> 0).toString(16);
        const params = method.params
          .map((p) => `${p.name}:${p.type}`)
          .join(' ');
        lines.push(
          params
            ? `${method.method}#${id} ${params} = ${method.type};`
            : `${method.method}#${id} = ${method.type};`
        );
      }
    }

    const text = lines.join('\n') + '\n';
    console.log(`Converted JSON schema to TL format: ${text.length} bytes`);
    return text;
  } catch (err) {
    console.warn(`Fallback source fetch failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Fetch the latest TL schema. Tries primary source first, then fallback.
 */
export async function fetchSchema(): Promise<string> {
  let schema = await fetchFromPrimary();
  if (!schema) {
    console.log('Primary source failed, trying fallback...');
    schema = await fetchFromFallback();
  }
  if (!schema) {
    throw new Error('Failed to fetch schema from all sources');
  }
  return schema;
}

/**
 * Main entry point when run as a script.
 */
async function main(): Promise<void> {
  console.log('TL Schema Fetcher');
  console.log('=================');
  console.log('');

  const schema = await fetchSchema();

  // Show current schema info if it exists
  if (existsSync(SCHEMA_PATH)) {
    const current = readFileSync(SCHEMA_PATH, 'utf-8');
    const currentLayer = extractLayerNumber(current);
    console.log(`Current schema: ${current.length} bytes, layer ${currentLayer || 'unknown'}`);
  }

  // Write the new schema
  writeFileSync(SCHEMA_PATH, schema, 'utf-8');

  const newLayer = extractLayerNumber(schema);
  console.log(`New schema: ${schema.length} bytes, layer ${newLayer || 'unknown'}`);
  console.log(`Saved to: ${SCHEMA_PATH}`);
}

// Run if executed directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('fetch-schema.ts');

if (isMainModule) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(2);
  });
}
