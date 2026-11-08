/* ==========================================================================
   Jacaré Cloud — módulo METAR SBJR · v1.0
   JavaScript puro. Lê apenas o JSON local gerado pelo coletor
   (data/metar.json); não consulta nenhuma API externa pelo navegador.
   ========================================================================== */

(function () {
  'use strict';

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
    var fmt = new Intl.DateTimeFormat('pt-BR', {
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
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO, day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
  }

  function formatarUtc(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '—'; }
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d) + 'Z';
  }

  function emMinutos(segundos) {
    if (segundos < 60) { return 'menos de 1 min'; }
    var min = Math.round(segundos / 60);
    if (min < 60) { return min + ' min'; }
    var h = Math.floor(min / 60);
    var resto = min % 60;
    return resto ? h + ' h ' + resto + ' min' : h + ' h';
  }

  // Suspensão da coleta: de 22:06 (inclusive) até 05:59 (inclusive), em BRT.
  function horarioNoturno() {
    var agora = partesBrt(new Date());
    var minutosDoDia = agora.hora * 60 + agora.minuto;
    return minutosDoDia >= (22 * 60 + 6) || minutosDoDia < (6 * 60);
  }

  /* ----------------------------------------------------------- formatação */

  var numero = new Intl.NumberFormat('pt-BR');

  var CARDINAIS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

  function cardinal(graus) {
    if (typeof graus !== 'number' || isNaN(graus)) { return ''; }
    var indice = Math.round(((graus % 360) / 45)) % 8;
    return CARDINAIS[indice];
  }

  function formatarVento(vento) {
    if (!vento || typeof vento.velocidade_kt !== 'number') { return 'não informado'; }
    if (vento.calmo) { return 'calmo'; }

    var direcao;
    if (vento.direcao_variavel) {
      direcao = 'variável';
    } else if (typeof vento.direcao_graus === 'number') {
      var graus = String(vento.direcao_graus).padStart(3, '0');
      var card = cardinal(vento.direcao_graus);
      direcao = graus + '°' + (card ? ' (' + card + ')' : '');
    } else {
      direcao = 'direção não informada';
    }

    var texto = direcao + ' · ' + vento.velocidade_kt + ' kt';
    if (typeof vento.rajada_kt === 'number') {
      texto += ', rajadas ' + vento.rajada_kt + ' kt';
    }
    return texto;
  }

  function formatarVisibilidade(vis) {
    if (!vis) { return 'não informada'; }
    if (vis.cavok) { return 'CAVOK · 10 km ou mais' }
    if (typeof vis.metros === 'number') {
      if (vis.metros >= 9999 || vis.metros >= 10000) { return '10 km ou mais'; }
      return numero.format(vis.metros) + ' m';
    }
    if (vis.milhas) { return vis.milhas + ' mi (fonte)'; }
    return 'não informada';
  }

  var DESCRITORES = {
    MI: 'raso', PR: 'parcial', BC: 'fragmentado', DR: 'levantado por vento',
    BL: 'soprado pelo vento', SH: 'pancadas de', TS: 'trovoada', FZ: 'congelante'
  };

  var FENOMENOS = {
    DZ: 'chuvisco', RA: 'chuva', SN: 'neve', SG: 'grãos de neve', IC: 'cristais de gelo',
    PL: 'pelotas de gelo', GR: 'granizo', GS: 'granizo pequeno', UP: 'precipitação desconhecida',
    BR: 'névoa úmida', FG: 'nevoeiro', FU: 'fumaça', VA: 'cinzas vulcânicas',
    DU: 'poeira', SA: 'areia', HZ: 'névoa seca', PY: 'borrifo do mar',
    PO: 'redemoinhos de poeira', SQ: 'rajadas fortes', FC: 'nuvem funil',
    SS: 'tempestade de areia', DS: 'tempestade de poeira'
  };

  function traduzirCondicao(codigo) {
    var original = String(codigo || '').trim();
    if (!original) { return ''; }

    var texto = original;
    var intensidade = '';
    if (texto.indexOf('+') === 0) { intensidade = 'forte'; texto = texto.slice(1); }
    else if (texto.indexOf('-') === 0) { intensidade = 'leve'; texto = texto.slice(1); }
    else if (texto.indexOf('VC') === 0) { intensidade = 'nas proximidades'; texto = texto.slice(2); }

    var descritores = [];
    var fenomenos = [];
    var resto = texto;
    while (resto.length >= 2) {
      var par = resto.slice(0, 2).toUpperCase();
      if (DESCRITORES[par] && !fenomenos.length) {
        descritores.push(DESCRITORES[par]);
      } else if (FENOMENOS[par]) {
        fenomenos.push(FENOMENOS[par]);
      } else {
        return original;               // código não reconhecido: mostra como veio
      }
      resto = resto.slice(2);
    }

    var frase;
    if (descritores.indexOf('trovoada') !== -1) {
      frase = fenomenos.length ? 'trovoada com ' + fenomenos.join(' e ') : 'trovoada';
    } else if (descritores.length && fenomenos.length) {
      frase = descritores.join(' ') + ' ' + fenomenos.join(' e ');
    } else {
      frase = (descritores.join(' ') || fenomenos.join(' e '));
    }

    if (!frase) { return original; }
    if (intensidade && intensidade !== 'nas proximidades') {
      frase += ' ' + intensidade;
    } else if (intensidade === 'nas proximidades') {
      frase = 'nas proximidades: ' + frase;
    }
    return frase;
  }

  function formatarCondicoes(codigo) {
    if (!codigo) { return 'sem fenômenos significativos'; }
    var partes = String(codigo).split(/\s+/).filter(Boolean);
    var traduzidas = partes.map(traduzirCondicao);
    return partes.map(function (bruto, i) {
      return traduzidas[i] && traduzidas[i] !== bruto
        ? bruto + ' · ' + traduzidas[i]
        : bruto;
    }).join('<br>');
  }

  var COBERTURAS = {
    FEW: 'poucas nuvens', SCT: 'nuvens dispersas', BKN: 'nublado',
    OVC: 'encoberto', VV: 'visibilidade vertical',
    NSC: 'sem nuvens significativas', NCD: 'sem nuvens detectadas',
    SKC: 'céu claro', CLR: 'céu claro'
  };

  function formatarNuvens(nuvens, visibilidade) {
    if (!Array.isArray(nuvens) || !nuvens.length) {
      if (visibilidade && visibilidade.cavok) { return 'CAVOK · sem nuvens significativas'; }
      return 'não informada';
    }
    var itens = nuvens.map(function (n) {
      var cob = (n && n.cobertura) || '';
      var rotulo = COBERTURAS[cob] || '';
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
    return (typeof valor === 'number') ? valor + ' °C' : 'não informada';
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
    if (el['metar-bruto']) { el['metar-bruto'].textContent = 'sem observação disponível'; }
    if (el['metar-idade']) { el['metar-idade'].textContent = '—'; }
    definirChip('sem dados', 'chip-fail');
    mostrarAviso(motivo || 'O arquivo de observação não está disponível no momento.');
  }

  /* ------------------------------------------------------------- renderiza */

  function renderizar(dados) {
    var observacao = dados && dados.observacao;
    if (!observacao || !observacao.metar_bruto) {
      var msg = (dados && dados.coleta && dados.coleta.mensagem) || '';
      semDados(msg ? 'Última tentativa de coleta sem sucesso: ' + msg + '.' : '');
      return;
    }

    var falhaColeta = dados.coleta && dados.coleta.resultado === 'erro';

    el['metar-bruto'].textContent = observacao.metar_bruto;
    el['metar-vento'].textContent = formatarVento(observacao.vento);
    el['metar-visibilidade'].textContent = formatarVisibilidade(observacao.visibilidade);
    el['metar-temperatura'].textContent = temperatura(observacao.temperatura_c);
    el['metar-orvalho'].textContent = temperatura(observacao.ponto_orvalho_c);
    el['metar-qnh'].textContent = (typeof observacao.qnh_hpa === 'number')
      ? numero.format(observacao.qnh_hpa) + ' hPa' : 'não informado';
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
      idadeTexto = 'observada há ' + emMinutos(segundos);
    } else if (observacao.observado_utc) {
      var data = new Date(observacao.observado_utc);
      if (!isNaN(data.getTime())) {
        segundos = Math.max(0, Math.floor((Date.now() - data.getTime()) / 1000));
        idadeTexto = 'observada há ' + emMinutos(segundos);
      }
    }
    if (el['metar-idade']) { el['metar-idade'].textContent = idadeTexto || '—'; }

    var atrasoMin = segundos === null ? null : Math.floor(segundos / 60);

    if (atrasoMin !== null && atrasoMin > LIMIAR_ATRASO_MIN) {
      definirChip('desatualizada', 'chip-fail');
    } else {
      definirChip('atualizada', 'chip-ok');
    }

    // avisos: coleta suspensa, falha de coleta, observação atrasada
    var avisos = [];
    if (horarioNoturno()) {
      avisos.push('Coleta noturna suspensa (entre 22:06 e 05:59 BRT); a próxima está prevista para 06:20. Exibindo a última observação coletada.');
    }
    if (falhaColeta) {
      var detalhe = (dados.coleta.mensagem || 'falha na coleta');
      avisos.push('A última tentativa de coleta não foi concluída (' + detalhe + '). A observação exibida é a última válida.');
    }
    if (atrasoMin !== null && atrasoMin > LIMIAR_ATRASO_MIN) {
      avisos.push('A observação tem ' + emMinutos(segundos) + ' e pode não refletir as condições atuais.');
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
        semDados('Não foi possível carregar o arquivo de observação. O coletor pode estar desativado ou a coleta ainda não foi executada.');
      })
      .then(function () {
        carregando = false;
      });
  }

  carregar();
  window.setInterval(carregar, INTERVALO_MS);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { carregar(); }
  });
}());
