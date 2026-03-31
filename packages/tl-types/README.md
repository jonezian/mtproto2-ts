# @mtproto2/tl-types

Auto-generated TypeScript types for the Telegram API (layer 216).

Contains 1,530 constructors and 742 methods, generated from the official TL schema by `@mtproto2/tl-schema`.

**DO NOT EDIT** -- files in `src/generated/` are overwritten by the code generator. To update, regenerate from the schema.

## Installation

```bash
npm install @mtproto2/tl-types
```

## Contents

| Export | Description |
|--------|-------------|
| Type interfaces | TypeScript interfaces for every TL constructor (e.g., `Message`, `User`, `Chat`) |
| `constructorIds` | Map from constructor ID (number) to constructor name (string) |
| `constructorNames` | Map from constructor name (string) to constructor ID (number) |
| `registry` | Serializer registry: constructor ID to field descriptors |
| `registryByName` | Serializer registry: constructor name to field descriptors |

## Usage

```ts
import {
  constructorIds,
  constructorNames,
  registry,
  registryByName,
} from '@mtproto2/tl-types';
import type { FieldDescriptor, ConstructorDescriptor } from '@mtproto2/tl-types';

// Look up a constructor name by ID
const name = constructorIds.get(0xd23c81a3); // "user"

// Look up a constructor ID by name
const id = constructorNames.get('user'); // 0xd23c81a3

// Get field descriptors for serialization
const descriptor = registry.get(0xd23c81a3);
// descriptor.fields: FieldDescriptor[]
```

## Regenerating

To regenerate the types from an updated TL schema:

```bash
# From the monorepo root:
npm run fetch-schema     # Download latest api.tl and mtproto.tl
npm run generate         # Regenerate types
npx vitest run           # Verify tests pass
```

The generator reads `api.tl` and `mtproto.tl` and writes the output to `packages/tl-types/src/generated/`.

## License

[MIT](../../LICENSE)
