#!/usr/bin/env bash
# Stage the Docker build context for the llm-proxy image in <dir> (new or empty).
#
# The image must install exactly what the workspace pnpm-lock.yaml pins, the lockfile Dependabot
# maintains (AndyFooBlah/andy-private-docs#57). `pnpm deploy` copies this package and writes a
# pnpm-lock.yaml pruned from the workspace one (it re-resolves nothing); the Dockerfile installs from
# it with --frozen-lockfile. Used by deploy.yml and ci.yml, and by hand:
#   services/llm-proxy/scripts/build-context.sh /tmp/llm-proxy-ctx
#   gcloud run deploy llm-proxy --source /tmp/llm-proxy-ctx ...   (flags in ../README.md)
set -euo pipefail
dir=${1:?usage: build-context.sh <new or empty dir>}
mkdir -p "$dir"; dir=$(cd "$dir" && pwd)
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"

pnpm --filter @wind-spirit/llm-proxy --config.inject-workspace-packages=true deploy "$dir" >/dev/null
rm -rf "$dir/node_modules"

# The same pnpm as the workspace (root package.json packageManager), for the image to install with.
node -e '
  const fs = require("fs"), [root, out] = process.argv.slice(1);
  const pm = JSON.parse(fs.readFileSync(root + "/package.json", "utf8")).packageManager;
  if (!/^pnpm@\d/.test(pm ?? "")) throw new Error("root package.json has no pnpm packageManager");
  const pkg = JSON.parse(fs.readFileSync(out + "/package.json", "utf8"));
  pkg.packageManager = pm.split("+")[0];
  fs.writeFileSync(out + "/package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$root" "$dir"

# Guard: every package in the pruned lockfile is pinned in the workspace lockfile.
keys() { awk '/^packages:/{p=1;next} /^[a-z]/{p=0} p && /^  [^ ]/{sub(/:$/,"");gsub(/\047/,"");print $1}' "$1" | sort -u; }
extra=$(comm -23 <(keys "$dir/pnpm-lock.yaml") <(keys pnpm-lock.yaml))
[ -z "$extra" ] || { echo "pruned lockfile has packages the workspace lockfile does not:" >&2; echo "$extra" >&2; exit 1; }
echo "llm-proxy build context staged in $dir ($(keys "$dir/pnpm-lock.yaml" | wc -l | tr -d ' ') locked packages)"
