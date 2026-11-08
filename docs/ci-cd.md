# CI/CD — publicação automática do site

O site em <https://jacare.cloud> é publicado por GitHub Actions a cada push na `main`.
Nada é containerizado: o site é estático e o pipeline copia arquivos.

## Fluxo

```
push na main
  └─ job "Validar site" (ubuntu-latest)
       tools/validate.py dashboard-v1
       node --check app.js + metar.js
       metar/collect.py --autoteste
       falha se dashboard-v1/data/ estiver versionado
  └─ job "Publicar na VPS"  (só se a validação passar)
       rsync dashboard-v1/ → jacare-deploy@VPS:/srv/jacare-deploy/staging/
       ssh 'sudo -n /usr/local/bin/jacare-deploy.sh apply'
       curl https://jacare.cloud/ e compara sha256 do index.html
```

`workflow_dispatch` permite disparar o mesmo pipeline à mão (Actions → Deploy jacare.cloud → Run workflow).

## O que o deploy na VPS faz

`/usr/local/bin/jacare-deploy.sh` (root:root 755, versionado em `deploy/jacare-deploy.sh`):

1. recusa rodar se o staging não tiver `index.html` + `assets/*.js` (produção fica intacta);
2. cria backup `/var/www/jacare.cloud.bak-<timestamp>` (mantém os 5 mais recentes);
3. `rsync -a --delete` do staging para `/var/www/jacare.cloud`, **preservando** `data/`,
   `index.html.backup` e `.well-known/`;
4. `chown root:root`, diretórios 755, arquivos 644;
5. baixa cada arquivo publicado e compara byte a byte com o enviado — falha o passo se divergir.

Ações disponíveis: `apply` (padrão), `rollback [id]`, `list`.

## Rollback

```bash
ssh -i <chave> jacare-deploy@<vps> 'sudo -n /usr/local/bin/jacare-deploy.sh list'
ssh -i <chave> jacare-deploy@<vps> 'sudo -n /usr/local/bin/jacare-deploy.sh rollback 20261108-150253'
```

Sem argumento, restaura o backup mais recente. O rollback também verifica o resultado.

## Segredos do repositório

| Segredo | Valor |
|---|---|
| `VPS_HOST` | IP/host da VPS |
| `VPS_USER` | `jacare-deploy` |
| `VPS_SSH_KEY` | chave privada ed25519 do par `gha-deploy` (a pública está em `~jacare-deploy/.ssh/authorized_keys`) |

## Permissões na VPS

- usuário `jacare-deploy` (sem senha, sem grupo extra) — só escreve em `/srv/jacare-deploy/staging`;
- `/etc/sudoers.d/jacare-deploy` libera **exclusivamente** `NOPASSWD: /usr/local/bin/jacare-deploy.sh`;
- nenhum outro comando roda como root; a raiz web não é gravável pelo usuário;
- a chave do CI foi removida de `hermes-fedora` (que tem sudo total).

Setup reproduzível: `deploy/setup-deploy.sh` (rodar como root na VPS, idempotente).

## O que o pipeline NÃO faz

- não toca em nginx, Certbot, firewall, sshd;
- não toca nos containers do TATIC Processor nem do Escala Automate;
- não publica nem reinicia o coletor METAR (`/opt/jacare-metar`, `jacare-metar.timer`) —
  `metar/` e `systemd/` continuam sendo atualizados manualmente;
- não apaga `dashboard-v1/data/metar.json` em produção.
