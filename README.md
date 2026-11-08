# Jacaré Cloud — dashboard operacional

Página pública do **Jacaré Cloud**: um console web, em tema escuro com inspiração em
interfaces de monitoramento aeronáutico, que reúne o acesso às aplicações da plataforma e
mostra a observação METAR da estação SBJR (Jacarepaguá, Rio de Janeiro).

Publicado em <https://jacare.cloud>.

## O que tem na página

- **Cards dos sistemas** — TATIC Processor e Escala Automate, com descrição e botões de acesso.
- **Meteorologia — METAR** — observação bruta, horário em BRT e UTC, vento, visibilidade,
  temperatura, ponto de orvalho, QNH, condições e nebulosidade.
- **Disponibilidade** — verificação feita pelo navegador no carregamento da página; o
  resultado diz apenas se o endereço respondeu, não atesta a saúde interna das aplicações.
- **Rodapé** — aviso de plataforma tecnológica independente e de dados informativos.

Interface em português brasileiro e inglês, com seletor de idioma. HTML5, CSS3 e
JavaScript puro: sem frameworks, sem bibliotecas, sem fontes remotas, sem rastreadores.

## Estrutura

```
dashboard-v1/          # raiz publicável do site
  index.html
  assets/
    styles.css         # tema, layout responsivo
    app.js             # idioma, relógio, disponibilidade
    metar.js           # render da seção METAR
    favicon.svg
metar/collect.py       # coletor METAR (Python 3, biblioteca padrão)
systemd/               # jacare-metar.service e jacare-metar.timer
tools/validate.py      # validador de HTML (estrutura, acessibilidade, segurança)
docs/deploy.md         # como publicar
```

## Rodar localmente

```
cd dashboard-v1 && python3 -m http.server 8099 --bind 127.0.0.1
```

A seção METAR lê `data/metar.json`. Sem esse arquivo a página mostra o estado "sem dados" —
o que é o comportamento esperado antes da primeira coleta.

## Módulo METAR

O coletor consulta o [Aviation Weather Center](https://aviationweather.gov/) e grava um JSON
com a última observação válida, usando escrita atômica.

```
python3 metar/collect.py --saida dashboard-v1/data/metar.json --estado /tmp/ultima.json
```

Agenda padrão (`systemd/jacare-metar.timer`): a cada 30 minutos, de 06:20 a 21:50, mais uma
coleta às 22:05, no fuso `America/Sao_Paulo`. Não há coleta entre 22:06 e 05:59.

Regras de robustez:

- HTTP 200 não é tratado como observação recente: a idade vem do horário da observação e,
  acima de 90 minutos, a interface marca "desatualizada".
- Falha de rede, JSON inválido ou lista vazia preservam a última observação válida e
  registram o erro no journal, com mensagem neutra no arquivo público.
- O JSON publicado não contém caminho de servidor, host, IP nem stack trace.
- O navegador lê apenas o JSON local; nenhuma API externa é chamada pelo frontend.

Testes, sem rede:

```
python3 metar/collect.py --autoteste
python3 tools/validate.py dashboard-v1
node --check dashboard-v1/assets/app.js
```

## Publicar

Push na `main` publica em <https://jacare.cloud> via GitHub Actions — ver
[docs/ci-cd.md](docs/ci-cd.md). O coletor METAR continua sendo atualizado manualmente no
servidor; a publicação do site não mexe nele. O passo a passo manual de referência (sem CI)
fica em [docs/deploy.md](docs/deploy.md).

## Aviso

Os dados meteorológicos exibidos são **informativos** e não substituem as fontes
aeronáuticas oficiais nem devem ser usados para decisão operacional de voo.

O Jacaré Cloud é uma plataforma tecnológica independente, de caráter pessoal e experimental,
sem vínculo institucional, patrocínio ou representação de quaisquer órgãos, empresas ou
entidades públicas ou privadas.

## Licença

GNU General Public License v3.0 ou posterior — ver [LICENSE](LICENSE).
