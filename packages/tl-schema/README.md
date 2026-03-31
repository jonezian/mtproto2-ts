# @mtproto2/tl-schema

TL (Type Language) schema parser and TypeScript code generator for MTProto 2.0.

Reads `.tl` schema files and generates strongly-typed TypeScript interfaces, constructor ID maps, and a serializer registry.

## Installation

```bash
npm install @mtproto2/tl-schema
```

## API

### Parser

Parses raw TL schema text into an abstract syntax tree.

```ts
import { parseTLSchema } from '@mtproto2/tl-schema';
import type { TLSchema, TLConstructor, TLParam } from '@mtproto2/tl-schema';

const schema: TLSchema = parseTLSchema(tlSchemaText);

// schema.constructors -- array of TLConstructor (type constructors)
// schema.functions    -- array of TLConstructor (RPC methods)
// schema.layer        -- API layer number (e.g., 216)
```

The parser handles:
- Constructors and methods (separated by `---functions---`)
- Conditional fields (`flags.N?Type`)
- Vector types (`Vector<Type>`)
- Namespaces (`messages.sendMessage`)
- Bare types (lowercase) vs boxed types (uppercase)
- CRC32 constructor IDs (`#hexvalue`)
- Layer annotations

#### AST Types

```ts
interface TLParam {
  name: string;
  type: string;
  isFlag: boolean;
  flagField: string | null;   // e.g., "flags"
  flagIndex: number | null;   // e.g., 0, 1, 2
  isVector: boolean;
  innerType: string | null;   // inner type if vector
  isBareType: boolean;
  isTrueFlag: boolean;        // flags.N?true (presence flag, no data)
}

interface TLConstructor {
  name: string;               // e.g., "messages.sendMessage"
  id: number;                 // CRC32 constructor ID
  namespace: string | null;   // e.g., "messages"
  localName: string;          // e.g., "sendMessage"
  params: TLParam[];
  type: string;               // result type
  isFunction: boolean;
}

interface TLSchema {
  constructors: TLConstructor[];
  functions: TLConstructor[];
  layer: number;
}
```

### Generator

Generates TypeScript source files from a parsed schema.

```ts
import {
  generateTypeScript,
  generateSerializerRegistry,
  generateAll,
  mergeSchemas,
  crc32,
} from '@mtproto2/tl-schema';
import type { GeneratedFiles } from '@mtproto2/tl-schema';

// Generate all output files from raw TL text
const files: GeneratedFiles = generateAll(apiTL, mtprotoTL);
// files['types.ts']          -- TypeScript interfaces
// files['constructorIds.ts'] -- Constructor ID map
// files['registry.ts']       -- Serializer registry
// files['index.ts']          -- Barrel export

// Or use individual generators for fine-grained control:
const schema = parseTLSchema(tlText);
const { types, constructorIds } = generateTypeScript(schema);
const registry = generateSerializerRegistry(schema);

// Merge two schemas (e.g., api.tl + mtproto.tl)
const merged = mergeSchemas(apiSchema, mtprotoSchema);

// Compute CRC32 of a string (used for constructor ID generation)
const id = crc32('user#d23c81a3');
```

#### Generated Output

The generator produces four files:

| File | Contents |
|------|----------|
| `types.ts` | TypeScript interfaces for every constructor and method |
| `constructorIds.ts` | Map from constructor ID (number) to constructor name, and reverse |
| `registry.ts` | Serializer registry with field descriptors for each constructor |
| `index.ts` | Barrel exports |

### Schema Update Workflow

To update the TL types to a newer Telegram API layer:

```bash
# 1. Fetch the latest schema files
npm run fetch-schema

# 2. Compare with the current schema
npm run diff-schema

# 3. Regenerate TypeScript types
npm run generate

# 4. Run tests to verify
npx vitest run
```

The generated files are written to `packages/tl-types/src/generated/`.

## License

[MIT](../../LICENSE)
