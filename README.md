# Jacaré Cloud — dashboard operacional

Página pública de https://jacare.cloud: console com os cards de acesso ao
TATIC Processor e ao Escala Automate e verificação real de disponibilidade
feita pelo navegador.

## Estrutura

```
dashboard-v1/          # raiz publicável (é o que vai para /var/www/jacare.cloud)
  index.html
  assets/
    styles.css
    app.js
    favicon.svg
tools/validate.py      # validador local (estrutura, acessibilidade, segurança)
DEPLOY.md              # plano de deploy e rollback
```

## Restrições do projeto

- HTML5, CSS3 e JavaScript puro. Nenhuma biblioteca, fonte remota ou CDN.
- Nenhuma chamada a API externa, rastreador ou credencial no frontend.
- Não altera Nginx, Certbot, firewall, SSH, Docker nem as aplicações TATIC/Escala.
- Nenhum IP, porta administrativa ou métrica privada na interface.

## Desenvolvimento local

```
cd dashboard-v1 && python3 -m http.server 8099 --bind 127.0.0.1
# http://127.0.0.1:8099
```

## Validação

```
python3 tools/validate.py dashboard-v1
node --check dashboard-v1/assets/app.js
```

Validação de layout feita no Chromium em 1440, 1024 e 390 px (sem overflow
horizontal, sem erros de console, alvos de toque com no mínimo 40-44 px).

## Disponibilidade

A seção de disponibilidade mede, no carregamento da página, se cada endereço
responde a uma requisição do próprio navegador. O resultado `respondeu`
significa apenas que o servidor respondeu à requisição — não atesta a saúde
interna das aplicações nem substitui monitoramento contínuo.

## Deploy

Ver `DEPLOY.md`. Deploy só com autorização explícita; backup do `index.html`
anterior é obrigatório antes de qualquer cópia.
