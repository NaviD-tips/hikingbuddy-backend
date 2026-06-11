#!/usr/bin/env bash
# scripts/install-pandoc.sh
# Downloads the pandoc binary into ./bin/pandoc during the Render build phase.
# Idempotent — skips download if already present.

set -e

PANDOC_VERSION="3.5"
PANDOC_DIR="$(pwd)/bin"
PANDOC_BIN="${PANDOC_DIR}/pandoc"

mkdir -p "${PANDOC_DIR}"

if [ -x "${PANDOC_BIN}" ]; then
  echo "✓ pandoc already installed at ${PANDOC_BIN}"
  "${PANDOC_BIN}" --version | head -n 1
  exit 0
fi

echo "Downloading pandoc ${PANDOC_VERSION}..."
TAR="/tmp/pandoc-${PANDOC_VERSION}.tar.gz"
URL="https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz"

curl -fsSL "${URL}" -o "${TAR}"
tar xzf "${TAR}" -C /tmp

mv "/tmp/pandoc-${PANDOC_VERSION}/bin/pandoc" "${PANDOC_BIN}"
chmod +x "${PANDOC_BIN}"

# Cleanup
rm -rf "${TAR}" "/tmp/pandoc-${PANDOC_VERSION}"

echo "✓ pandoc installed at ${PANDOC_BIN}"
"${PANDOC_BIN}" --version | head -n 1