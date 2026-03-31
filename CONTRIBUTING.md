# Contributing to mtproto2-ts

Thank you for your interest in contributing to mtproto2-ts. This guide covers the development setup, code conventions, and pull request process.

## Development Setup

```bash
git clone https://github.com/jonezian/KerainMTP.git
cd KerainMTP
npm install
npm run build
npx vitest run
```

Ensure all 974+ tests pass before making changes.

### Requirements

- Node.js 22 or later
- npm 10 or later

## Project Structure

```
packages/
  binary/       TL binary serialization (TLReader / TLWriter)
  crypto/       Cryptographic primitives (AES-IGE, RSA, DH, PQ, SHA)
  tl-schema/    TL schema parser and TypeScript code generator
  tl-types/     Auto-generated types (DO NOT edit manually)
  transport/    TCP transport layer (Abridged, Intermediate, Padded, Full, Obfuscated)
  mtproto/      Core MTProto 2.0 engine (encryption, sessions, RPC, updates)
  client/       High-level Telegram client API
```

All publishable packages use the `@mtproto2/` npm scope.

## Running Tests

Run the full test suite:

```bash
npx vitest run
```

Run tests for a single package:

```bash
npx vitest run packages/crypto
npx vitest run packages/binary
npx vitest run packages/transport
```

Run tests in watch mode during development:

```bash
npx vitest
```

## Code Style

- **ESM only** -- all code uses `"type": "module"` with `.js` import extensions
- **Strict TypeScript** -- `strict: true` is enabled in tsconfig; do not use `any`
- **No `Math.random()`** -- see Security Rules below
- **Functional where possible** -- prefer pure functions; use classes only where state management requires it
- **Naming conventions** -- camelCase for functions and variables, PascalCase for classes and interfaces, UPPER_SNAKE_CASE for constants
- **No default exports** -- use named exports exclusively

## Security Rules

These rules are mandatory for all contributions. Pull requests that violate them will not be merged.

1. **All randomness must use `crypto.randomBytes()`** -- never use `Math.random()` for any purpose, including non-cryptographic uses. This eliminates any risk of accidental use in security-sensitive contexts.

2. **Timing-safe comparisons for keys and hashes** -- always use `crypto.timingSafeEqual()` when comparing msg_key, nonces, auth key hashes, or any security-relevant buffers. Never use `===` or `Buffer.equals()` for these comparisons.

3. **DH parameter validation is required** -- every DH exchange must validate that the prime is a 2048-bit safe prime (`isGoodPrime`) and that g_a/g_b values are in the valid range (`isGoodGa`).

4. **Padding validation on decryption** -- when decrypting MTProto messages, always verify that the padding length is between 12 and 1024 bytes. Reject messages with invalid padding.

5. **Zero sensitive buffers after use** -- call `Buffer.fill(0)` on buffers containing auth keys, temp keys, or other sensitive material when they are no longer needed.

## Adding New Packages

New packages follow the npm workspace pattern:

1. Create a directory under `packages/`:
   ```bash
   mkdir packages/my-package
   ```

2. Add a `package.json`:
   ```json
   {
     "name": "@mtproto2/my-package",
     "version": "0.1.0",
     "type": "module",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "tsc"
     }
   }
   ```

3. Add a `tsconfig.json` that extends the root config.

4. Create `src/index.ts` with named exports.

5. Add tests alongside the source code or in the `tests/` directory.

## Schema Updates

To update the TL schema to a newer Telegram API layer:

```bash
npm run fetch-schema     # Download latest api.tl and mtproto.tl
npm run diff-schema      # Review changes
npm run generate         # Regenerate TypeScript types in packages/tl-types
npx vitest run           # Verify tests pass
```

Never edit files in `packages/tl-types/src/generated/` manually. They are overwritten by the generator.

## Pull Requests

1. **Fork** the repository and create a feature branch from `main`.
2. **Make your changes** following the code style and security rules above.
3. **Add or update tests** for any new or changed functionality.
4. **Run the full test suite** to ensure nothing is broken:
   ```bash
   npx vitest run
   ```
5. **Run type checking and linting**:
   ```bash
   npm run typecheck
   npm run lint
   ```
6. **Open a pull request** against `main` with a clear description of your changes.

### PR Checklist

- [ ] All tests pass (`npx vitest run`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] No `Math.random()` usage anywhere
- [ ] No `any` types introduced
- [ ] Security rules followed (see above)
- [ ] New functionality includes tests
