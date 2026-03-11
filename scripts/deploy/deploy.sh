#!/usr/bin/env bash
# =============================================================================
# ARGUS — Google Cloud Run Deployment Script
# Usage: ./scripts/deploy/deploy.sh [--project PROJECT_ID] [--region REGION]
# =============================================================================
set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
REGION="${ARGUS_REGION:-us-central1}"
SERVICE_NAME="argus-backend"
IMAGE_REPO="argus"

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "${RED}✗ ERROR:${RESET} $*" >&2; exit 1; }

# ─── Parse flags ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --region)  REGION="$2";     shift 2 ;;
    *)         die "Unknown flag: $1" ;;
  esac
done

# ─── Prerequisites ───────────────────────────────────────────────────────────
command -v gcloud &>/dev/null || die "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"

echo -e "\n${BOLD}ARGUS — Cloud Run Deploy${RESET}\n"

# Resolve project
if [[ -z "${PROJECT_ID:-}" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  [[ -z "$PROJECT_ID" ]] && die "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID\n       or pass --project YOUR_PROJECT_ID"
fi

info "Project : $PROJECT_ID"
info "Region  : $REGION"
info "Service : $SERVICE_NAME"
echo ""

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
AR_HOST="${REGION}-docker.pkg.dev"
IMAGE_URL="${AR_HOST}/${PROJECT_ID}/${IMAGE_REPO}/${SERVICE_NAME}:latest"

# ─── Enable required APIs ────────────────────────────────────────────────────
info "Enabling required GCP APIs (idempotent)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID" --quiet
success "APIs enabled"

# ─── Artifact Registry repo ──────────────────────────────────────────────────
info "Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "$IMAGE_REPO" \
     --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  gcloud artifacts repositories create "$IMAGE_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --quiet
  success "Created Artifact Registry repo: $IMAGE_REPO"
else
  success "Artifact Registry repo already exists"
fi

# ─── GEMINI_API_KEY secret ───────────────────────────────────────────────────
info "Checking GEMINI_API_KEY secret in Secret Manager..."
if ! gcloud secrets describe GEMINI_API_KEY --project="$PROJECT_ID" &>/dev/null; then
  warn "Secret 'GEMINI_API_KEY' not found. Creating it now..."
  read -rsp "  Enter your Gemini API key: " GEMINI_KEY; echo ""
  [[ -z "$GEMINI_KEY" ]] && die "API key cannot be empty"
  printf '%s' "$GEMINI_KEY" | gcloud secrets create GEMINI_API_KEY \
    --data-file=- --project="$PROJECT_ID" --quiet
  success "Secret created"
else
  success "Secret 'GEMINI_API_KEY' already exists"
fi

# Grant Cloud Run's service account access to the secret
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || true   # idempotent, ignore if already bound

# Grant Cloud Build SA access too (needed during --source builds)
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || true

success "IAM bindings set"

# ─── Build & Deploy ──────────────────────────────────────────────────────────
# gcloud run deploy --source does everything:
#   1. Uploads source → Cloud Build builds the Docker image (detects Go via go.mod)
#   2. Pushes image to Artifact Registry
#   3. Deploys new revision to Cloud Run
#
# Flags explained:
#   --session-affinity  WebSocket connections route to the same instance
#   --timeout=3600      Max 1-hour connection (needed for long Live API sessions)
#   --concurrency=80    Connections per instance
#   --cpu=2 --memory=1Gi  Enough headroom for vision + audio processing
#   --min-instances=1   Keep 1 warm instance to avoid cold-start on WS connect

echo ""
info "Building and deploying to Cloud Run (this takes ~2-3 min on first run)..."
echo ""

# Resolve repo root (script lives in scripts/deploy/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

gcloud run deploy "$SERVICE_NAME" \
  --source="$REPO_ROOT" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --image="$IMAGE_URL" \
  --allow-unauthenticated \
  --session-affinity \
  --timeout=3600 \
  --concurrency=80 \
  --cpu=2 \
  --memory=1Gi \
  --min-instances=0 \
  --max-instances=10 \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --set-env-vars="ARGUS_MODULES_DIR=/app/modules" \
  --quiet

# ─── Done ────────────────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --project="$PROJECT_ID" \
  --format="value(status.url)")

echo ""
echo -e "${GREEN}${BOLD}✓ ARGUS deployed successfully${RESET}"
echo -e "  ${BOLD}URL:${RESET} ${SERVICE_URL}"
echo -e "  ${BOLD}WSS:${RESET} ${SERVICE_URL/https/wss}/ws"
echo -e "  ${BOLD}Health:${RESET} ${SERVICE_URL}/api/v1/health"
echo ""
echo -e "${YELLOW}Set this in your frontend .env:${RESET}"
echo -e "  NEXT_PUBLIC_WS_URL=${SERVICE_URL/https/wss}/ws"
echo ""
