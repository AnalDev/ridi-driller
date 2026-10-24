#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output="$repo_root/public/ridi-driller-extension.zip"

rm -f "$output"
cd "$repo_root/extension"
zip -q -r "$output" manifest.json README.md icons src
printf 'Created %s\n' "$output"
