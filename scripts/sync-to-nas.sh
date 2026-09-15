#!/bin/bash
#
# Pushes the source tree back to the NAS copy.
#
# Development happens on the local SSD because the SMB share is ~900x slower for
# small-file writes (measured: 300 files in 44.6s vs 0.049s), which made npm
# install a two-hour job. The NAS copy is the backup/canonical location; this
# script keeps it current.
#
# Only source is synced. node_modules, build output and the local database are
# excluded — they are large, disposable, and regenerating them is fast.
#
#   ./scripts/sync-to-nas.sh          # show what would change
#   ./scripts/sync-to-nas.sh --go     # actually copy

set -euo pipefail

LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/"
NAS="${EPS_NAS_PATH:-/Volumes/Temporary Workspace/____DEV/Event Photo Share/}"

EXCLUDES=(
  --exclude 'node_modules'
  --exclude 'node_modules.bak.*'
  --exclude 'dist'
  --exclude 'out'
  --exclude 'release'
  --exclude '.DS_Store'
  --exclude '*.sqlite'
  --exclude '*.sqlite-shm'
  --exclude '*.sqlite-wal'
  --exclude '.env'
  --exclude '__TEMP__*'
)

if [ ! -d "$NAS" ]; then
  echo "NAS share is not mounted at:"
  echo "  $NAS"
  echo "Mount it in Finder (Go > Connect to Server) and try again."
  exit 1
fi

if [ "${1:-}" = "--go" ]; then
  echo "Syncing $LOCAL -> $NAS"
  rsync -a --delete "${EXCLUDES[@]}" "$LOCAL" "$NAS"
  echo "Done."
else
  echo "DRY RUN — nothing copied. Re-run with --go to apply."
  echo "  from: $LOCAL"
  echo "  to:   $NAS"
  echo
  rsync -a --delete --dry-run --itemize-changes "${EXCLUDES[@]}" "$LOCAL" "$NAS"
fi
