# CI/CD — Rust, GHCR e deploy manual

## Build

Todo push na `main` executa `.github/workflows/container.yml`:

1. valida HTML, JavaScript e o coletor METAR;
2. executa `cargo fmt`, `clippy` e testes;
3. constrói a imagem OCI;
4. publica no `ghcr.io/92username/jacare-cloud-dashboard` com as tags `main` e o SHA completo;
5. garante visibilidade pública do pacote.

O build não altera a VPS.

## Produção

O workflow `Deploy manual jacare.cloud` só roda por `workflow_dispatch`. Ele exige o SHA
completo de uma imagem já publicada, conecta com o usuário restrito e executa:

```
sudo -n /usr/local/bin/jacare-container-deploy.sh <sha>
```

O script aceita somente 40 caracteres hexadecimais, baixa a imagem, recria o serviço e aguarda
o health check. Se o health check falhar, tenta restaurar a revisão anterior.

Segredos necessários: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` e `VPS_KNOWN_HOSTS`. Este último
deve conter a linha conhecida e conferida do servidor; não é gerado com `ssh-keyscan` no job.

## Runtime

- container sem root, capabilities removidas e filesystem somente leitura;
- porta interna publicada apenas em `127.0.0.1:18080`;
- SQLite no volume `jacare-traffic`;
- Nginx existente termina TLS e encaminha `/` ao container;
- posições detalhadas são apagadas após 30 dias;
- eventos consolidados permanecem.

Antes do primeiro deploy, instale `compose.prod.yml` em `/opt/jacare-cloud`, o script em
`/usr/local/bin` e ajuste o Nginx. Não remova a raiz estática antiga até o container passar pelo
health check e pela avaliação visual.
