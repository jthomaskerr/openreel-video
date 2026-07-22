#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd "${script_dir}/.." && pwd)"
source_bundle="${OPENREEL_BRIDGE_BUNDLE_PATH:-${package_dir}/.artifacts/OpenReel Bridge.app}"
user_name="$(/usr/bin/id -un)"
user_home_dir="$(/usr/bin/dscl . -read "/Users/${user_name}" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
apps_dir="${user_home_dir}/Applications"
resolve_scripts_dir="${user_home_dir}/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility"
target_bundle="${apps_dir}/OpenReel Bridge.app"
target_script="${resolve_scripts_dir}/OpenReel Bridge.py"
source_script="${package_dir}/resolve/OpenReelBridge.py"

verify_bundle() {
  local candidate="$1"
  test -x "${candidate}/Contents/MacOS/OpenReelBridge"
  /usr/bin/plutil -lint "${candidate}/Contents/Info.plist" >/dev/null
  /usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' \
    "${candidate}/Contents/Info.plist" | /usr/bin/grep -qx openreel-resolve
}

if ! verify_bundle "${source_bundle}"; then
  echo "Verified OpenReel Bridge bundle not found. Run scripts/build-app.sh first." >&2
  exit 2
fi
if [[ ! -r "${source_script}" ]]; then
  echo "Resolve importer is missing or unreadable: ${source_script}" >&2
  exit 2
fi
/usr/bin/python3 -c 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))' "${source_script}"

if ! mkdir -p "${apps_dir}" "${resolve_scripts_dir}"; then
  echo "Cannot create per-user install directories. Check permissions for ${apps_dir} and Resolve Utility scripts." >&2
  exit 3
fi
stage_root="$(mktemp -d "${apps_dir}/.openreel-bridge-install.XXXXXX")"
trap 'rm -rf "${stage_root}"' EXIT
staged_bundle="${stage_root}/OpenReel Bridge.app"
staged_script="${stage_root}/OpenReel Bridge.py"
/usr/bin/ditto "${source_bundle}" "${staged_bundle}"
cp "${source_script}" "${staged_script}"
verify_bundle "${staged_bundle}"

backup_bundle="${stage_root}/previous.app"
if [[ -e "${target_bundle}" ]]; then mv "${target_bundle}" "${backup_bundle}"; fi
if ! mv "${staged_bundle}" "${target_bundle}"; then
  if [[ -e "${backup_bundle}" ]]; then mv "${backup_bundle}" "${target_bundle}"; fi
  echo "Could not install OpenReel Bridge in ${apps_dir}. Check directory permissions." >&2
  exit 3
fi

script_temp="${resolve_scripts_dir}/.OpenReel Bridge.py.install.$$"
if ! cp "${staged_script}" "${script_temp}" || ! mv "${script_temp}" "${target_script}"; then
  echo "App installed, but Resolve script installation failed. Check permissions for ${resolve_scripts_dir}." >&2
  exit 4
fi
rm -rf "${backup_bundle}"
echo "Installed ${target_bundle}"
echo "Installed ${target_script}"
