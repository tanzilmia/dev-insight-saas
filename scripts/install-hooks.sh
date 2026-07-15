#!/usr/bin/env bash
# Enables the versioned git hooks in .githooks/ (currently: pre-push auto-scan).
# Run once per clone:  ./scripts/install-hooks.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "✓ git hooks enabled (core.hooksPath = .githooks)"
echo "  pre-push → background SonarQube scan (needs Docker + local SonarQube up)."
echo "  Disable with: git config --unset core.hooksPath"
