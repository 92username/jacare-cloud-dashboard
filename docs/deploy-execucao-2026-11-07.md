# Jacaré Cloud — deploy do dashboard v1.0 + módulo METAR (NÃO EXECUTADO)

Status: **EXECUTADO em 07/11/2026, 22:13 BRT (08/11/2026 01:13 UTC), com autorização do autor.**

Backup criado antes da cópia: `/var/www/jacare.cloud.bak-20261107-221315`
(`index.html.backup` original preservado dentro do diretório web).

Instalado: interface em `/var/www/jacare.cloud` (index + assets + data), coletor em
`/opt/jacare-metar/collect.py`, estado privado em `/var/lib/jacare-metar`,
`jacare-metar.service` e `jacare-metar.timer` em `/etc/systemd/system` (timer habilitado e ativo).
Primeira coleta manual: sucesso, observação de 2026-11-08T00:00:00Z publicada.

## Estado atual de produção (verificado em 07/11/2026)

| Item | Valor verificado |
|---|---|
| Diretório web | `/var/www/jacare.cloud` (root:root, 755) |
| Conteúdo | `index.html` (1.184 B, placeholder) + `index.html.backup` (1.184 B, idêntico) |
| Nginx | `sites-enabled/jacare.cloud.conf` → `sites-available`, `nginx -t` OK |
| Server block | `root /var/www/jacare.cloud`, `try_files $uri $uri/ =404`, TLS Certbot |
| HTTP | `https://jacare.cloud` → 200 |
| Apps | TATIC (`atc-cap-v2-streamlit-app-1`, 200) e Escala (`automate-escala-vigor-*`, 401 Basic Auth) — **não serão tocados** |
| Sistema | Ubuntu 22.04.5, Python 3.10.12, systemd 249, tzdata 2026e |

## Componentes a publicar

| Destino | Origem | Função |
|---|---|---|
| `/var/www/jacare.cloud/index.html` | `dashboard-v1/index.html` | página pública |
| `/var/www/jacare.cloud/assets/*` | `dashboard-v1/assets/*` | CSS, JS (app + metar), favicon |
| `/var/www/jacare.cloud/data/metar.json` | gerado pelo coletor | dado lido pela página |
| `/opt/jacare-metar/collect.py` | `metar/collect.py` | coletor (fora da raiz web) |
| `/var/lib/jacare-metar/` | criado (700) | cópia privada da última observação válida |
| `/etc/systemd/system/jacare-metar.service` | `systemd/jacare-metar.service` | execução da coleta |
| `/etc/systemd/system/jacare-metar.timer` | `systemd/jacare-metar.timer` | agenda 06:20–22:05 BRT |

## Passos propostos (somente após autorização)

1. Backup do diretório web, preservando o backup existente:
   `sudo cp -a /var/www/jacare.cloud /var/www/jacare.cloud.bak-<timestamp>`
2. Publicar a interface: `sudo rsync -a --exclude 'data/' /tmp/jacare-dashboard-v1/ /var/www/jacare.cloud/`
3. Instalar o coletor em `/opt/jacare-metar/collect.py` (root, 755) e criar
   `/var/lib/jacare-metar` (700).
4. Instalar as units em `/etc/systemd/system/`, `systemctl daemon-reload`,
   `systemctl enable --now jacare-metar.timer`.
5. Primeira coleta manual: `systemctl start jacare-metar.service`; conferir
   `journalctl -u jacare-metar -n 20` e `data/metar.json`.
6. Propriedade/permissões: `chown -R root:root /var/www/jacare.cloud`, arquivos 644, diretórios 755.
7. **Nenhum** reload de Nginx, alteração de Certbot, firewall, SSH, Docker ou containers.

## Verificação pós-deploy (real, não presumida)

- `curl -I https://jacare.cloud` → 200; `/assets/styles.css`, `/assets/app.js`,
  `/assets/metar.js` e `/data/metar.json` → 200
- página: cards, seção METAR com a observação do momento, estados de disponibilidade
- layout em 1440 / 1024 / 390 px
- `systemctl list-timers jacare-metar.timer` coerente com a agenda
- `systemd-analyze calendar` das expressões do timer: 33 execuções/dia, 06:20 → 22:05

## Rollback (segundos)

```
sudo systemctl disable --now jacare-metar.timer
sudo rm -f /etc/systemd/system/jacare-metar.service /etc/systemd/system/jacare-metar.timer
sudo systemctl daemon-reload
sudo rm -rf /opt/jacare-metar /var/www/jacare.cloud/data
sudo rsync -a --delete /var/www/jacare.cloud.bak-<timestamp>/ /var/www/jacare.cloud/
```
`index.html.backup` original permanece intacto como segunda via.

## O que NÃO está no deploy

- Nenhuma consulta feita pelo navegador a API externa: o frontend lê apenas `/data/metar.json`.
- Nenhum IP, porta, hostname interno, caminho de servidor, métrica privada ou credencial no frontend.
- Nenhuma alteração em TATIC Processor, Escala Automate, Docker, Nginx, Certbot, firewall ou SSH.
- Nenhum pacote instalado: apenas Python 3 da distribuição e systemd.
