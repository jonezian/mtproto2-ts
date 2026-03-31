#!/usr/bin/env tsx
/**
 * Session migration script.
 *
 * Reads all session documents from a Python-format MongoDB collection,
 * validates each session, and reports results. This is a read-only
 * operation that does NOT modify the database.
 *
 * Usage:
 *   npx tsx scripts/migrate-sessions.ts \
 *     --mongo-url mongodb://localhost:27017 \
 *     --db kerain \
 *     --collection sessions
 *
 * Options:
 *   --mongo-url   MongoDB connection string (required)
 *   --db          Database name (required)
 *   --collection  Collection name (required)
 *   --output      Output file path for JSON export (optional)
 */

import type { MongoClient, MongoCollection } from '../src/session/mongodb.js';
import { MigrationManager } from '../src/migration.js';
import type { SessionData } from '../../client/src/session/abstract.js';

/**
 * Parse command line arguments into a key-value map.
 */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      args[key] = argv[i + 1]!;
      i++;
    }
  }
  return args;
}

/**
 * Result of processing a single session document.
 */
interface SessionReport {
  phoneNumber: string;
  valid: boolean;
  errors: string[];
  session?: {
    dcId: number;
    authKeyHex: string;
    serverAddress: string;
    port: number;
  };
}

/**
 * Read all session documents from the MongoDB collection.
 *
 * Since we use an injectable interface without cursor support,
 * we rely on a findAll-style approach. In practice, the consumer
 * would pass in a real MongoDB client that supports iteration.
 */
export async function readAllSessions(
  collection: MongoCollection,
  phoneNumbers: string[],
): Promise<Array<{ phoneNumber: string; doc: Record<string, unknown> | null }>> {
  const results: Array<{ phoneNumber: string; doc: Record<string, unknown> | null }> = [];

  for (const phone of phoneNumbers) {
    const doc = await collection.findOne({ _id: phone });
    results.push({ phoneNumber: phone, doc });
  }

  return results;
}

/**
 * Convert a MongoDB document to SessionData.
 */
export function docToSessionData(doc: Record<string, unknown>): SessionData | null {
  const authKeyRaw = doc['auth_key'];
  let authKey: Buffer;

  if (Buffer.isBuffer(authKeyRaw)) {
    authKey = authKeyRaw;
  } else if (authKeyRaw instanceof Uint8Array) {
    authKey = Buffer.from(authKeyRaw);
  } else {
    return null;
  }

  return {
    dcId: (doc['dc_id'] as number) ?? 0,
    authKey,
    serverAddress: (doc['server_address'] as string) ?? '',
    port: (doc['port'] as number) ?? 443,
  };
}

/**
 * Process all sessions and generate a migration report.
 */
export function processSession(
  phoneNumber: string,
  doc: Record<string, unknown> | null,
  manager: MigrationManager,
): SessionReport {
  if (!doc) {
    return {
      phoneNumber,
      valid: false,
      errors: ['Session document not found'],
    };
  }

  const sessionData = docToSessionData(doc);

  if (!sessionData) {
    return {
      phoneNumber,
      valid: false,
      errors: ['Could not parse auth_key from document'],
    };
  }

  const validation = manager.validateSession(sessionData);

  if (!validation.valid) {
    return {
      phoneNumber,
      valid: false,
      errors: validation.errors,
    };
  }

  const portable = manager.exportSessionData(sessionData);

  return {
    phoneNumber,
    valid: true,
    errors: [],
    session: {
      dcId: portable.dcId,
      authKeyHex: portable.authKey,
      serverAddress: portable.serverAddress,
      port: portable.port,
    },
  };
}

/**
 * Main migration entry point.
 *
 * Connects to MongoDB, reads all sessions, validates them, and
 * outputs a report. Does NOT modify the database.
 */
export async function migrate(options: {
  mongoClient: MongoClient;
  database: string;
  collection: string;
  phoneNumbers: string[];
}): Promise<{
  total: number;
  valid: number;
  invalid: number;
  reports: SessionReport[];
}> {
  const { mongoClient, database, collection, phoneNumbers } = options;

  await mongoClient.connect();

  try {
    const db = mongoClient.db(database);
    const coll = db.collection(collection);
    const manager = new MigrationManager();

    const docs = await readAllSessions(coll, phoneNumbers);

    const reports: SessionReport[] = [];

    for (const { phoneNumber, doc } of docs) {
      reports.push(processSession(phoneNumber, doc, manager));
    }

    const valid = reports.filter((r) => r.valid).length;
    const invalid = reports.filter((r) => !r.valid).length;

    return {
      total: reports.length,
      valid,
      invalid,
      reports,
    };
  } finally {
    await mongoClient.close();
  }
}

/**
 * CLI entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const mongoUrl = args['mongo-url'];
  const dbName = args['db'];
  const collName = args['collection'];

  if (!mongoUrl || !dbName || !collName) {
    console.error('Usage: npx tsx scripts/migrate-sessions.ts --mongo-url <url> --db <name> --collection <name>');
    console.error('');
    console.error('Options:');
    console.error('  --mongo-url   MongoDB connection string (required)');
    console.error('  --db          Database name (required)');
    console.error('  --collection  Collection name (required)');
    process.exit(1);
  }

  // In a real run, you would import and instantiate the actual MongoDB client:
  //   import { MongoClient } from 'mongodb';
  //   const client = new MongoClient(mongoUrl);
  //
  // Since we don't depend on mongodb, this script serves as the template.
  // The consumer must wire up the actual client.
  console.log(`Migration script ready.`);
  console.log(`  MongoDB URL:  ${mongoUrl}`);
  console.log(`  Database:     ${dbName}`);
  console.log(`  Collection:   ${collName}`);
  console.log('');
  console.log('This script requires a MongoClient to be injected.');
  console.log('See the migrate() export for programmatic usage.');
}

// Only run main() when executed directly (not when imported for testing).
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('migrate-sessions.ts') || process.argv[1].endsWith('migrate-sessions.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
