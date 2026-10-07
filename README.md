# Rapidfire

Self-hosted realtime quiz system. This repository contains the M0 development scaffold, M1 standalone game engine and M2 backend controller/public Socket.IO protocol. Real authentication, persistent game storage, email delivery and the gameplay frontend are later milestones.

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
npm run check
```

`env:init` creates an ignored, owner-readable `.env` with random local database credentials, preserving an existing file. It automatically selects system Chromium when available. Keep `POSTGRES_PASSWORD` and the password portion of `DATABASE_URL` consistent if you edit the local configuration. Other database ports require updating both `POSTGRES_PORT` and `DATABASE_URL`. Auth and SMTP credentials are not required for M0.

`db:up` waits for PostgreSQL readiness. Database data lives in a named Docker volume. `npm run db:stop` stops the database without deleting data. The development database listens on loopback only.

## Development

```sh
npm run dev
```

Vite serves the frontend on port 5173 and proxies `/api` and `/socket.io` (including WebSocket upgrades) to Express on port 3000. The browser uses one origin. `/api/health` reports process availability; it is not a database or authentication readiness check. The browser page is an empty application shell with the Rapidfire heading. Game namespace connections require protocol version 1 and a trusted server-side auth adapter; the default bootstrap rejects them until the M3 adapter is implemented. Server integration tests inject their own verified test credentials.

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

The Vitest suite verifies engine and M2 game behavior. Browser checks still cover the environment shell, API and Engine.IO transport. Real Better Auth and persistent game storage are not implemented or verified; no application migrations or persistent domain tables are created by the database integration test.

Run the M2 tests independently with:

```sh
npm test -- apps/server/test/controller.test.ts apps/server/test/adapters.test.ts apps/server/test/lifecycle-regressions.test.ts apps/server/test/socket.integration.test.ts packages/contracts/test
```

## Production-shaped local start

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

Backend third-party declaration checking and the targeted shell-quote security override are explained in the environment document. Drizzle Kit will be selected when schema/migration work begins, after rechecking its dependencies.

## Design and setup evidence

- [Accepted design](docs/design.md)
- [Game engine API, boundaries and tests](docs/game-engine.md)
- [Backend controller, socket protocol and M3 integration ports](docs/backend-controller.md)
- [Auth adapters and session lifecycle](docs/auth-adapters.md)
- [Implementation milestones](docs/implementation-plan.md)
- [Development environment configuration and verification](docs/development-environment.md)
