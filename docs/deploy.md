# Publicação

Requisitos: servidor web estático (nginx ou equivalente), `systemd` e Python 3.8+ com
`zoneinfo` (biblioteca padrão). Nenhum pacote extra é necessário.

## 1. Site

Copie o conteúdo de `dashboard-v1/` (sem `data/`) para a raiz do site:

```
rsync -a --exclude 'data/' dashboard-v1/ /var/www/exemplo/
chown -R root:root /var/www/exemplo
find /var/www/exemplo -type d -exec chmod 755 {} +
find /var/www/exemplo -type f -exec chmod 644 {} +
```

O server block do nginx precisa apenas apontar `root` para esse diretório.

## 2. Coletor

```
install -d -m 755 /opt/jacare-metar
install -m 755 metar/collect.py /opt/jacare-metar/collect.py
install -d -m 700 /var/lib/jacare-metar
install -d -m 755 /var/www/exemplo/data
```

Os caminhos padrão (`/var/www/jacare.cloud/data/metar.json` e
`/var/lib/jacare-metar/ultima-observacao.json`) podem ser trocados com `--saida` e `--estado`.

## 3. Timer

```
install -m 644 systemd/jacare-metar.service /etc/systemd/system/
install -m 644 systemd/jacare-metar.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jacare-metar.timer
systemctl start jacare-metar.service
journalctl -u jacare-metar -n 20
```

O serviço escreve em `/var/www/exemplo/data` (ajuste `ReadWritePaths` na unit se o caminho
mudar) e roda com `ProtectSystem=strict`, `PrivateTmp`, `NoNewPrivileges` e famílias de
endereço restritas a IPv4/IPv6.

## 4. Conferência

```
curl -I https://exemplo/            # 200
curl -I https://exemplo/data/metar.json
systemctl list-timers jacare-metar.timer
systemd-analyze calendar '*-*-* 06..21:20/30:00'
```

## Rollback

```
systemctl disable --now jacare-metar.timer
rm -f /etc/systemd/system/jacare-metar.service /etc/systemd/system/jacare-metar.timer
systemctl daemon-reload
rm -rf /opt/jacare-metar /var/www/exemplo/data
# restaurar o backup do diretório web
```
