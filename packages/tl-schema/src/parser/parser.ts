/**
 * TL Schema parser.
 *
 * Parses the Telegram TL schema format into an AST (TLSchema).
 * Handles constructors, functions, flags, vectors, namespaces,
 * generic types, and built-in primitives.
 */

import type { TLParam, TLConstructor, TLSchema } from './types.js';

/** Lines that define built-in primitive types — skip these. */
const BUILTIN_RE = /^(int|long|double|string)\s+\?\s*=\s*/;

/** The special vector definition line. */
const VECTOR_DEF_RE = /^vector#[0-9a-f]+\s+\{t:Type\}/i;

/** Lines like `int128 4*[ int ] = Int128;` — skip these too. */
const COMPOUND_BUILTIN_RE = /^(int128|int256)\s+\d+\*\[/;

/** Constructor/function line: `name#hexid params... = ResultType;` */
const CONSTRUCTOR_RE = /^([a-zA-Z0-9_.]+)#([0-9a-f]+)\s+(.*?)\s*=\s*(.+?)\s*;\s*$/;

/** Constructor/function line without params: `name#hexid = ResultType;` */
const CONSTRUCTOR_NOPARAM_RE = /^([a-zA-Z0-9_.]+)#([0-9a-f]+)\s*=\s*(.+?)\s*;\s*$/;

/** Flag condition pattern: `flags.N?Type` or `flags2.N?Type` */
const FLAG_RE = /^([a-zA-Z0-9_]+)\.(\d+)\?(.+)$/;

/** Vector pattern: `VectorType>` (HTML-escaped) or `Vector<Type>` (proper angle brackets) */
const VECTOR_ESCAPED_RE = /^Vector([A-Za-z0-9_.!>]+)>$/i;
const VECTOR_ANGLE_RE = /^Vector<([A-Za-z0-9_.!]+)>$/i;

/**
 * Parse a full TL schema string into a TLSchema AST.
 */
export function parseTLSchema(content: string): TLSchema {
  const lines = content.split('\n');
  const constructors: TLConstructor[] = [];
  const functions: TLConstructor[] = [];
  let isFunction = false;
  let layer = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines
    if (line === '') continue;

    // Skip comments, but extract layer info
    if (line.startsWith('//')) {
      const layerMatch = line.match(/\/\/\s*LAYER\s+(\d+)/i);
      if (layerMatch) {
        layer = parseInt(layerMatch[1], 10);
      }
      continue;
    }

    // Section dividers
    if (line === '---functions---') {
      isFunction = true;
      continue;
    }
    if (line === '---types---') {
      isFunction = false;
      continue;
    }

    // Skip built-in type definitions
    if (BUILTIN_RE.test(line)) continue;
    if (COMPOUND_BUILTIN_RE.test(line)) continue;

    // Skip the special vector definition
    if (VECTOR_DEF_RE.test(line)) continue;

    // Skip lines without # (no constructor ID) — e.g. `message msg_id:long ...` in mtproto.tl
    if (!line.includes('#')) continue;

    // Skip generic type parameter prefixes like `{X:Type}` — these appear on some lines
    const cleaned = line.replace(/\{[A-Za-z]:Type\}\s*/g, '');

    // Try to parse as constructor/function with params
    let match = CONSTRUCTOR_RE.exec(cleaned);
    if (match) {
      const [, name, hexId, paramStr, resultType] = match;
      const parsed = parseConstructor(name, hexId, paramStr, resultType, isFunction);
      if (parsed) {
        if (isFunction) {
          functions.push(parsed);
        } else {
          constructors.push(parsed);
        }
      }
      continue;
    }

    // Try to parse as constructor/function without params
    match = CONSTRUCTOR_NOPARAM_RE.exec(cleaned);
    if (match) {
      const [, name, hexId, resultType] = match;
      const parsed = parseConstructor(name, hexId, '', resultType, isFunction);
      if (parsed) {
        if (isFunction) {
          functions.push(parsed);
        } else {
          constructors.push(parsed);
        }
      }
      continue;
    }
  }

  return { constructors, functions, layer };
}

/**
 * Parse a single constructor/function definition.
 */
function parseConstructor(
  name: string,
  hexId: string,
  paramStr: string,
  resultType: string,
  isFunction: boolean,
): TLConstructor {
  const id = parseInt(hexId, 16);
  const dotIndex = name.indexOf('.');
  const namespace = dotIndex >= 0 ? name.substring(0, dotIndex) : null;
  const localName = dotIndex >= 0 ? name.substring(dotIndex + 1) : name;

  const params = paramStr ? parseParams(paramStr) : [];

  return {
    name,
    id,
    namespace,
    localName,
    params,
    type: resultType,
    isFunction,
  };
}

/**
 * Parse the parameter string portion of a constructor line.
 *
 * Parameters are space-separated: `param1:type1 param2:flags.0?type2 ...`
 */
function parseParams(paramStr: string): TLParam[] {
  const parts = paramStr.trim().split(/\s+/);
  const params: TLParam[] = [];

  for (const part of parts) {
    if (!part || !part.includes(':')) continue;

    const colonIndex = part.indexOf(':');
    const paramName = part.substring(0, colonIndex);
    let rawType = part.substring(colonIndex + 1);

    // Skip generic type parameters like `{X:Type}`
    if (paramName.startsWith('{')) continue;

    // Check for flag condition: `flags.N?Type` or `flags2.N?Type`
    let isFlag = false;
    let flagField: string | null = null;
    let flagIndex: number | null = null;

    const flagMatch = FLAG_RE.exec(rawType);
    if (flagMatch) {
      isFlag = true;
      flagField = flagMatch[1];
      flagIndex = parseInt(flagMatch[2], 10);
      rawType = flagMatch[3];
    }

    // Check for true flag
    const isTrueFlag = rawType === 'true';

    // Check for vector — handle both `Vector<Type>` and `VectorType>` (HTML-escaped)
    let isVector = false;
    let innerType: string | null = null;

    let vectorMatch = VECTOR_ANGLE_RE.exec(rawType);
    if (vectorMatch) {
      isVector = true;
      innerType = vectorMatch[1];
    } else {
      vectorMatch = VECTOR_ESCAPED_RE.exec(rawType);
      if (vectorMatch) {
        isVector = true;
        innerType = vectorMatch[1];
        // Remove trailing `>` from HTML-escaped nesting artifacts
        if (innerType.endsWith('>')) {
          innerType = innerType.slice(0, -1);
        }
      }
    }

    // Check for bare type: lowercase first letter = bare type
    // Exceptions: built-in types like `int`, `long`, `double`, `string`, `bytes` are bare
    // Types starting with uppercase are boxed
    const isBareType = rawType.length > 0 && rawType[0] === rawType[0].toLowerCase() && rawType[0] !== rawType[0].toUpperCase();

    params.push({
      name: paramName,
      type: rawType,
      isFlag,
      flagField,
      flagIndex,
      isVector,
      innerType,
      isBareType,
      isTrueFlag,
    });
  }

  return params;
}
