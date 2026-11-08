#!/usr/bin/env bash
# setup-deploy.sh — prepara a VPS para o deploy via GitHub Actions (idempotente).
# Executar como root NA VPS, com jacare-deploy.sh já copiado para /tmp/jacare-deploy.sh.
#
# Cria:
#   usuário jacare-deploy (sem senha, home /srv/jacare-deploy)
#   /srv/jacare-deploy/staging          → área onde o CI despeja o site
#   /usr/local/bin/jacare-deploy.sh     → script de aplicação (root:root 755)
#   /etc/sudoers.d/jacare-deploy        → sudo só para esse script
#   ~jacare-deploy/.ssh/authorized_keys → chave do GitHub Actions
set -euo pipefail

DEPLOY_USER=jacare-deploy
DEPLOY_HOME=/srv/jacare-deploy
STAGING=$DEPLOY_HOME/staging
SCRIPT_SRC=/tmp/jacare-deploy.sh
SCRIPT_DST=/usr/local/bin/jacare-deploy.sh
PUBKEY_FILE=/tmp/gha-deploy.pub

[ "$(id -u)" -eq 0 ] || { echo "rode como root" >&2; exit 1; }
[ -f "$SCRIPT_SRC" ] || { echo "faltou $SCRIPT_SRC" >&2; exit 1; }
[ -f "$PUBKEY_FILE" ] || { echo "faltou $PUBKEY_FILE" >&2; exit 1; }

echo "== usuário"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "  $DEPLOY_USER já existe"
else
  useradd --system --create-home --home-dir "$DEPLOY_HOME" --shell /bin/bash "$DEPLOY_USER"
  echo "  $DEPLOY_USER criado"
fi
passwd -l "$DEPLOY_USER" >/dev/null 2>&1 || true
usermod -d "$DEPLOY_HOME" "$DEPLOY_USER"

echo "== diretórios"
install -d -m 755 -o root -g root "$DEPLOY_HOME"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$STAGING"

echo "== script de deploy"
install -m 755 -o root -g root "$SCRIPT_SRC" "$SCRIPT_DST"
bash -n "$SCRIPT_DST"
echo "  instalado em $SCRIPT_DST"

echo "== sudoers"
printf '%s ALL=(root) NOPASSWD: %s\n' "$DEPLOY_USER" "$SCRIPT_DST" > /etc/sudoers.d/jacare-deploy
chmod 440 /etc/sudoers.d/jacare-deploy
visudo -cf /etc/sudoers.d/jacare-deploy

echo "== chave SSH do CI"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
touch "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
KEY=$(awk '{print $2}' "$PUBKEY_FILE")
if grep -qF "$KEY" "$DEPLOY_HOME/.ssh/authorized_keys"; then
  echo "  chave já autorizada"
else
  { echo "# GitHub Actions — deploy do site jacare.cloud"; cat "$PUBKEY_FILE"; } >> "$DEPLOY_HOME/.ssh/authorized_keys"
  echo "  chave adicionada"
fi

echo "== removendo a chave de deploy do usuário hermes-fedora (sudo total)"
for AK in /home/hermes-fedora/.ssh/authorized_keys; do
  [ -f "$AK" ] || continue
  cp -a "$AK" "$AK.bak-$(date +%Y%m%d-%H%M%S)"
  if grep -qF "$KEY" "$AK"; then
    grep -vF "$KEY" "$AK" > "$AK.new" && cat "$AK.new" > "$AK" && rm -f "$AK.new"
    echo "  removida de $AK"
  else
    echo "  não estava em $AK"
  fi
done

echo "== resumo"
id "$DEPLOY_USER"
sudo -l -U "$DEPLOY_USER"
ls -la "$STAGING"; ls -la "$SCRIPT_DST"
echo "OK"
