#!/usr/bin/env bash

MACOS_METADATA_PATTERN='(^|/)(__MACOSX|\.DS_Store|\._[^/]+)$|(^|/)\._'

strip_splunk_packaging_detritus() {
    local stage_dir="$1"

    rm -rf "${stage_dir}/local"
    find "${stage_dir}" -name "__MACOSX" -type d -prune -exec rm -rf {} +
    find "${stage_dir}" \( -name ".DS_Store" -o -name "._*" \) -delete
    find "${stage_dir}" -name "__pycache__" -type d -prune -exec rm -rf {} +

    # Clear macOS extended attributes from the staging copy so bsdtar
    # cannot emit AppleDouble sidecars for them.
    if command -v xattr >/dev/null 2>&1; then
        xattr -cr "${stage_dir}" 2>/dev/null || true
    fi
}

create_clean_spl_archive() {
    local stage_root="$1"
    local out_file="$2"
    local archive_root="$3"
    local tar_flags="-cf"
    local metadata_entries

    case "${out_file}" in
        *.tar.gz|*.tgz)
            tar_flags="-czf"
            ;;
    esac

    COPYFILE_DISABLE=1 COPY_EXTENDED_ATTRIBUTES_DISABLE=1 \
        tar -C "${stage_root}" ${tar_flags} "${out_file}" "${archive_root}"

    metadata_entries="$(tar -tf "${out_file}" | grep -E "${MACOS_METADATA_PATTERN}" || true)"
    if [ -n "${metadata_entries}" ]; then
        echo "error: macOS metadata leaked into ${out_file}" >&2
        printf '%s\n' "${metadata_entries}" >&2
        return 1
    fi
}