#!/usr/bin/env bash
set -euo pipefail

echo "::group::Generated release notes"
cat release-body.md
echo "::endgroup::"
