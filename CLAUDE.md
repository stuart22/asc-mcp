# asc-mcp — rules for working in this repo

Locally-run, read-only MCP server for App Store Connect.

## Non-negotiable

- Never log, return, or put in error messages: private key material, JWTs, `Authorization` headers, request or response bodies. stdout is the MCP channel; diagnostics go to stderr only.
- No author-, person- or environment-specific values in code (domains, key IDs, app names, paths).
- Child processes only via `execFile`/`spawn` with an argument array. Never `exec`, never `shell: true`, never build a command string.
- The Apple host is the constant in `src/asc/client.ts`. No env override.
- Read-only until a write tool is explicitly requested. Write tools are added one at a time, each named for the change it makes (`create_app_store_version`, `add_beta_tester`) with a description that makes the change obvious in a permission prompt and `destructiveHint` set appropriately.
- Endpoints and fields come from Apple's official OpenAPI spec (developer.apple.com), never from third-party repos.

## Dependencies

- Runtime: `@modelcontextprotocol/server`, `zod`. Dev: `typescript`, `@types/node`. Adding anything needs a reason.
- Exact versions only (`.npmrc` has `save-exact=true`, `ignore-scripts=true`); commit `package-lock.json`.
- GitHub Actions are pinned to full commit SHAs with the tag in a comment.

## Code

- TypeScript run directly by Node in tests (type stripping): relative imports use `.ts` extensions; erasable syntax only (no enums, namespaces, parameter properties).
- Everything below `src/index.ts` receives its dependencies (fetch, execFile, clock) as arguments so tests can inject fakes.
- Tool output is compact text for Claude, not raw Apple JSON.

## Commands

- `npm test` — unit + in-process integration tests (Apple API mocked)
- `npm run typecheck`, `npm run build`
- `npm run smoke -- "<app>"` — manual test against the real API with your key
