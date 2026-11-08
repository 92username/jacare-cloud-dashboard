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
    metar.js
    favicon.svg
  data/                # gerado pelo coletor (fora do versionamento)
metar/collect.py       # coletor METAR SBJR (Python 3, biblioteca padrão)
systemd/               # jacare-metar.service e jacare-metar.timer
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

## Meteorologia — METAR SBJR

O coletor (`metar/collect.py`) consulta o Aviation Weather Center a cada 30 minutos,
de 06:20 a 21:50, mais uma coleta às 22:05 (BRT). Não há coleta entre 22:06 e 05:59.
Grava `dashboard-v1/data/metar.json` com escrita atômica (arquivo temporário + `os.replace`
+ `fsync`), preservando a última observação válida em `/var/lib/jacare-metar/`.

Regras implementadas:

- HTTP 200 não é tratado como observação recente: a idade é calculada a partir do
  horário da observação e a interface marca "desatualizada" acima de 90 minutos.
- Falha de rede, JSON inválido ou lista vazia preservam a observação anterior e
  registram o erro no journal (`journalctl -u jacare-metar`), com mensagem neutra no JSON.
- O JSON público contém apenas dado meteorológico: sem caminho, host, IP ou stack trace.
- O navegador lê somente o JSON local; nenhuma API externa é chamada pelo frontend.

Estados exibidos na página: `atualizada`, `desatualizada`, `sem dados`, além do aviso de
coleta noturna suspensa e do aviso de falha na última coleta.

Testes, sem rede: `python3 metar/collect.py --autoteste` (34 verificações: análise do METAR
bruto, CAVOK, vento calmo/variável/com rajada, QNH, nebulosidade, escrita atômica,
preservação em falha, ausência de dado interno no JSON).

## Deploy

Ver `DEPLOY.md`. Deploy só com autorização explícita; backup do `index.html`
anterior é obrigatório antes de qualquer cópia.
