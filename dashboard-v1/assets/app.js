/* ==========================================================================
   Jacaré Cloud — Console operacional · v1.0
   JavaScript puro (ES5+/ES2017). Sem bibliotecas, sem APIs externas.
   Responsabilidades:
     1. relógio local e UTC;
     2. verificação real de alcance dos serviços (a partir do navegador);
     3. ano do rodapé.
   ========================================================================== */

(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Idioma
     ---------------------------------------------------------------------- */

  var TRADUCOES = {
    'pt-BR': {
      'skip': 'Ir para o conteúdo', 'brand.sub': 'console operacional', 'language.pt': 'Português brasileiro', 'language.en': 'Inglês',
      'clock.local': 'HORA LOCAL', 'clock.utc': 'UTC', 'language.label': 'Idioma',
      'hero.eyebrow': 'Plataforma tecnológica independente', 'hero.title': 'Centro de operações', 'systems.title': 'Sistemas disponíveis',
      'cards.processing': 'PROCESSAMENTO', 'cards.automation': 'AUTOMAÇÃO',
      'cards.tatic.description': 'Aplicação web de processamento de dados do sistema TATIC, mantida como serviço independente nesta infraestrutura.',
      'cards.escala.description': 'Aplicação para automação e consulta de escalas de serviço. O acesso é protegido por autenticação própria do serviço.',
      'cards.dataProcessing': 'Processamento de dados', 'cards.scheduleAutomation': 'Automação de escala', 'cards.webApp': 'Web app',
      'cards.restricted': 'acesso restrito', 'actions.open': 'Abrir aplicação', 'actions.newTab': 'Abrir em nova aba',
      'metar.title': 'Meteorologia — METAR', 'metar.stationNote': 'Jacarepaguá · SBJR',
      'metar.stationName': 'Jacarepaguá — Rio de Janeiro', 'metar.loading': 'consultando',
      'metar.rawObservation': 'Observação bruta', 'metar.waiting': 'aguardando dados…',
      'metar.wind': 'Vento', 'metar.visibility': 'Visibilidade', 'metar.temperature': 'Temperatura',
      'metar.dewPoint': 'Ponto de orvalho', 'metar.qnh': 'QNH', 'metar.conditions': 'Condições',
      'metar.clouds': 'Nebulosidade', 'metar.disclaimerStrong': 'Dados informativos.',
      'metar.disclaimer': 'Observação automática de estação, exibida para acompanhamento. Não substitui as fontes aeronáuticas oficiais nem deve ser usada para decisão operacional de voo. Fonte: Aviation Weather Center (NOAA/NWS).',
      'availability.title': 'Disponibilidade dos serviços', 'availability.refresh': 'Verificar novamente',
      'availability.hint': 'A verificação é feita pelo seu navegador, no momento em que esta página é aberta, por meio de uma requisição direta a cada endereço. O resultado indica apenas se o servidor respondeu à requisição — não atesta a integridade interna das aplicações nem substitui monitoramento contínuo. Nenhum indicador histórico é exibido.',
      'availability.noJs': 'A verificação automática de disponibilidade depende de JavaScript e está desativada neste navegador. Os estados abaixo não foram medidos.',
      'availability.checking': 'verificando', 'availability.lastCheck': 'Última verificação:', 'availability.waiting': 'aguardando',
      'footer.version': 'versão 1.0', 'footer.textBefore': 'O Jacaré Cloud é uma ',
      'footer.independent': 'plataforma tecnológica independente',
      'footer.textAfter': ', de caráter pessoal e experimental, sem vínculo institucional, patrocínio ou representação de quaisquer órgãos, empresas ou entidades públicas ou privadas.',
      'footer.responsibility': 'Uso sob responsabilidade do operador',
      'status.online': 'online', 'status.offline': 'sem resposta', 'status.unsupported': 'não suportado',
      'status.verifying': 'Verificando…', 'status.inProgress': 'em andamento',
      'metar.noData': 'sem observação disponível', 'metar.noFile': 'O arquivo de observação não está disponível no momento.',
      'metar.lastFailed': 'Última tentativa de coleta sem sucesso: {message}.', 'metar.notInformed': 'não informado',
      'metar.notInformedFem': 'não informada', 'metar.calm': 'calmo', 'metar.variable': 'variável',
      'metar.directionUnknown': 'direção não informada', 'metar.gusts': 'rajadas', 'metar.orMore': '10 km ou mais',
      'metar.source': 'fonte', 'metar.noSignificant': 'sem fenômenos significativos', 'metar.nearby': 'nas proximidades',
      'metar.strong': 'forte', 'metar.light': 'leve', 'metar.observedAgo': 'observada há {time}',
      'metar.outdated': 'desatualizada', 'metar.updated': 'atualizada',
      'metar.nightWarning': 'Coleta noturna suspensa (entre 22:06 e 05:59 BRT); a próxima está prevista para 06:20. Exibindo a última observação coletada.',
      'metar.collectionFailed': 'A última tentativa de coleta não foi concluída ({message}). A observação exibida é a última válida.',
      'metar.staleWarning': 'A observação tem {time} e pode não refletir as condições atuais.',
      'metar.loadFailed': 'Não foi possível carregar o arquivo de observação. O coletor pode estar desativado ou a coleta ainda não foi executada.',
      'metar.waitingData': 'aguardando dados…', 'metar.dataDate': 'Observação', 'metar.collectionDate': 'Coleta',
      'metar.lessThanMinute': 'menos de 1 min', 'metar.minutes': 'min', 'metar.hours': 'h',
      'metar.and': 'e', 'metar.with': 'com', 'metar.showers': 'pancadas de', 'metar.thunderstorm': 'trovoada',
      'metar.shallow': 'raso', 'metar.partial': 'parcial', 'metar.broken': 'fragmentado',
      'metar.lifted': 'levantado por vento', 'metar.blowing': 'soprado pelo vento', 'metar.freezing': 'congelante',
      'metar.weather.DZ': 'chuvisco', 'metar.weather.RA': 'chuva', 'metar.weather.SN': 'neve',
      'metar.weather.SG': 'grãos de neve', 'metar.weather.IC': 'cristais de gelo', 'metar.weather.PL': 'pelotas de gelo',
      'metar.weather.GR': 'granizo', 'metar.weather.GS': 'granizo pequeno', 'metar.weather.UP': 'precipitação desconhecida',
      'metar.weather.BR': 'névoa úmida', 'metar.weather.FG': 'nevoeiro', 'metar.weather.FU': 'fumaça',
      'metar.weather.VA': 'cinzas vulcânicas', 'metar.weather.DU': 'poeira', 'metar.weather.SA': 'areia',
      'metar.weather.HZ': 'névoa seca', 'metar.weather.PY': 'borrifo do mar', 'metar.weather.PO': 'redemoinhos de poeira',
      'metar.weather.SQ': 'rajadas fortes', 'metar.weather.FC': 'nuvem funil', 'metar.weather.SS': 'tempestade de areia',
      'metar.weather.DS': 'tempestade de poeira', 'metar.cloud.FEW': 'poucas nuvens',
      'metar.cloud.SCT': 'nuvens dispersas', 'metar.cloud.BKN': 'nublado', 'metar.cloud.OVC': 'encoberto',
      'metar.cloud.VV': 'visibilidade vertical', 'metar.cloud.NSC': 'sem nuvens significativas',
      'metar.cloud.NCD': 'sem nuvens detectadas', 'metar.cloud.SKC': 'céu claro', 'metar.cloud.CLR': 'céu claro'
    },
    'en': {
      'skip': 'Skip to content', 'brand.sub': 'operations console', 'language.pt': 'Brazilian Portuguese', 'language.en': 'English', 'clock.local': 'LOCAL TIME', 'clock.utc': 'UTC', 'language.label': 'Language',
      'hero.eyebrow': 'Independent technology platform', 'hero.title': 'Operations center', 'systems.title': 'Available systems', 'cards.processing': 'PROCESSING', 'cards.automation': 'AUTOMATION',
      'cards.tatic.description': 'Web application for processing TATIC system data, maintained as an independent service on this infrastructure.',
      'cards.escala.description': 'Application for automating and consulting service rosters. Access is protected by the service’s own authentication.',
      'cards.dataProcessing': 'Data processing', 'cards.scheduleAutomation': 'Roster automation', 'cards.webApp': 'Web app', 'cards.restricted': 'restricted access',
      'actions.open': 'Open application', 'actions.newTab': 'Open in new tab', 'metar.title': 'Meteorology — METAR', 'metar.stationNote': 'Jacarepaguá · SBJR',
      'metar.stationName': 'Jacarepaguá — Rio de Janeiro', 'metar.loading': 'loading', 'metar.rawObservation': 'Raw observation', 'metar.waiting': 'waiting for data…',
      'metar.wind': 'Wind', 'metar.visibility': 'Visibility', 'metar.temperature': 'Temperature', 'metar.dewPoint': 'Dew point', 'metar.qnh': 'QNH', 'metar.conditions': 'Conditions', 'metar.clouds': 'Cloud cover',
      'metar.disclaimerStrong': 'Informational data.', 'metar.disclaimer': 'Automatic station observation shown for reference. It does not replace official aeronautical sources and must not be used for operational flight decisions. Source: Aviation Weather Center (NOAA/NWS).',
      'availability.title': 'Service availability', 'availability.refresh': 'Check again', 'availability.hint': 'The check is performed by your browser when this page opens, through a direct request to each address. The result only indicates whether the server responded — it does not attest to the internal integrity of the applications or replace continuous monitoring. No historical indicator is shown.',
      'availability.noJs': 'Automatic availability checking requires JavaScript and is disabled in this browser. The states below were not measured.', 'availability.checking': 'checking', 'availability.lastCheck': 'Last check:', 'availability.waiting': 'waiting',
      'footer.version': 'version 1.0', 'footer.textBefore': 'Jacaré Cloud is an ', 'footer.independent': 'independent technology platform', 'footer.textAfter': ', personal and experimental in nature, with no institutional affiliation, sponsorship, or representation of any public or private bodies, companies, or entities.', 'footer.responsibility': 'Use at the operator’s responsibility',
      'status.online': 'online', 'status.offline': 'no response', 'status.unsupported': 'unsupported', 'status.verifying': 'Checking…', 'status.inProgress': 'in progress',
      'metar.noData': 'no observation available', 'metar.noFile': 'The observation file is not currently available.', 'metar.lastFailed': 'Last collection attempt failed: {message}.', 'metar.notInformed': 'not reported', 'metar.notInformedFem': 'not reported', 'metar.calm': 'calm', 'metar.variable': 'variable', 'metar.directionUnknown': 'direction not reported', 'metar.gusts': 'gusts', 'metar.orMore': '10 km or more', 'metar.source': 'source', 'metar.noSignificant': 'no significant weather', 'metar.nearby': 'nearby', 'metar.strong': 'heavy', 'metar.light': 'light', 'metar.observedAgo': 'observed {time} ago', 'metar.outdated': 'outdated', 'metar.updated': 'updated',
      'metar.nightWarning': 'Night collection suspended (from 22:06 to 05:59 BRT); the next one is scheduled for 06:20. Showing the last collected observation.', 'metar.collectionFailed': 'The last collection attempt was not completed ({message}). The displayed observation is the last valid one.', 'metar.staleWarning': 'The observation is {time} old and may not reflect current conditions.', 'metar.loadFailed': 'Could not load the observation file. The collector may be disabled or collection may not have run yet.', 'metar.waitingData': 'waiting for data…', 'metar.dataDate': 'Observation', 'metar.collectionDate': 'Collection', 'metar.lessThanMinute': 'less than 1 min', 'metar.minutes': 'min', 'metar.hours': 'h', 'metar.and': 'and', 'metar.with': 'with', 'metar.showers': 'showers of', 'metar.thunderstorm': 'thunderstorm', 'metar.shallow': 'shallow', 'metar.partial': 'partial', 'metar.broken': 'broken', 'metar.lifted': 'lifted by wind', 'metar.blowing': 'blowing', 'metar.freezing': 'freezing',
      'metar.weather.DZ': 'drizzle', 'metar.weather.RA': 'rain', 'metar.weather.SN': 'snow', 'metar.weather.SG': 'snow grains', 'metar.weather.IC': 'ice crystals', 'metar.weather.PL': 'ice pellets', 'metar.weather.GR': 'hail', 'metar.weather.GS': 'small hail', 'metar.weather.UP': 'unknown precipitation', 'metar.weather.BR': 'mist', 'metar.weather.FG': 'fog', 'metar.weather.FU': 'smoke', 'metar.weather.VA': 'volcanic ash', 'metar.weather.DU': 'dust', 'metar.weather.SA': 'sand', 'metar.weather.HZ': 'haze', 'metar.weather.PY': 'sea spray', 'metar.weather.PO': 'dust whirls', 'metar.weather.SQ': 'squalls', 'metar.weather.FC': 'funnel cloud', 'metar.weather.SS': 'sandstorm', 'metar.weather.DS': 'duststorm', 'metar.cloud.FEW': 'few clouds', 'metar.cloud.SCT': 'scattered clouds', 'metar.cloud.BKN': 'broken clouds', 'metar.cloud.OVC': 'overcast', 'metar.cloud.VV': 'vertical visibility', 'metar.cloud.NSC': 'no significant clouds', 'metar.cloud.NCD': 'no clouds detected', 'metar.cloud.SKC': 'clear sky', 'metar.cloud.CLR': 'clear sky'
    }
  };

  var idioma = localStorage.getItem('jacare-cloud-language');
  if (idioma !== 'en' && idioma !== 'pt-BR') {
    idioma = /^en(?:-|$)/i.test(navigator.language || '') ? 'en' : 'pt-BR';
  }

  var i18n = {
    get language() { return idioma; },
    t: function (chave, valores) {
      var texto = (TRADUCOES[idioma] && TRADUCOES[idioma][chave]) || TRADUCOES['pt-BR'][chave] || chave;
      return String(texto).replace(/\{(\w+)\}/g, function (_, nome) {
        return valores && valores[nome] !== undefined ? valores[nome] : _;
      });
    },
    apply: function () {
      document.documentElement.lang = idioma;
      document.querySelectorAll('[data-i18n]:not([data-i18n-dynamic])').forEach(function (node) {
        node.textContent = i18n.t(node.getAttribute('data-i18n'));
      });
      var tituloPrefixo = document.getElementById('titulo-prefixo');
      if (tituloPrefixo) { tituloPrefixo.textContent = i18n.t('hero.title'); }
      document.querySelectorAll('.language-button').forEach(function (button) {
        var ativo = button.getAttribute('data-language') === idioma;
        button.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        button.setAttribute('aria-label', i18n.t(button.getAttribute('data-language') === 'en' ? 'language.en' : 'language.pt'));
      });
      var languageGroup = document.querySelector('.language-switcher');
      if (languageGroup) { languageGroup.setAttribute('aria-label', i18n.t('language.label')); }
      document.title = 'Jacaré Cloud — ' + (idioma === 'en' ? 'Operations console' : 'Console operacional');
      var meta = document.getElementById('meta-description');
      if (meta) { meta.content = idioma === 'en' ? 'Single access point for Jacaré Cloud web applications: TATIC Processor and Escala Automate.' : 'Ponto único de acesso às aplicações web da plataforma Jacaré Cloud: TATIC Processor e Escala Automate.'; }
    },
    setLanguage: function (novoIdioma) {
      if (novoIdioma !== 'en' && novoIdioma !== 'pt-BR') { return; }
      idioma = novoIdioma;
      localStorage.setItem('jacare-cloud-language', idioma);
      i18n.apply();
      document.dispatchEvent(new CustomEvent('jacare:languagechange'));
    }
  };
  window.JacareCloudI18n = i18n;
  i18n.apply();
  document.querySelectorAll('.language-button').forEach(function (button) {
    button.addEventListener('click', function () { i18n.setLanguage(button.getAttribute('data-language')); });
  });

  /* ----------------------------------------------------------------------
     1. Relógio
     ---------------------------------------------------------------------- */

  var elLocal = document.getElementById('relogio-local');
  var elUtc = document.getElementById('relogio-utc');

  function atualizarRelogio() {
    var agora = new Date();
    var locale = i18n.language === 'en' ? 'en-GB' : 'pt-BR';
    if (elLocal) { elLocal.textContent = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(agora); }
    if (elUtc) { elUtc.textContent = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' }).format(agora); }
  }

  atualizarRelogio();
  window.setInterval(atualizarRelogio, 1000);

  /* ----------------------------------------------------------------------
     2. Disponibilidade
     A checagem é feita pelo navegador, com requisição direta a cada endereço.
     Resultado possível: "respondeu" (o servidor devolveu uma resposta HTTP,
     qualquer que seja o código) ou "sem resposta" (erro de rede, DNS, TLS ou
     tempo esgotado). Não há inferência sobre a saúde interna da aplicação.
     ---------------------------------------------------------------------- */

  var LIMITE_MS = 10000;
  function textoEstado(estado) {
    return i18n.t(estado === 'espera' ? 'availability.checking' : estado === 'ok' ? 'status.online' : 'status.offline');
  }

  var linhas = Array.prototype.slice.call(
    document.querySelectorAll('.status-row[data-url]')
  );

  function alvoDoChip(linha) {
    return linha.querySelector('[data-campo="estado"]');
  }

  function alvoDaLatencia(linha) {
    return linha.querySelector('[data-campo="latencia"]');
  }

  function pintar(chip, estado) {
    if (!chip) { return; }
    chip.classList.remove('chip-wait', 'chip-ok', 'chip-fail');
    chip.classList.add(estado === 'ok' ? 'chip-ok' : estado === 'falha' ? 'chip-fail' : 'chip-wait');
    chip.textContent = textoEstado(estado);
  }

  document.addEventListener('jacare:languagechange', function () {
    document.querySelectorAll('.chip[data-servico], .status-row [data-campo="estado"]').forEach(function (chip) {
      var estado = chip.classList.contains('chip-ok') ? 'ok' : chip.classList.contains('chip-fail') ? 'falha' : 'espera';
      chip.textContent = textoEstado(estado);
    });
    if (btnReverificar && btnReverificar.getAttribute('aria-busy') === 'true') {
      btnReverificar.textContent = i18n.t('status.verifying');
    }
    if (selHoraVerificacao && (selHoraVerificacao.textContent === 'aguardando' || selHoraVerificacao.textContent === 'waiting')) {
      selHoraVerificacao.textContent = i18n.t('availability.waiting');
    }
  });

  function chipsDoCard(nomeServico, estado) {
    var chips = document.querySelectorAll('.chip[data-servico="' + nomeServico + '"]');
    for (var i = 0; i < chips.length; i += 1) { pintar(chips[i], estado); }
  }

  function verificarLinha(linha) {
    var url = linha.getAttribute('data-url');
    var chip = alvoDoChip(linha);
    var lat = alvoDaLatencia(linha);
    var servico = linha.getAttribute('data-servico') || '';
    var inicio = 0;
    var controlador = null;
    var temporizador = null;

    pintar(chip, 'espera');
    if (lat) { lat.textContent = '—'; }

    if (typeof window.fetch !== 'function') {
      pintar(chip, 'falha');
      if (lat) { lat.textContent = i18n.t('status.unsupported'); }
      return Promise.resolve({ url: url, estado: 'falha' });
    }

    controlador = ('AbortController' in window) ? new AbortController() : null;

    if (controlador) {
      temporizador = window.setTimeout(function () { controlador.abort(); }, LIMITE_MS);
    }

    inicio = (window.performance && performance.now) ? performance.now() : Date.now();

    return window.fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controlador ? controlador.signal : undefined
    }).then(function () {
      var fim = (window.performance && performance.now) ? performance.now() : Date.now();
      pintar(chip, 'ok');
      if (lat) { lat.textContent = Math.round(fim - inicio) + ' ms'; }
      chipsDoCard(servico, 'ok');
      return { url: url, estado: 'ok' };
    }).catch(function () {
      pintar(chip, 'falha');
      if (lat) { lat.textContent = '—'; }
      chipsDoCard(servico, 'falha');
      return { url: url, estado: 'falha' };
    }).then(function (resultado) {
      if (temporizador) { window.clearTimeout(temporizador); }
      return resultado;
    });
  }

  var selHoraVerificacao = document.getElementById('hora-verificacao');
  var btnReverificar = document.getElementById('reverificar');
  var emAndamento = false;

  function carimboDeHora() {
    var agora = new Date();
    var doisDigitos = function (n) { return n < 10 ? '0' + n : String(n); };
    return doisDigitos(agora.getHours()) + ':' +
           doisDigitos(agora.getMinutes()) + ':' +
           doisDigitos(agora.getSeconds());
  }

  function verificarTudo() {
    if (emAndamento) { return; }
    emAndamento = true;

    if (btnReverificar) {
      btnReverificar.disabled = true;
      btnReverificar.setAttribute('aria-busy', 'true');
      btnReverificar.textContent = i18n.t('status.verifying');
    }
    if (selHoraVerificacao) { selHoraVerificacao.textContent = i18n.t('status.inProgress'); }

    var tarefas = [];
    for (var i = 0; i < linhas.length; i += 1) {
      tarefas.push(verificarLinha(linhas[i]));
    }

    Promise.all(tarefas).then(function () {
      if (selHoraVerificacao) { selHoraVerificacao.textContent = carimboDeHora(); }
      emAndamento = false;
      if (btnReverificar) {
        btnReverificar.disabled = false;
        btnReverificar.removeAttribute('aria-busy');
        btnReverificar.textContent = i18n.t('availability.refresh');
      }
    });
  }

  if (btnReverificar) {
    btnReverificar.addEventListener('click', verificarTudo);
  }

  // Primeira verificação após a página ficar visível, para não competir com
  // o carregamento inicial dos recursos da própria página.
  function iniciarVerificacao() {
    if (document.readyState === 'complete') {
      window.setTimeout(verificarTudo, 350);
    } else {
      window.addEventListener('load', function () {
        window.setTimeout(verificarTudo, 350);
      });
    }
  }

  iniciarVerificacao();

  /* ----------------------------------------------------------------------
     3. Rodapé
     ---------------------------------------------------------------------- */

  var elAno = document.getElementById('ano');
  if (elAno) { elAno.textContent = String(new Date().getFullYear()); }
}());
