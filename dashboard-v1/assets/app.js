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
     1. Relógio
     ---------------------------------------------------------------------- */

  var elLocal = document.getElementById('relogio-local');
  var elUtc = document.getElementById('relogio-utc');

  var fmtLocal = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  var fmtUtc = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'UTC'
  });

  function atualizarRelogio() {
    var agora = new Date();
    if (elLocal) { elLocal.textContent = fmtLocal.format(agora); }
    if (elUtc) { elUtc.textContent = fmtUtc.format(agora); }
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
  var TEXTO = {
    espera: 'verificando',
    ok: 'respondeu',
    falha: 'sem resposta'
  };

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
    chip.textContent = TEXTO[estado];
  }

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
      if (lat) { lat.textContent = 'não suportado'; }
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
      btnReverificar.textContent = 'Verificando…';
    }
    if (selHoraVerificacao) { selHoraVerificacao.textContent = 'em andamento'; }

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
        btnReverificar.textContent = 'Verificar novamente';
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
