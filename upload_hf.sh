#!/usr/bin/env bash
# Upload the two databases + dataset card to a public Hugging Face dataset repo.
# One-time prerequisite:  hf auth login   (write token from hf.co/settings/tokens)
# Usage:  bash upload_hf.sh [repo-id]     (default: emadjumaah/hadith-kg)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${1:-emadjumaah/hadith-kg}"

hf auth whoami >/dev/null || { echo "run: hf auth login"; exit 1; }
hf repo create "$REPO" --repo-type dataset 2>/dev/null || true
hf upload "$REPO" "$HERE/HF_DATASET_CARD.md" README.md --repo-type dataset
echo "uploading hadith-kg.db (~1.6 GB) ..."
hf upload "$REPO" "$HERE/hadith-kg.db" hadith-kg.db --repo-type dataset
echo "uploading hadith-app.db (~2.9 GB) ..."
hf upload "$REPO" "$HERE/hadith-app.db" hadith-app.db --repo-type dataset
echo "done → https://huggingface.co/datasets/$REPO"
