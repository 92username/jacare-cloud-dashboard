# Jacaré Cloud — Dashboard v1.0 · plano de deploy (NÃO EXECUTADO)

Status: **aguardando autorização explícita do usuário.**
Build validado localmente e staged em `/tmp/jacare-dashboard-v1` (VPS), fora do diretório web.

## Estado atual de produção (verificado em 07/11/2026)

| Item | Valor verificado |
|---|---|
| Diretório web | `/var/www/jacare.cloud` (root:root, 755) |
| Conteúdo | `index.html` (1184 B, placeholder) + `index.html.backup` (1184 B, idêntico) |
| Nginx | `sites-enabled/jacare.cloud.conf` → `sites-available`, `nginx -t` OK |
| Server block | `root /var/www/jacare.cloud`, `try_files $uri $uri/ =404`, TLS Certbot |
| HTTP | `https://jacare.cloud` → 200 |
| Apps | TATIC (container `atc-cap-v2-streamlit-app-1`, 200) e Escala (`automate-escala-vigor-*`, 401 por Basic Auth) — **não serão tocados** |

## Passos propostos (somente após autorização)

1. Backup com data, preservando o backup existente:
   `sudo cp -a /var/www/jacare.cloud/index.html /var/www/jacare.cloud/index.html.bak-<timestamp>`
2. Copiar o build staged para o diretório web (sem tocar em configs):
   `sudo rsync -a --exclude 'index.html.bak-*' /tmp/jacare-dashboard-v1/ /var/www/jacare.cloud/`
3. Ajustar propriedade e permissões: `sudo chown -R root:root /var/www/jacare.cloud`, arquivos 644, diretórios 755.
4. **Nenhum** reload de Nginx, alteração de Certbot, firewall, SSH, Docker ou containers.
5. Verificação pós-deploy (real, não presumida):
   - `curl -I https://jacare.cloud` → 200
   - `curl -I https://jacare.cloud/assets/styles.css` e `/assets/app.js` → 200
   - abrir `https://jacare.cloud` e conferir os 3 estados de disponibilidade e os 4 links
   - conferir layout em 1440 / 1024 / 390 px

## Rollback (segundos, sem downtime de configuração)

```
sudo cp -a /var/www/jacare.cloud/index.html.bak-<timestamp> /var/www/jacare.cloud/index.html
```
`index.html.backup` original permanece intacto como segunda via.

## O que NÃO está no deploy

- Nenhuma chamada a API externa, CDN, fonte remota ou rastreamento.
- Nenhum IP, porta, hostname interno, métrica privada ou credencial no frontend.
- Nenhuma alteração em TATIC Processor, Escala Automate, Docker, Nginx, Certbot, firewall ou SSH.
