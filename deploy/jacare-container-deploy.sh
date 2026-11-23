#!/usr/bin/env bash
# Instalar como root em /usr/local/bin. Recebe somente uma tag SHA hexadecimal.
set -euo pipefail

COMPOSE=/opt/jacare-cloud/compose.prod.yml
IMAGE=ghcr.io/92username/jacare-cloud-dashboard
TAG=${1:-}

[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "tag inválida: esperado SHA completo" >&2; exit 2; }
[ -f "$COMPOSE" ] || { echo "compose ausente: $COMPOSE" >&2; exit 1; }

previous=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' jacare-cloud 2>/dev/null || true)
export JACARE_IMAGE_TAG="$TAG"
docker compose -f "$COMPOSE" pull jacare-cloud
docker compose -f "$COMPOSE" up -d --no-deps jacare-cloud

for attempt in {1..20}; do
  if curl -fsS --max-time 3 http://127.0.0.1:18080/healthz >/dev/null; then
    docker image prune -f --filter 'until=168h' >/dev/null
    echo "deploy ok: $TAG (anterior: ${previous:-desconhecido})"
    exit 0
  fi
  sleep 2
done

echo "health check falhou para $TAG" >&2
if [[ "$previous" =~ ^[0-9a-f]{40}$ ]]; then
  export JACARE_IMAGE_TAG="$previous"
  docker compose -f "$COMPOSE" up -d --no-deps jacare-cloud
  echo "rollback solicitado: $previous" >&2
fi
exit 1
