#!/usr/bin/env bash
# Build the site for GitHub Pages and publish it as the gh-pages branch of a
# repository. Only the built site is pushed: no source code, no docs/.
#
#   scripts/pages/publish.sh <owner>/<repo>
#
# Served at https://<owner>.github.io/<repo>/. Every run replaces the branch
# with fresh history, so old audio doesn't pile up. The site goes up in
# pushes of about 200 MB: one push of the whole ~900 MB times out (HTTP 408).
# REMOTE=<git url> pushes somewhere else instead, e.g. a local test repo.
set -euo pipefail

repo="${1:?usage: publish.sh <owner>/<repo>}"
name="${repo#*/}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/.cache/pages-dist"

cd "$root"
rm -rf "$out"
BASE_PATH="/$name/" OUT_DIR="$out" node_modules/.bin/astro build
python3 scripts/pages/package.py "$out"

cat > "$out/README.md" <<README
# $name

Built site for an HCI pilot study on guiding mood through sound, based on a
fork of [Moodist](https://github.com/remvze/moodist) (MIT).

- App: https://${repo%%/*}.github.io/$name/
- Study sessions: https://${repo%%/*}.github.io/$name/?study
- Route visualiser: https://${repo%%/*}.github.io/$name/?visualise

Third-party sound libraries are included for non-commercial research and
teaching only; see [libraries/CREDITS.txt](libraries/CREDITS.txt) for sources,
citations and licences. Moodist's own sounds are CC0 or Pixabay-licensed.
README

cd "$out"
git init -q -b gh-pages
credential=()
if command -v gh >/dev/null; then
  credential=(-c credential.helper= -c "credential.helper=!gh auth git-credential")
fi
remote="${REMOTE:-https://github.com/$repo.git}"
stamp="$(date -u +%Y-%m-%dT%H:%MZ)"

# 1. the app itself, replacing whatever was published before
git add -A -- . ':(exclude)libraries/*/audio/*'
git commit -qm "Publish $stamp: site"
git "${credential[@]}" push --force "$remote" gh-pages

# 2. library audio, ~200 MB per push
python3 - <<'BATCH'
from pathlib import Path
limit, batch, size, n = 200e6, [], 0, 0
def flush():
    global batch, size, n
    if batch:
        n += 1
        Path(f".git/audio-batch-{n:03d}").write_text("\n".join(batch) + "\n")
    batch, size = [], 0
for f in sorted(Path("libraries").glob("*/audio/*")):
    if size and size + f.stat().st_size > limit:
        flush()
    batch.append(str(f))
    size += f.stat().st_size
flush()
BATCH
batches=(.git/audio-batch-*)
if [ -e "${batches[0]}" ]; then
  for i in "${!batches[@]}"; do
    git add --pathspec-from-file="${batches[$i]}"
    git commit -qm "Publish $stamp: audio $((i + 1))/${#batches[@]}"
    echo "pushing audio $((i + 1))/${#batches[@]}"
    git "${credential[@]}" push "$remote" gh-pages
  done
fi
echo "Published to https://${repo%%/*}.github.io/$name/"
