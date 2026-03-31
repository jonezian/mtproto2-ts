# CLAUDE.md — mtproto2-ts

## Project Overview

mtproto2-ts is a complete TypeScript implementation of Telegram's MTProto 2.0 protocol.

## Architecture

Monorepo with npm workspaces. 8 packages:

- `packages/tl-schema` — TL parser + code generator (reads .tl schema -> generates TypeScript)
- `packages/tl-types` — Generated TL types (1,530 constructors + 742 methods, DO NOT edit manually)
- `packages/crypto` — AES-256-IGE, RSA, DH, SHA, PQ factorization
- `packages/binary` — TL binary serialization (TLReader/TLWriter)
- `packages/transport` — TCP transports (Abridged, Intermediate, Padded, Full) + obfuscation
- `packages/mtproto` — Core MTProto engine (encryption, session, RPC, updates)
- `packages/client` — High-level TelegramClient API
- `packages/kerain` — Private integration package (bot pool, Redis publisher, HTTP API)

## Commands

```bash
npm install              # Install all workspaces
npm run build            # Build all packages
npm run test             # Run all tests (vitest)
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint
npm run generate         # Run TL code generator
npm run fetch-schema     # Download latest TL schema
```

## Key Conventions

- All code is ESM (`"type": "module"`)
- TypeScript strict mode enabled
- All crypto randomness via `crypto.randomBytes()` — NEVER `Math.random()`
- Generated code in `packages/tl-types/src/generated/` — regenerate, don't edit
- Tests colocated with source (*.test.ts) or in tests/ directory
- Node.js 22+ required

## Package Scopes

- Generic packages use the `@mtproto2/` scope (binary, crypto, tl-schema, tl-types, transport, mtproto, client)
- The `packages/kerain` package uses `@kerainmtp/kerain` and is marked `"private": true`

## Security Rules

1. Never use `Math.random()` for any purpose — use `crypto.randomBytes()`
2. Always validate DH parameters (safe prime + subgroup check)
3. Use `crypto.timingSafeEqual()` for msg_key comparison
4. Validate padding length (12-1024 bytes) on decryption
5. Zero sensitive buffers after use (`Buffer.fill(0)`)
