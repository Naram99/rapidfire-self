# Rapidfire

Self-hosted realtime quiz system. M0–M3 provide the development environment, native game engine, backend/socket controller, PostgreSQL persistence, Better Auth and email adapter. The gameplay/auth frontend is the next milestone; live SMTP2GO delivery requires provider configuration.

## Requirements

- Node.js **24.19.0** (`.node-version` / `.nvmrc`); npm **11.9.0**.
- Docker Engine with Docker Compose v2 for the local PostgreSQL 17 service.
- Chromium for Playwright: the cloud environment uses its installed `/usr/bin/chromium`. Elsewhere, install the Playwright browser with `npx playwright install chromium`; on Linux, use `--with-deps` if system libraries are missing.

## First setup

Run these commands from the repository root:

```sh
npm ci
npm run env:init
npm run db:up
npm run db:migrate
npm run check
```

`env:init` creates an ignored, owner-readable `.env` with random local database credentials and auth secret, preserving existing configuration and filling only a missing auth secret. It automatically selects system Chromium when available. Keep `POSTGRES_PASSWORD` and the password portion of `DATABASE_URL` consistent. Other database ports require updating both `POSTGRES_PORT` and `DATABASE_URL`. Real verification/reset email requires SMTP credentials and a verified sender; tests use a separate email port.

Beginner Hungarian instructions: [PostgreSQL in Docker, schema generation and migrations](docs/database-guide.md). Apply committed migrations with `db:migrate`; schema generation is for schema changes, not ordinary first setup.

`db:up` waits for PostgreSQL readiness. Database data lives in a named Docker volume. `npm run db:stop` stops the database without deleting data. The development database listens on loopback only.

## Development

```sh
npm run dev
```

Vite serves the frontend on port 5173 and proxies `/api` and `/socket.io` (including WebSocket upgrades) to Express on port 3000. The browser uses one origin. `/api/health` reports process availability. Startup requires a reachable, migrated database. The browser page remains the application shell; M4 adds the user flows. Socket connections require protocol version 1 and a server-validated Better Auth, guest or match-return cookie.

For an existing shell, restart stopped services with `npm run db:up` and `npm run dev`; do not assume processes survive a restored cloud environment.

Root `dev`, `test`, `test:watch` and `typecheck` build the shared engine/contracts packages before consuming their exported files. `npm run build:shared` refreshes just those packages. After changing shared-package source during a development/watch session, rebuild them and restart the session to use the new exports. Direct server workspace commands assume the shared packages have already been built.

## Verification

| Command                | Checks                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | Strict TypeScript checks for all four workspaces and test/configuration files.                                                                                            |
| `npm run build`        | Shared-package declarations, Node server output and production Vite bundle, in dependency order.                                                                          |
| `npm test`             | Engine, public contracts, controller/adapter and real Socket.IO tests, plus PostgreSQL/Drizzle integration. The database check requires PostgreSQL.                       |
| `npm run test:e2e`     | Playwright Chromium checks: React rendering, proxied API responses, JSON API 404, Socket.IO polling and WebSocket handshakes. Starts the development servers when needed. |
| `npm run check`        | Type checking, build, integration test and browser tests.                                                                                                                 |
| `npm run format:check` | Formatting of scaffold/configuration files.                                                                                                                               |

`npm run test:e2e:production` runs the same browser checks against the compiled frontend and the single production-mode Node process on port 3000. It requires `npm run build` first. `npm run check` includes both development and production-shaped browser checks.

The Vitest suite verifies engine/controller behavior, real Better Auth HTTP/socket sessions and PostgreSQL persistence/deletion transactions. Tests create isolated temporary databases and require local/CI CREATEDB permission. Browser checks cover the shell, same-origin API and guest-cookie socket authentication. Provider delivery and the full gameplay frontend are separate checks.

Run the M2 tests independently with:

```sh
npm test -- apps/server/test/controller.test.ts apps/server/test/adapters.test.ts apps/server/test/lifecycle-regressions.test.ts apps/server/test/socket.integration.test.ts packages/contracts/test
```

## Production-shaped local start

For this mode, set `BETTER_AUTH_URL=http://localhost:3000` in your local `.env`; verification/reset links must use the same origin as the browser. Restore `http://localhost:5173` when returning to development mode.

```sh
npm run build
npm start
```

One Express/Node process serves the Vite build, HTTP API and Socket.IO on port 3000. Unknown API routes remain JSON errors rather than falling through to the SPA. This is a local startup check, not a deployment.

## Workspace boundaries

| Workspace              | Purpose                                              | Dependencies                                                                                           |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web`             | React/Vite client                                    | React, Socket.IO client and public contracts.                                                          |
| `apps/server`          | Express/Socket.IO host, controller and adapter ports | Better Auth, Drizzle, PostgreSQL driver, Nodemailer, engine and contracts; Socket.IO client for tests. |
| `packages/game-engine` | Native TypeScript engine                             | **Zero runtime dependencies**; pure transitions, validation and scoring.                               |
| `packages/contracts`   | Public transport types and runtime validation        | Zod; command schemas, typed acknowledgements/snapshots and English message catalogs.                   |

One root lockfile records the complete dependency graph. Direct dependency versions are exact; npm validates engine and peer compatibility without `--force` or `--legacy-peer-deps`. The npm cache is stored in ignored `.cache/npm`, avoiding cloud home-directory permissions. Runtime packages are declared in their owning workspace; common developer tools live at the root. The engine has no ambient Node/DOM types and does not import contracts.

Backend third-party declaration checking and the shell-quote override are explained in the environment document. M3 adds `auth` 1.7.7 and Drizzle Kit 0.31.11 for backend generation. Kit also has an identical root developer pin so npm 11 forwards the targeted legacy-helper esbuild 0.28.2 override. The final graph audits clean; no existing package version changed. Details are in the M3 document.

## Design and setup evidence

- [Accepted design](docs/design.md)
- [Game engine API, boundaries and tests](docs/game-engine.md)
- [Backend controller, socket protocol and M3 integration ports](docs/backend-controller.md)
- [Auth adapters and session lifecycle](docs/auth-adapters.md)
- [Implemented M3 auth, storage and HTTP contracts](docs/backend-auth-storage.md)
- [PostgreSQL Docker and migration guide (Hungarian)](docs/database-guide.md)
- [Implementation milestones](docs/implementation-plan.md)
- [Development environment configuration and verification](docs/development-environment.md)
