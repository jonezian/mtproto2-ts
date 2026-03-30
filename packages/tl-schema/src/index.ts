/**
 * @kerainmtp/tl-schema
 *
 * TL schema parser and TypeScript code generator.
 */

// Parser
export { parseTLSchema } from './parser/parser.js';
export type { TLParam, TLConstructor, TLSchema } from './parser/types.js';

// Generator
export { crc32 } from './generator/crc32.js';
export { generateTypeScript } from './generator/typescript.js';
export { generateSerializerRegistry } from './generator/serializer.js';
export { generateAll, mergeSchemas } from './generator/index.js';
export type { GeneratedFiles } from './generator/index.js';
