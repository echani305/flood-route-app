#!/usr/bin/env bash
# 해커톤 배포용 zip + env.txt 생성 스크립트
# 사용법: npm run build:zip  (또는 bash scripts/build-zip.sh)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DIST_DIR="$ROOT_DIR/dist"
PROJECT_NAME=$(node -p "require('./package.json').name" 2>/dev/null || basename "$ROOT_DIR")
ZIP_NAME="${PROJECT_NAME}.zip"
ENV_SRC="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_OUT_NAME="env.txt"

command -v zip >/dev/null 2>&1 || { echo "❌ zip 명령을 찾을 수 없습니다."; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "❌ rsync 명령을 찾을 수 없습니다."; exit 1; }

STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "▶ 배포 대상 파일 정리 중..."
rsync -a \
  --exclude 'node_modules/' \
  --exclude '.git/' \
  --exclude '.claude/' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  --exclude 'dist/' \
  --exclude '.next/' \
  --exclude '.venv/' \
  --exclude 'venv/' \
  --exclude '*.log' \
  ./ "$STAGE_DIR/"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "▶ zip 생성 중: dist/$ZIP_NAME"
(cd "$STAGE_DIR" && zip -r -q -X "$DIST_DIR/$ZIP_NAME" .)

echo "▶ env.txt 생성 중: dist/$ENV_OUT_NAME"
{
  echo "# 포털 배포 탭 → 환경변수 칸에 아래 이름/값을 각각 넣고 저장하세요."
  echo "# 저장 후 zip을 다시 업로드해야 반영됩니다. PORT는 배포 서버가 관리하므로 넣지 마세요."
  echo ""
  if [ -f "$ENV_SRC" ]; then
    grep -vE '^\s*#|^\s*$' "$ENV_SRC" | grep -vE '^\s*PORT\s*='
  elif [ -f "$ENV_EXAMPLE" ]; then
    echo "# ⚠️ .env 파일이 없어 .env.example 기준으로 생성했습니다. 실제 키 값으로 채워 넣으세요."
    grep -vE '^\s*#|^\s*$' "$ENV_EXAMPLE" | grep -vE '^\s*PORT\s*='
  fi
} > "$DIST_DIR/$ENV_OUT_NAME"

ZIP_SIZE_MB=$(du -m "$DIST_DIR/$ZIP_NAME" | cut -f1)
echo ""
echo "✅ 완료 (dist/$ZIP_NAME: 약 ${ZIP_SIZE_MB}MB / 최대 200MB)"
echo "  - dist/$ZIP_NAME   → 포털 메인 배포 칸에 업로드"
echo "  - dist/$ENV_OUT_NAME → 포털 배포 탭 환경변수 칸에 붙여넣기"
