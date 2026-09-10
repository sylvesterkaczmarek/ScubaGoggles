#!/usr/bin/env bash
set -euo pipefail

reqv="${RELEASE_VERSION}"
reqv="${reqv//[[:space:]]/}"
[[ "$reqv" =~ ^[0-9]{1,2}(\.[0-9]{1,2}){2}$ ]] \
  || { echo "invalid request version: $reqv"; exit 1; }
sgv=$(grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' scubagoggles/__init__.py)
[[ "$reqv" == "$sgv" ]] \
  || { echo "version mismatch - current: $sgv"; exit 1; }
./scubagoggles/utils/build.sh -r "$PWD" -t "$GITHUB_REF_NAME"
