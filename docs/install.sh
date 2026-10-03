#!/usr/bin/env bash
# The LLM Gateway installer moved to #
# This shim keeps old `curl ... github.io ... | bash` one-liners working.
set -euo pipefail
exec bash -c "$(curl -fsSL #)"
