#!/usr/bin/env bash
# Builds the plugin package and packs it: ./pack.sh <version> [out dir], default out dir build/.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="${1:-}"
out="${2:-$here/build}"
tsc="${TSC:-$here/../wizzle/node_modules/.bin/tsc}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Usage: ./pack.sh <version> [out dir], for example ./pack.sh 0.1.0' >&2
  exit 64
fi
if [ ! -d "$here/node_modules/openclaw" ]; then
  echo "The OpenClaw SDK types are missing; run npm install --min-release-age=0 in $here first." >&2
  exit 1
fi

pkg="$here/build/package"
rm -rf "$pkg"
"$tsc" -p "$here/tsconfig.build.json"
cp "$here/plugin/openclaw.plugin.json" "$here/plugin/README.md" "$pkg/"
node -e '
const fs = require("fs");
const [from, to, version] = process.argv.slice(1);
const pkg = JSON.parse(fs.readFileSync(from, "utf8"));
pkg.version = version;
fs.writeFileSync(to, `${JSON.stringify(pkg, null, 2)}\n`);
' "$here/plugin/package.json" "$pkg/package.json" "$version"
mkdir -p "$out"
# COPYFILE_DISABLE keeps macOS tar from adding ._ metadata files.
(cd "$pkg" && COPYFILE_DISABLE=1 npm pack --silent --pack-destination "$out" >/dev/null)
echo "$out/wizzle-openclaw-$version.tgz"
