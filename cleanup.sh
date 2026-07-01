#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Removing local Node dependency folders..."
rm -rf "${ROOT_DIR}/node_modules"
rm -rf "${ROOT_DIR}/jordan-cpucontrol/node_modules"

echo "Local cleanup complete."
