#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_HOME="${COWD_CONFIG_HOME:-$HOME/.cowd}"
INSTALL_ROOT="${COWD_INSTALL_DIR:-$CONFIG_HOME/bin}"
BUILD=1

usage() {
  cat <<'EOF'
Usage: ./install.sh [--no-build]

Builds and installs Cowd Edge connectors plus the WebUI below the one
canonical user installation root:

  ~/.cowd/bin/edge/*
  ~/.cowd/bin/connectors/*
  ~/.cowd/bin/webui/*

Environment:
  COWD_CONFIG_HOME  Cowd home, default ~/.cowd
  COWD_INSTALL_DIR  canonical install root, default ~/.cowd/bin
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$BUILD" == "1" ]]; then
  (cd "$ROOT" && npm run build)
fi

WEBUI_DIST="$ROOT/surfaces/webui/dist"
if [[ ! -f "$WEBUI_DIST/index.html" ]]; then
  echo "missing built WebUI: $WEBUI_DIST/index.html" >&2
  exit 1
fi

EDGE_BINARIES=(
  cowd-edge-bitable-source
  cowd-edge-email-message
  cowd-edge-open-platform-message
  cowd-edge-sql-source
  cowd-edge-wechat-ilink-message
  cowd-edge-wecom-message
)
for binary in "${EDGE_BINARIES[@]}"; do
  if [[ ! -x "$ROOT/target/release/$binary" ]]; then
    echo "missing built Edge binary: $ROOT/target/release/$binary" >&2
    exit 1
  fi
done

mkdir -p "$INSTALL_ROOT"
STAGE="$(mktemp -d "$INSTALL_ROOT/.cowd-edge.install.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$STAGE/edge" "$STAGE/connectors/message" "$STAGE/connectors/source"
for binary in "${EDGE_BINARIES[@]}"; do
  install -m 0755 "$ROOT/target/release/$binary" "$STAGE/edge/$binary"
done

for manifest in "$ROOT"/connectors/message/*/surface.json; do
  connector="$(basename "$(dirname "$manifest")")"
  mkdir -p "$STAGE/connectors/message/$connector"
  install -m 0644 "$manifest" "$STAGE/connectors/message/$connector/surface.json"
done
for manifest in "$ROOT"/connectors/source/*/surface.json; do
  connector="$(basename "$(dirname "$manifest")")"
  mkdir -p "$STAGE/connectors/source/$connector"
  install -m 0644 "$manifest" "$STAGE/connectors/source/$connector/surface.json"
done

mkdir -p "$STAGE/webui"
install -m 0644 "$ROOT/surfaces/webui/surface.json" "$STAGE/webui/surface.json"
cp -a "$WEBUI_DIST" "$STAGE/webui/dist"

replace_tree() {
  local source="$1"
  local target="$2"
  local backup="${target}.previous.$$"
  mkdir -p "$(dirname "$target")"
  rm -rf "$backup"
  if [[ -e "$target" ]]; then mv "$target" "$backup"; fi
  if ! mv "$source" "$target"; then
    if [[ -e "$backup" ]]; then mv "$backup" "$target"; fi
    return 1
  fi
  rm -rf "$backup"
}

replace_tree "$STAGE/edge" "$INSTALL_ROOT/edge"
replace_tree "$STAGE/connectors" "$INSTALL_ROOT/connectors"
replace_tree "$STAGE/webui" "$INSTALL_ROOT/webui"

cat >"$INSTALL_ROOT/edge-install.json" <<EOF
{
  "schema_version": 1,
  "install_root": "$INSTALL_ROOT",
  "source_root": "$ROOT",
  "webui": "$INSTALL_ROOT/webui/dist",
  "installed_at": "$(date -Iseconds)"
}
EOF

trap - EXIT
rm -rf "$STAGE"
printf 'installed Cowd Edge and WebUI below: %s\n' "$INSTALL_ROOT"
