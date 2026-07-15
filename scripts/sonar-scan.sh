#!/usr/bin/env bash
# One-shot SonarQube scan for DevInsight.
#
#   1. Regenerates apps/api coverage (lcov) unless SKIP_COVERAGE=1.
#   2. Runs the Dockerized sonar-scanner-cli against the local SonarQube CE.
#
# Prereqs:
#   - SonarQube up:  docker compose -f docker-compose.sonar.yml up -d
#   - A project token from http://localhost:9000 (admin -> project 'devinsight'
#     -> Locally -> generate token), exported as SONAR_TOKEN.
#
# Usage:
#   SONAR_TOKEN=sqp_xxx ./scripts/sonar-scan.sh
#   SKIP_COVERAGE=1 SONAR_TOKEN=sqp_xxx ./scripts/sonar-scan.sh   # scan only
#
# On macOS the scanner container reaches the host via host.docker.internal;
# override with SONAR_HOST_URL if SonarQube runs elsewhere.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SONAR_HOST_URL="${SONAR_HOST_URL:-http://host.docker.internal:9000}"

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "ERROR: SONAR_TOKEN is not set. Generate one in the SonarQube UI." >&2
  echo "  http://localhost:9000 -> project 'devinsight' -> Locally -> Generate" >&2
  exit 1
fi

if [[ "${SKIP_COVERAGE:-0}" != "1" ]]; then
  echo "==> Generating apps/api coverage (lcov)…"
  npm run test:coverage -w @devinsight/api
else
  echo "==> Skipping coverage (SKIP_COVERAGE=1)."
fi

echo "==> Running sonar-scanner against ${SONAR_HOST_URL}…"
docker run --rm \
  -e SONAR_HOST_URL="${SONAR_HOST_URL}" \
  -e SONAR_TOKEN="${SONAR_TOKEN}" \
  -v "${REPO_ROOT}:/usr/src" \
  sonarsource/sonar-scanner-cli

echo "==> Done. View results at http://localhost:9000/dashboard?id=devinsight"
