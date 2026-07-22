#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd "${script_dir}/.." && pwd)"
bundle_path="${OPENREEL_BRIDGE_BUNDLE_PATH:-${package_dir}/.artifacts/OpenReel Bridge.app}"
scratch_path="${OPENREEL_BRIDGE_SCRATCH_PATH:-/tmp/openreel-resolve-bridge-release}"
module_cache="${OPENREEL_BRIDGE_MODULE_CACHE:-/tmp/openreel-swift-module-cache}"
sdk_root="${OPENREEL_BRIDGE_SDKROOT:-/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk}"

if [[ "$(basename "${bundle_path}")" != "OpenReel Bridge.app" || "$(dirname "${bundle_path}")" == "/" ]]; then
  echo "Refusing unsafe bundle output path: ${bundle_path}" >&2
  exit 2
fi

SDKROOT="${sdk_root}" \
CLANG_MODULE_CACHE_PATH="${module_cache}" \
SWIFTPM_MODULECACHE_OVERRIDE="${module_cache}" \
swift build --disable-sandbox --package-path "${package_dir}" \
  --scratch-path "${scratch_path}" --configuration release --product OpenReelBridgeApp

bin_path="$(SDKROOT="${sdk_root}" CLANG_MODULE_CACHE_PATH="${module_cache}" \
  SWIFTPM_MODULECACHE_OVERRIDE="${module_cache}" swift build --disable-sandbox \
  --package-path "${package_dir}" --scratch-path "${scratch_path}" \
  --configuration release --show-bin-path)"
temporary_root="$(mktemp -d /tmp/openreel-bridge-bundle.XXXXXX)"
trap 'rm -rf "${temporary_root}"' EXIT
staged_bundle="${temporary_root}/OpenReel Bridge.app"
mkdir -p "${staged_bundle}/Contents/MacOS" "${staged_bundle}/Contents/Resources"
cp "${bin_path}/OpenReelBridgeApp" "${staged_bundle}/Contents/MacOS/OpenReelBridge"
chmod 755 "${staged_bundle}/Contents/MacOS/OpenReelBridge"
cp "${package_dir}/Resources/Info.plist" "${staged_bundle}/Contents/Info.plist"

test -x "${staged_bundle}/Contents/MacOS/OpenReelBridge"
/usr/bin/plutil -lint "${staged_bundle}/Contents/Info.plist" >/dev/null
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' \
  "${staged_bundle}/Contents/Info.plist" | /usr/bin/grep -qx openreel-resolve

mkdir -p "$(dirname "${bundle_path}")"
if [[ -e "${bundle_path}" ]]; then rm -rf "${bundle_path}"; fi
mv "${staged_bundle}" "${bundle_path}"
echo "${bundle_path}"
