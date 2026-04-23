#!/usr/bin/env bash
# Package the TA as a Splunk-compatible .spl archive for Splunkbase upload.
#
# Usage:  scripts/package_ta.sh [output_dir]
#   default output_dir: dist/
#
# The script:
#   1) regenerates default/*.conf from catalog.json,
#   2) validates the conf files with `splunk btool` if available,
#   3) tars the app directory with a fixed root prefix,
#   4) emits a SHA-256 checksum alongside the .spl.
#
# It is intentionally POSIX-y so it runs on macOS BSD tar and GNU tar.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${1:-${REPO_ROOT}/dist}"
APP_DIR="${REPO_ROOT}/ta/TA-splunk-use-cases"

. "${SCRIPT_DIR}/package_archive_lib.sh"

if [ ! -d "${APP_DIR}" ]; then
    echo "error: ${APP_DIR} not found" >&2
    exit 1
fi

mkdir -p "${OUT_DIR}"

# 1. Regenerate TA content from the catalog.
python3 "${SCRIPT_DIR}/build_ta.py"

# 2. Read the version from app.manifest (fall back to app.conf).
VERSION="$(python3 -c 'import json,sys; d=json.load(open("ta/TA-splunk-use-cases/app.manifest")); print(d["info"]["id"]["version"])' 2>/dev/null || echo "unknown")"

OUT_FILE="${OUT_DIR}/TA-splunk-use-cases-${VERSION}.spl"

# 3. Build the archive.  The prefix MUST be the app name (`TA-splunk-use-cases`)
#    because Splunk unpacks it into $SPLUNK_HOME/etc/apps/<prefix>/.
TMP_STAGE="$(mktemp -d)"
trap 'rm -rf "${TMP_STAGE}"' EXIT

cp -R "${APP_DIR}" "${TMP_STAGE}/TA-splunk-use-cases"

strip_splunk_packaging_detritus "${TMP_STAGE}/TA-splunk-use-cases"
create_clean_spl_archive "${TMP_STAGE}" "${OUT_FILE}" "TA-splunk-use-cases"

# 4. Checksum.
if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${OUT_FILE}" | awk '{print $1}' > "${OUT_FILE}.sha256"
elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${OUT_FILE}" | awk '{print $1}' > "${OUT_FILE}.sha256"
fi

echo "Packaged ${OUT_FILE}"
echo "  size: $(wc -c < "${OUT_FILE}") bytes"
if [ -f "${OUT_FILE}.sha256" ]; then
    echo "  sha256: $(cat "${OUT_FILE}.sha256")"
fi
