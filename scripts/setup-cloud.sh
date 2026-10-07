#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "$(node --version)" != "v$(cat .node-version)" ]]; then
  printf '%s\n' 'Activate the Node version recorded in .node-version before setup.' >&2
  exit 1
fi
if [[ "$(npm --version)" != '11.9.0' ]]; then
  printf '%s\n' 'Activate npm 11.9.0 before setup.' >&2
  exit 1
fi
docker info --format '{{.ServerVersion}}'
# This cloud base image supplies Chromium and its system dependencies.
test -x /usr/bin/chromium
npm ci
npm run env:init
docker compose pull postgres
npm run db:up
npm run format:check
npm run check
