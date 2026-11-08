#!/usr/bin/env bash
# jacare-deploy.sh — aplica o site estático do Jacaré Cloud a partir da área de staging.
#
# Instalado em /usr/local/bin/jacare-deploy.sh (root:root 755).
# O usuário jacare-deploy pode executá-lo via sudo (sudoers restrito a este caminho),
# então este script NÃO pode aceitar execução de comandos arbitrários.
#
# Uso: jacare-deploy.sh            → aplica /srv/jacare-deploy/staging na raiz web
#      jacare-deploy.sh apply      → idem
#      jacare-deploy.sh rollback   → restaura o backup mais recente
#      jacare-deploy.sh rollback <timestamp|nome-do-backup> → restaura um backup específico
#      jacare-deploy.sh list       → lista backups disponíveis
set -euo pipefail

STAGING=/srv/jacare-deploy/staging
WEBROOT=/var/www/jacare.cloud
BACKUP_PARENT=/var/www
BACKUP_PREFIX=jacare.cloud.bak-
KEEP_BACKUPS=5
DOMAIN=https://jacare.cloud
TMPDIR_DEPLOY=/tmp/jacare-deploy-verify.$$

log()  { printf '[deploy %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { printf '[deploy %s] ERRO: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; exit 1; }
trap 'rm -rf "$TMPDIR_DEPLOY"' EXIT

require_root() { [ "$(id -u)" -eq 0 ] || fail "precisa de root (use sudo)"; }

list_backups() {
  find "$BACKUP_PARENT" -maxdepth 1 -type d -name "${BACKUP_PREFIX}*" -printf '%f\n' | sort
}

# Confere se cada arquivo publicado é byte-a-byte igual ao que está no diretório dado.
verify_published() {
  local src="$1" rel code falhas=0 total=0
  command -v curl >/dev/null || fail "curl não encontrado no servidor"
  mkdir -p "$TMPDIR_DEPLOY"
  while IFS= read -r -d '' f; do
    rel="${f#"$src"/}"
    total=$((total + 1))
    code=$(curl -sS --compressed -o "$TMPDIR_DEPLOY/out" -w '%{http_code}' --max-time 15 "$DOMAIN/$rel" || echo 000)
    if [ "$code" != "200" ]; then
      printf '  FALHA %s → HTTP %s\n' "/$rel" "$code" >&2
      falhas=$((falhas + 1))
    elif ! cmp -s "$f" "$TMPDIR_DEPLOY/out"; then
      printf '  FALHA %s → conteúdo servido difere do arquivo\n' "/$rel" >&2
      falhas=$((falhas + 1))
    else
      printf '  ok    /%s (200, idêntico)\n' "$rel"
    fi
  done < <(find "$src" -type f -print0 | sort -z)
  [ "$total" -gt 0 ] || fail "nenhum arquivo para verificar em $src"
  [ "$falhas" -eq 0 ] || fail "$falhas de $total arquivos não conferem"
  log "verificação pós-deploy: $total/$total arquivos servidos corretamente"
}

apply_perms() {
  chown -R root:root "$WEBROOT"
  find "$WEBROOT" -type d -exec chmod 755 {} +
  find "$WEBROOT" -type f -exec chmod 644 {} +
}

do_apply() {
  require_root
  [ -d "$STAGING" ] || fail "staging ausente: $STAGING"
  [ -f "$STAGING/index.html" ] || fail "staging sem index.html — abortando sem tocar em produção"
  [ -d "$STAGING/assets" ] || fail "staging sem assets/ — abortando sem tocar em produção"
  grep -qi '<!doctype html>' "$STAGING/index.html" || fail "index.html em staging não parece HTML5"
  local js; js=$(find "$STAGING/assets" -maxdepth 1 -name '*.js' | wc -l)
  [ "$js" -ge 1 ] || fail "staging sem JavaScript em assets/ — abortando"

  [ -d "$WEBROOT" ] || fail "raiz web ausente: $WEBROOT"
  local ts backup
  ts=$(date +%Y%m%d-%H%M%S)
  backup="$BACKUP_PARENT/${BACKUP_PREFIX}${ts}"
  log "backup da raiz web → $backup"
  cp -a "$WEBROOT" "$backup"

  log "sincronizando $STAGING → $WEBROOT (preserva data/ e index.html.backup)"
  rsync -a --delete \
        --exclude 'data/' \
        --exclude 'index.html.backup' \
        --exclude '.well-known/' \
        "$STAGING"/ "$WEBROOT"/
  apply_perms

  verify_published "$STAGING"

  # retenção: mantém os N backups mais recentes
  local n=0 b
  while IFS= read -r b; do
    n=$((n + 1))
    if [ "$n" -gt "$KEEP_BACKUPS" ]; then
      log "removendo backup antigo: $b"
      rm -rf "${BACKUP_PARENT:?}/$b"
    fi
  done < <(find "$BACKUP_PARENT" -maxdepth 1 -type d -name "${BACKUP_PREFIX}*" -printf '%f\n' | sort -r)

  log "DEPLOY OK — backup desta execução: $backup"
  log "rollback: sudo /usr/local/bin/jacare-deploy.sh rollback ${ts}"
}

do_rollback() {
  require_root
  local sel="${1:-}" target=""
  if [ -n "$sel" ]; then
    case "$sel" in
      *[!A-Za-z0-9._-]*) fail "identificador de backup inválido" ;;
    esac
    if [ -d "$BACKUP_PARENT/${BACKUP_PREFIX}${sel}" ]; then
      target="$BACKUP_PARENT/${BACKUP_PREFIX}${sel}"
    elif [ -d "$BACKUP_PARENT/$sel" ] && [ "${sel#"$BACKUP_PREFIX"}" != "$sel" ]; then
      target="$BACKUP_PARENT/$sel"
    else
      fail "backup não encontrado: $sel"
    fi
  else
    target=$(find "$BACKUP_PARENT" -maxdepth 1 -type d -name "${BACKUP_PREFIX}*" -printf '%p\n' | sort | tail -1)
    [ -n "$target" ] || fail "nenhum backup encontrado em $BACKUP_PARENT"
  fi
  [ -f "$target/index.html" ] || fail "backup sem index.html: $target"

  log "rollback a partir de $target"
  rsync -a --delete \
        --exclude 'data/' \
        --exclude 'index.html.backup' \
        --exclude '.well-known/' \
        "$target"/ "$WEBROOT"/
  apply_perms
  verify_published "$target"
  log "ROLLBACK OK a partir de $target"
}

case "${1:-apply}" in
  apply)    do_apply ;;
  rollback) do_rollback "${2:-}" ;;
  list)     list_backups ;;
  *)        fail "ação desconhecida: $1 (use apply | rollback [id] | list)" ;;
esac
