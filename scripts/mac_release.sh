#!/usr/bin/env bash
# The Mac part of a release: both Macs (Apple Silicon and Intel), signed for
# the in-app updater, built on this Mac and uploaded to the release's draft.
#
#   scripts/mac_release.sh vN [checkout]
#
# Push the tag first (git tag vN && git push origin vN): release.yml then
# creates the draft and builds Windows and Linux. Run this while it does:
# the draft is published only once Windows and Linux are done, and
# latest.json is written then from every signed bundle on the draft, so the
# Mac ones must be there by then (the Intel one as kTeX_x64.app.tar.gz,
# Apple Silicon as kTeX_aarch64.app.tar.gz).
#
# The build runs in a clean checkout of the repository (default
# ../ktex-v405, next to this one), on the tag, with the updater key from
# ~/.tauri/khervetex-react.key (no password).
set -euo pipefail

TAG=${1:?usage: scripts/mac_release.sh vN [checkout]}
HERE=$(cd "$(dirname "$0")/.." && pwd)
CHECKOUT=${2:-$HERE/../ktex-v405}
REPO=gkerherve/KherveTeX-React
KEY=$HOME/.tauri/khervetex-react.key
OUT=$(mktemp -d -t ktex-mac-XXXX)

test -f "$KEY" || { echo "no updater key at $KEY" >&2; exit 1; }
export PATH=$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.cargo/bin:$PATH
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

cd "$CHECKOUT"
git fetch -q origin --tags
git checkout -q "$TAG"
VERSION=$(node -p "require('./package.json').version")
[ "v${VERSION%%.*}" = "$TAG" ] || { echo "package.json is $VERSION, not $TAG" >&2; exit 1; }
npm ci --legacy-peer-deps >/dev/null 2>&1

for arch in aarch64 x86_64; do
  echo "== building for $arch"
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
    npx tauri build --target "$arch-apple-darwin" > "$OUT/build-$arch.log" 2>&1 \
    || { tail -20 "$OUT/build-$arch.log"; exit 1; }
  B=src-tauri/target/$arch-apple-darwin/release/bundle
  short=$([ "$arch" = x86_64 ] && echo x64 || echo aarch64)
  for f in "$B"/macos/kTeX.app/Contents/MacOS/*; do
    lipo -archs "$f" | grep -qw "$arch" || { echo "$f is not $arch" >&2; exit 1; }
  done
  cp "$B/dmg/kTeX_${VERSION}_${short}.dmg" "$OUT/"
  (cd "$OUT" && shasum -a 256 "kTeX_${VERSION}_${short}.dmg" > "kTeX_${VERSION}_${short}.dmg.sha256")
  cp "$B/macos/kTeX.app.tar.gz" "$OUT/kTeX_${short}.app.tar.gz"
  cp "$B/macos/kTeX.app.tar.gz.sig" "$OUT/kTeX_${short}.app.tar.gz.sig"
done

# The draft has no tag URL yet: upload by its id.
ID=$(gh api "repos/$REPO/releases" --paginate --jq ".[] | select(.tag_name == \"$TAG\") | .id" | head -1)
[ -n "$ID" ] || { echo "no release for $TAG yet: push the tag and wait for its draft" >&2; exit 1; }
DRAFT=$(gh api "repos/$REPO/releases/$ID" --jq .draft)
[ "$DRAFT" = true ] || echo "warning: $TAG is already published; latest.json must then be written again (scripts/latest_json.mjs)" >&2
for f in "$OUT"/*.dmg "$OUT"/*.sha256 "$OUT"/*.app.tar.gz "$OUT"/*.app.tar.gz.sig; do
  gh api --method POST -H "Content-Type: application/octet-stream" --input "$f" \
    "https://uploads.github.com/repos/$REPO/releases/$ID/assets?name=$(basename "$f")" --jq .name
done
echo "Mac builds for $TAG uploaded (from $OUT)"
