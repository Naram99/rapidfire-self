# M0 development environment

Date: 2026-10-07.

This document retains the M0 setup evidence. Current M1/M2 behavior is documented in [the engine](game-engine.md) and [the backend controller](backend-controller.md); [M3 auth/storage](backend-auth-storage.md) and the [database guide](database-guide.md) describe the later implementation and service configuration. M0 checks alone did not establish those integrations.

The email provider changed to Resend on 2026-10-08. The current adapter uses native Node fetch without an SDK; Nodemailer and its types were removed. The historical Nodemailer versions and checks below describe the M0 graph, not the current dependency graph. See [the Resend guide](email-guide.md) for current configuration.

Authorized scope: repository workspace/configuration scaffolding, dependencies, local services and environment verification. The minimal React and Express/Socket.IO entry points make startup and proxy behavior observable. They contain no auth or game features. Domain schemas, migrations, public protocol definitions, game logic, provider integration and deployment remain later tasks.

## Compatibility decisions

| Component           | Pinned version                       | Compatibility basis                                                                                                                                                                                                     |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / npm          | 24.19.0 / 11.9.0                     | Existing cloud runtime; engines restrict the project to Node 24 and npm 11.                                                                                                                                             |
| TypeScript          | 6.0.3                                | Stable 6.x compiler; consistent compiler for all workspaces.                                                                                                                                                            |
| React / React DOM   | 19.3.0 / 19.3.0                      | Matching versions; supported by Better Auth's React peer range.                                                                                                                                                         |
| Vite / React plugin | 8.3.3 / 6.1.2                        | Plugin requires Vite 8; both accept Node 24.                                                                                                                                                                            |
| Vitest              | 5.0.3                                | Supports Vite 8 and Node 24.                                                                                                                                                                                            |
| Playwright          | 1.63.0                               | Supports Node 24; Chromium is the initial browser target.                                                                                                                                                               |
| Express / Socket.IO | 5.2.1 / 4.8.4                        | Node 24 satisfies runtime engines; client is also Socket.IO 4.8.4.                                                                                                                                                      |
| Better Auth         | 1.7.7                                | Drizzle ORM ^0.45.2 and Drizzle Kit >=0.31.4 peers.                                                                                                                                                                     |
| Drizzle ORM         | 0.45.3                               | Satisfies Better Auth peers; PostgreSQL driver 8.23.1 satisfies ORM/auth ranges.                                                                                                                                        |
| Drizzle Kit         | Deferred until schema/migration work | Better Auth's Kit peer is optional. Current stable Kit 0.31.11 brings legacy esbuild-loader dependencies with audit advisories; it is unnecessary for M0. Recheck a compatible stable version before adding migrations. |
| Zod                 | 4.6.5                                | Compatible with Better Auth's ^4.5.4 requirement; only contracts owns validation.                                                                                                                                       |
| Nodemailer          | 10.0.15                              | Node >=20; dependency reserved for the later SMTP adapter.                                                                                                                                                              |
| PostgreSQL          | 17, digest-pinned Docker image       | Exact image referenced in Compose and CI; a supported production host must offer the same major. Hosting availability is not yet verified.                                                                              |

Package metadata was checked with npm before installation. This verifies declared compatibility; runtime/build checks establish the scaffold's actual behavior. Installing Better Auth/Nodemailer does not verify their future adapters. The lockfile records transitive versions and integrity hashes.

Vite's optional esbuild peer is satisfied explicitly by root developer dependency esbuild 0.28.2. Concurrently 9.2.1 receives a narrowly scoped shell-quote 1.12.0 override because its pinned older 1.x dependency has audit advisories. The override stays within shell-quote's major version and the development-server startup/shutdown and browser checks verify the affected command execution. No `--force` or `--legacy-peer-deps` installation is used. Drizzle Kit is deferred rather than overriding its legacy loader across incompatible esbuild ranges.

The backend alone enables `skipLibCheck`: Drizzle's published declarations reference optional MySQL/Gel drivers and contain upstream declaration errors under strict checking. These unused drivers are not installed for a PostgreSQL-only server. Application and test source remain strictly type-checked, including calls into the libraries; the dependency declarations themselves are not re-validated. The frontend, engine, contracts and tooling retain declaration checking. The PostgreSQL integration check validates the configured driver/ORM behavior directly.

## Reusable setup

Follow the root README. Existing local credentials and configuration must be preserved. Docker volumes retain database data independently of source files; do not assume a cloud snapshot retains running containers or external Docker volumes. Start the service again in each restored environment. An external DATABASE_URL can replace the local container if configured deliberately.

The GitHub workflow runs the same checks with an ephemeral PostgreSQL service and Playwright-managed Chromium. Its result is separate from checks performed in this cloud machine.

Cloud setup is repeatable with `bash scripts/setup-cloud.sh`. It checks the supplied pinned Node/npm, Docker and system Chromium, runs frozen-lockfile installation, preserves local configuration, starts PostgreSQL and runs the scaffold checks. Startup instructions must restart PostgreSQL and the development servers after environment restoration; installation does not preserve processes.

## Verification record

Executed successfully in the current cloud machine:

- `bash scripts/setup-cloud.sh`: frozen `npm ci`, preserved `.env`, digest-pinned PostgreSQL pull/readiness, formatting, type checking, build and the tests below.
- `npm run typecheck`: all four workspaces and tooling passed. Backend dependency-declaration limitation is documented above.
- `npm run build`: engine/contracts declarations, Express server output and Vite production bundle passed.
- `npm test`: **1 integration test passed**, including PostgreSQL 17, parameterized write/read, rollback and temporary-table cleanup.
- `npm run test:e2e`: **2 Chromium tests passed** against the Vite development origin.
- `npm run test:e2e:production`: **2 Chromium tests passed** against a single production-mode Node process serving the compiled React frontend, API and Socket.IO.
- `npm ls --all`: no invalid or missing dependencies. `npm audit`: **0 vulnerabilities** reported at verification time.
- Existing local configuration checksum stayed unchanged across setup; local credentials, dependency cache and build outputs are Git-ignored.
- Runtime import checks passed for Better Auth and its Drizzle adapter. Nodemailer created a message with its in-memory stream transport; no SMTP connection or real email delivery was attempted.
- Generated frontend assets contained none of the configured database/auth/SMTP secret values. The engine package declares zero runtime dependencies.
- Development servers were started again after verification and frontend/API/Socket.IO polling responses were checked.

No game or authentication behavior has been verified. The workflow YAML is configured but has not run on GitHub. The GitHub API returned HTTP 403; native Git access was available. Cloud configuration publication and fresh-task restoration are separate platform operations, not established by these local checks.

## Remaining implementation checks

- Better Auth supported deletion/reset coordination with application transactions.
- Auth schema generation and shared Drizzle migrations after the auth configuration is implemented.
- Actual Resend access, sender/domain configuration and delivery.
- Session renewal/background-tab behavior and guest endpoint details.
- Frontend routing and real protocol/state-machine implementation.
