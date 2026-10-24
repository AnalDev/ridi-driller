#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output="$repo_root/public/ridi-driller-extension.zip"

rm -f "$output"
cd "$repo_root/extension"
find manifest.json README.md icons src -type f -print \
  | LC_ALL=C sort \
  | zip -q -X "$output" -@
printf 'Created %s\n' "$output"
