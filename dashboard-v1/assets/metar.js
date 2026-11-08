/* ==========================================================================
   Jacaré Cloud — módulo METAR SBJR · v1.0
   JavaScript puro. Lê apenas o JSON local gerado pelo coletor
   (data/metar.json); não consulta nenhuma API externa pelo navegador.
   ========================================================================== */

(function () {
  'use strict';

  var i18n = window.JacareCloudI18n;
  function t(chave, valores) {
    return i18n ? i18n.t(chave, valores) : chave;
  }

  var ARQUIVO = 'data/metar.json';
  var INTERVALO_MS = 5 * 60 * 1000;      // revalida o arquivo local a cada 5 min
  var LIMIAR_ATRASO_MIN = 90;            // METAR de SBJR é horário
  var FUSO = 'America/Sao_Paulo';

  var el = {};
  [
    'metar-estado', 'metar-idade', 'metar-aviso', 'metar-bruto',
    'metar-obs-brt', 'metar-obs-utc', 'metar-coleta-brt', 'metar-coleta-utc',
    'metar-vento', 'metar-visibilidade', 'metar-temperatura', 'metar-orvalho',
    'metar-qnh', 'metar-condicoes', 'metar-nuvens'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  if (!el['metar-bruto']) { return; }

  /* ---------------------------------------------------------------- tempo */

  function partesBrt(data) {
    var fmt = new Intl.DateTimeFormat(i18n && i18n.language === 'en' ? 'en-GB' : 'pt-BR', {
      timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false
    });
    var partes = fmt.formatToParts(data);
    var valores = {};
    partes.forEach(function (p) { valores[p.type] = p.value; });
    return { hora: parseInt(valores.hour, 10), minuto: parseInt(valores.minute, 10) };
  }

  function formatarBrt(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '—'; }
    return new Intl.DateTimeFormat(i18n && i18n.language === 'en' ? 'en-GB' : 'pt-BR', {
      timeZone: FUSO, day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
  }

  function formatarUtc(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '—'; }
    return new Intl.DateTimeFormat(i18n && i18n.language === 'en' ? 'en-GB' : 'pt-BR', {
      timeZone: 'UTC', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d) + 'Z';
  }

  function emMinutos(segundos) {
    if (segundos < 60) { return t('metar.lessThanMinute'); }
    var min = Math.round(segundos / 60);
    if (min < 60) { return min + ' ' + t('metar.minutes'); }
    var h = Math.floor(min / 60);
    var resto = min % 60;
    return resto ? h + ' ' + t('metar.hours') + ' ' + resto + ' ' + t('metar.minutes') : h + ' ' + t('metar.hours');
  }

  // Suspensão da coleta: de 22:06 (inclusive) até 05:59 (inclusive), em BRT.
  function horarioNoturno() {
    var agora = partesBrt(new Date());
    var minutosDoDia = agora.hora * 60 + agora.minuto;
    return minutosDoDia >= (22 * 60 + 6) || minutosDoDia < (6 * 60);
  }

  /* ----------------------------------------------------------- formatação */

  var numero = new Intl.NumberFormat('pt-BR');

  var CARDINAIS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  function cardinal(graus) {
    if (typeof graus !== 'number' || isNaN(graus)) { return ''; }
    var indice = Math.round(((graus % 360) / 45)) % 8;
    return CARDINAIS[indice];
  }

  function formatarVento(vento) {
    if (!vento || typeof vento.velocidade_kt !== 'number') { return t('metar.notInformed'); }
    if (vento.calmo) { return t('metar.calm'); }

    var direcao;
    if (vento.direcao_variavel) {
      direcao = t('metar.variable');
    } else if (typeof vento.direcao_graus === 'number') {
      var graus = String(vento.direcao_graus).padStart(3, '0');
      var card = cardinal(vento.direcao_graus);
      direcao = graus + '°' + (card ? ' (' + card + ')' : '');
    } else {
      direcao = t('metar.directionUnknown');
    }

    var texto = direcao + ' · ' + vento.velocidade_kt + ' kt';
    if (typeof vento.rajada_kt === 'number') {
      texto += ', ' + t('metar.gusts') + ' ' + vento.rajada_kt + ' kt';
    }
    return texto;
  }

  function formatarVisibilidade(vis) {
    if (!vis) { return t('metar.notInformedFem'); }
    if (vis.cavok) { return 'CAVOK · ' + t('metar.orMore'); }
    if (typeof vis.metros === 'number') {
      if (vis.metros >= 9999 || vis.metros >= 10000) { return t('metar.orMore'); }
      return numero.format(vis.metros) + ' m';
    }
    if (vis.milhas) { return vis.milhas + ' mi (' + t('metar.source') + ')'; }
    return t('metar.notInformedFem');
  }

  var DESCRITORES = {
    MI: 'metar.shallow', PR: 'metar.partial', BC: 'metar.broken', DR: 'metar.lifted',
    BL: 'metar.blowing', SH: 'metar.showers', TS: 'metar.thunderstorm', FZ: 'metar.freezing'
  };

  var FENOMENOS = {
    DZ: 'metar.weather.DZ', RA: 'metar.weather.RA', SN: 'metar.weather.SN', SG: 'metar.weather.SG', IC: 'metar.weather.IC',
    PL: 'metar.weather.PL', GR: 'metar.weather.GR', GS: 'metar.weather.GS', UP: 'metar.weather.UP', BR: 'metar.weather.BR',
    FG: 'metar.weather.FG', FU: 'metar.weather.FU', VA: 'metar.weather.VA', DU: 'metar.weather.DU', SA: 'metar.weather.SA',
    HZ: 'metar.weather.HZ', PY: 'metar.weather.PY', PO: 'metar.weather.PO', SQ: 'metar.weather.SQ', FC: 'metar.weather.FC',
    SS: 'metar.weather.SS', DS: 'metar.weather.DS'
  };

  function traduzirCondicao(codigo) {
    var original = String(codigo || '').trim();
    if (!original) { return ''; }

    var texto = original;
    var intensidade = '';
    if (texto.indexOf('+') === 0) { intensidade = t('metar.strong'); texto = texto.slice(1); }
    else if (texto.indexOf('-') === 0) { intensidade = t('metar.light'); texto = texto.slice(1); }
    else if (texto.indexOf('VC') === 0) { intensidade = t('metar.nearby'); texto = texto.slice(2); }

    var descritores = [];
    var fenomenos = [];
    var resto = texto;
    while (resto.length >= 2) {
      var par = resto.slice(0, 2).toUpperCase();
      if (DESCRITORES[par] && !fenomenos.length) {
        descritores.push(t(DESCRITORES[par]));
      } else if (FENOMENOS[par]) {
        fenomenos.push(t(FENOMENOS[par]));
      } else {
        return original;               // código não reconhecido: mostra como veio
      }
      resto = resto.slice(2);
    }

    var frase;
    if (descritores.indexOf(t('metar.thunderstorm')) !== -1) {
      frase = fenomenos.length ? t('metar.thunderstorm') + ' ' + t('metar.with') + ' ' + fenomenos.join(' ' + t('metar.and') + ' ') : t('metar.thunderstorm');
    } else if (descritores.length && fenomenos.length) {
      frase = descritores.join(' ') + ' ' + fenomenos.join(' ' + t('metar.and') + ' ');
    } else {
      frase = (descritores.join(' ') || fenomenos.join(' ' + t('metar.and') + ' '));
    }

    if (!frase) { return original; }
    if (intensidade && intensidade !== t('metar.nearby')) {
      frase += ' ' + intensidade;
    } else if (intensidade === t('metar.nearby')) {
      frase = t('metar.nearby') + ': ' + frase;
    }
    return frase;
  }

  function formatarCondicoes(codigo) {
    if (!codigo) { return t('metar.noSignificant'); }
    var partes = String(codigo).split(/\s+/).filter(Boolean);
    var traduzidas = partes.map(traduzirCondicao);
    return partes.map(function (bruto, i) {
      return traduzidas[i] && traduzidas[i] !== bruto
        ? bruto + ' · ' + traduzidas[i]
        : bruto;
    }).join('<br>');
  }

  var COBERTURAS = {
    FEW: 'metar.cloud.FEW', SCT: 'metar.cloud.SCT', BKN: 'metar.cloud.BKN', OVC: 'metar.cloud.OVC', VV: 'metar.cloud.VV',
    NSC: 'metar.cloud.NSC', NCD: 'metar.cloud.NCD', SKC: 'metar.cloud.SKC', CLR: 'metar.cloud.CLR'
  };

  function formatarNuvens(nuvens, visibilidade) {
    if (!Array.isArray(nuvens) || !nuvens.length) {
      if (visibilidade && visibilidade.cavok) { return 'CAVOK · ' + t('metar.noSignificant'); }
      return t('metar.notInformedFem');
    }
    var itens = nuvens.map(function (n) {
      var cob = (n && n.cobertura) || '';
      var rotulo = COBERTURAS[cob] ? t(COBERTURAS[cob]) : '';
      var base = (n && typeof n.base_ft === 'number')
        ? numero.format(n.base_ft) + ' ft'
        : '';
      var tipo = (n && n.tipo) ? ' (' + n.tipo + ')' : '';
      var partes = [cob + tipo];
      if (rotulo) { partes.push(rotulo); }
      if (base) { partes.push(base); }
      return partes.join(' · ');
    });
    return itens.join('<br>');
  }

  function temperatura(valor) {
    return (typeof valor === 'number') ? valor + ' °C' : t('metar.notInformedFem');
  }

  /* -------------------------------------------------------------- estados */

  function definirChip(texto, classe) {
    if (!el['metar-estado']) { return; }
    el['metar-estado'].className = 'chip ' + classe;
    el['metar-estado'].textContent = texto;
    var flags = document.querySelector('.metar-flags');
    if (flags) { flags.setAttribute('data-estado', classe); }
  }

  function limpar() {
    ['metar-vento', 'metar-visibilidade', 'metar-temperatura', 'metar-orvalho',
     'metar-qnh', 'metar-condicoes', 'metar-nuvens',
     'metar-obs-brt', 'metar-obs-utc', 'metar-coleta-brt', 'metar-coleta-utc'
    ].forEach(function (id) { if (el[id]) { el[id].textContent = '—'; } });
  }

  function mostrarAviso(texto) {
    if (!el['metar-aviso']) { return; }
    if (!texto) {
      el['metar-aviso'].hidden = true;
      el['metar-aviso'].textContent = '';
      return;
    }
    el['metar-aviso'].hidden = false;
    el['metar-aviso'].textContent = texto;
  }

  function semDados(motivo) {
    limpar();
    if (el['metar-bruto']) { el['metar-bruto'].textContent = t('metar.noData'); }
    if (el['metar-idade']) { el['metar-idade'].textContent = '—'; }
    definirChip(t('metar.noData'), 'chip-fail');
    mostrarAviso(motivo || t('metar.noFile'));
  }

  /* ------------------------------------------------------------- renderiza */

  function renderizar(dados) {
    window.__jacareMetarData = dados;
    var observacao = dados && dados.observacao;
    if (!observacao || !observacao.metar_bruto) {
      var msg = (dados && dados.coleta && dados.coleta.mensagem) || '';
      semDados(msg ? t('metar.lastFailed', { message: msg }) : '');
      return;
    }

    var falhaColeta = dados.coleta && dados.coleta.resultado === 'erro';

    el['metar-bruto'].textContent = observacao.metar_bruto;
    el['metar-vento'].textContent = formatarVento(observacao.vento);
    el['metar-visibilidade'].textContent = formatarVisibilidade(observacao.visibilidade);
    el['metar-temperatura'].textContent = temperatura(observacao.temperatura_c);
    el['metar-orvalho'].textContent = temperatura(observacao.ponto_orvalho_c);
    el['metar-qnh'].textContent = (typeof observacao.qnh_hpa === 'number')
      ? numero.format(observacao.qnh_hpa) + ' hPa' : t('metar.notInformed');
    el['metar-condicoes'].innerHTML = formatarCondicoes(observacao.condicoes);
    el['metar-nuvens'].innerHTML = formatarNuvens(observacao.nuvens, observacao.visibilidade);

    el['metar-obs-brt'].textContent = formatarBrt(observacao.observado_utc);
    el['metar-obs-utc'].textContent = formatarUtc(observacao.observado_utc);
    el['metar-coleta-brt'].textContent = formatarBrt(dados.gerado_em_utc);
    el['metar-coleta-utc'].textContent = formatarUtc(dados.gerado_em_utc);

    // idade da observação, medida agora no navegador
    var idadeTexto = '';
    var segundos = null;
    if (typeof observacao.observado_epoch === 'number') {
      segundos = Math.max(0, Math.floor(Date.now() / 1000) - observacao.observado_epoch);
      idadeTexto = t('metar.observedAgo', { time: emMinutos(segundos) });
    } else if (observacao.observado_utc) {
      var data = new Date(observacao.observado_utc);
      if (!isNaN(data.getTime())) {
        segundos = Math.max(0, Math.floor((Date.now() - data.getTime()) / 1000));
        idadeTexto = t('metar.observedAgo', { time: emMinutos(segundos) });
      }
    }
    if (el['metar-idade']) { el['metar-idade'].textContent = idadeTexto || '—'; }

    var atrasoMin = segundos === null ? null : Math.floor(segundos / 60);

    if (atrasoMin !== null && atrasoMin > LIMIAR_ATRASO_MIN) {
      definirChip(t('metar.outdated'), 'chip-fail');
    } else {
      definirChip(t('metar.updated'), 'chip-ok');
    }

    // avisos: coleta suspensa, falha de coleta, observação atrasada
    var avisos = [];
    if (horarioNoturno()) {
      avisos.push(t('metar.nightWarning'));
    }
    if (falhaColeta) {
      var detalhe = (dados.coleta.mensagem || (i18n && i18n.language === 'en' ? 'collection failure' : 'falha na coleta'));
      avisos.push(t('metar.collectionFailed', { message: detalhe }));
    }
    if (atrasoMin !== null && atrasoMin > LIMIAR_ATRASO_MIN) {
      avisos.push(t('metar.staleWarning', { time: emMinutos(segundos) }));
    }
    mostrarAviso(avisos.join(' '));
  }

  /* --------------------------------------------------------------- coleta */

  var carregando = false;

  function carregar() {
    if (carregando) { return; }
    carregando = true;

    fetch(ARQUIVO, { cache: 'no-store', credentials: 'omit' })
      .then(function (resposta) {
        if (!resposta.ok) { throw new Error('arquivo indisponível'); }
        return resposta.json();
      })
      .then(function (dados) {
        renderizar(dados);
      })
      .catch(function () {
        semDados(t('metar.loadFailed'));
      })
      .then(function () {
        carregando = false;
      });
  }

  carregar();
  window.setInterval(carregar, INTERVALO_MS);

  document.addEventListener('jacare:languagechange', function () {
    if (el['metar-bruto'] && !el['metar-bruto'].textContent.trim()) {
      el['metar-bruto'].textContent = t('metar.waitingData');
    }
    if (window.__jacareMetarData) { renderizar(window.__jacareMetarData); }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { carregar(); }
  });
}());
