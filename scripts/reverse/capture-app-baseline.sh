#!/bin/zsh
set -euo pipefail

app_path="${1:-/Applications/ChatGPT.app}"
if [[ ! -d "$app_path" ]]; then
  print -u2 "Application not found: $app_path"
  exit 1
fi

plist="$app_path/Contents/Info.plist"
executable="$app_path/Contents/MacOS/ChatGPT"
asar="$app_path/Contents/Resources/app.asar"

for required_path in "$plist" "$executable" "$asar"; do
  if [[ ! -f "$required_path" ]]; then
    print -u2 "Expected bundle artifact not found: $required_path"
    exit 1
  fi
done

bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$plist")"
marketing_version="$(plutil -extract CFBundleShortVersionString raw -o - "$plist")"
build_version="$(plutil -extract CFBundleVersion raw -o - "$plist")"
executable_sha="$(shasum -a 256 "$executable" | awk '{print $1}')"
asar_sha="$(shasum -a 256 "$asar" | awk '{print $1}')"
asar_size="$(stat -f '%z' "$asar")"

jq -n \
  --arg capturedAt "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg appPath "$app_path" \
  --arg bundleIdentifier "$bundle_id" \
  --arg marketingVersion "$marketing_version" \
  --arg buildVersion "$build_version" \
  --arg executableSha256 "$executable_sha" \
  --arg asarSha256 "$asar_sha" \
  --argjson asarSizeBytes "$asar_size" \
  '{
    capturedAt: $capturedAt,
    application: {
      path: $appPath,
      bundleIdentifier: $bundleIdentifier,
      marketingVersion: $marketingVersion,
      buildVersion: $buildVersion,
      artifacts: {
        executable: { relativePath: "Contents/MacOS/ChatGPT", sha256: $executableSha256 },
        asar: {
          relativePath: "Contents/Resources/app.asar",
          sizeBytes: $asarSizeBytes,
          sha256: $asarSha256
        }
      }
    }
  }'
