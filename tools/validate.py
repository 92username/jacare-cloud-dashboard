#!/usr/bin/env python3
"""Validador local do dashboard Jacaré Cloud v1.0.

Checa, sem dependências externas:
  1. balanceamento e aninhamento de tags;
  2. elementos obrigatórios (doctype, lang, charset, viewport, title);
  3. IDs duplicados e referências aria-labelledby/aria-describedby/for quebradas;
  4. atributos de acessibilidade em svg e links;
  5. ausência de handlers inline, http:// e referências locais inexistentes;
  6. presença de assets locais.

Uso: python3 tools/validate.py <diretorio-do-site>
"""
import os
import re
import sys

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
OPTIONAL_END = {"li", "p", "dt", "dd", "tr", "td", "th", "option"}


def check(path: str) -> int:
    erros = []
    avisos = []
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    base = os.path.dirname(os.path.abspath(path))

    if not src.lstrip().lower().startswith("<!doctype html>"):
        erros.append("doctype html ausente")

    # --- tokenização simples de tags ---
    stack = []
    ids = []
    refs = []
    linha_de = lambda pos: src.count("\n", 0, pos) + 1
    for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*?)(/?)>", src):
        fechando, nome, attrs, autofecha = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        ln = linha_de(m.start())
        if fechando:
            if not stack:
                erros.append(f"linha {ln}: </{nome}> sem abertura correspondente")
                continue
            if stack[-1][0] == nome:
                stack.pop()
            else:
                # procura na pilha (permite fechamento de opcionais)
                idx = next((i for i in range(len(stack) - 1, -1, -1) if stack[i][0] == nome), None)
                if idx is None:
                    erros.append(f"linha {ln}: </{nome}> sem correspondente (pilha: {[t[0] for t in stack[-3:]]})")
                else:
                    nao_fechadas = [t[0] for t in stack[idx + 1:]]
                    if any(t not in OPTIONAL_END for t in nao_fechadas):
                        erros.append(f"linha {ln}: </{nome}> fecha com tags abertas dentro: {nao_fechadas}")
                    del stack[idx:]
        else:
            if nome in VOID or autofecha:
                pass
            else:
                stack.append((nome, ln))
            for attr in ("id", "aria-labelledby", "aria-describedby", "for"):
                for val in re.findall(attr + r"\s*=\s*\"([^\"]*)\"", attrs):
                    if attr == "id":
                        if val in ids:
                            erros.append(f"linha {ln}: id duplicado '{val}'")
                        ids.append(val)
                    else:
                        refs.extend((r.strip(), ln) for r in val.split() if r.strip())

    restantes = [t for t in stack]
    if restantes:
        erros.append(f"tags não fechadas: {restantes}")

    # --- âncoras internas (#alvo) ---
    for frag in re.findall(r'href\s*=\s*"#([^"]+)"', src):
        if frag not in ids:
            erros.append(f"âncora interna para id inexistente: '#{frag}'")

    # --- âncoras internas (#alvo) ---
    for frag in re.findall(r'href\s*=\s*"#([^"]+)"', src):
        if frag not in ids:
            erros.append(f"âncora interna para id inexistente: '#{frag}'")

    # --- referências ---
    for ref, _ in refs:
        if ref not in ids:
            erros.append(f"referência a id inexistente: '{ref}'")

    # --- cabeçalho e metadados ---
    if 'lang="pt-BR"' not in src:
        erros.append("html sem lang=\"pt-BR\"")
    if not re.search(r'<meta\s+charset="utf-8"', src, re.I):
        erros.append("meta charset ausente")
    if 'name="viewport"' not in src or "width=device-width" not in src:
        erros.append("meta viewport ausente/incorreto")
    titulo = re.search(r"<title>(.*?)</title>", src, re.S)
    if not titulo or not titulo.group(1).strip():
        erros.append("title vazio")
    if src.lower().count("<h1") != 1:
        erros.append(f"esperado exatamente 1 h1, encontrado {src.lower().count('<h1')}")

    # --- acessibilidade ---
    for m in re.finditer(r"<svg([^>]*)>", src):
        attrs = m.group(1)
        if "aria-hidden=\"true\"" not in attrs and "role=\"img\"" not in attrs:
            erros.append(f"linha {linha_de(m.start())}: svg sem aria-hidden ou role=img")
    for m in re.finditer(r"<a\b([^>]*)>", src):
        attrs = m.group(1)
        if "href" not in attrs:
            erros.append(f"linha {linha_de(m.start())}: <a> sem href")
        if "_blank" in attrs and "noopener" not in attrs:
            erros.append(f"linha {linha_de(m.start())}: target=_blank sem rel=noopener")
    for m in re.finditer(r"<button\b([^>]*)>", src):
        if "type=" not in m.group(1):
            avisos.append(f"linha {linha_de(m.start())}: <button> sem atributo type")

    # --- segurança / integridade ---
    if re.search(r"\son[a-z]+\s*=", src, re.I):
        erros.append("handler inline (on*) encontrado")
    inseguros = re.findall(r'(?:src|href)\s*=\s*"http://[^"]+"', src, re.I)
    if inseguros:
        erros.append(f"referência http:// insegura: {inseguros}")
    if re.search(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", src):
        erros.append("endereço IPv4 literal encontrado")
    if re.search(r"https?://[^/\"\s]+:\d{2,5}", src):
        erros.append("URL com porta explícita encontrada")
    for termo in ("api_key", "apikey", "secret", "password", "senha=", "bearer "):
        if termo in src.lower():
            erros.append(f"termo sensível encontrado: {termo}")

    # --- assets locais ---
    for ref in re.findall(r'(?:href|src)\s*=\s*"(?!https?:|#|mailto:)([^"]+)"', src):
        caminho = os.path.join(base, ref)
        if not os.path.exists(caminho):
            erros.append(f"arquivo local ausente: {ref}")

    print(f"Arquivo: {path}")
    print(f"  tags analisadas: {len(ids)} ids, {len(refs)} referências de id")
    vistos = set()
    for e in erros:
        if e in vistos:
            continue
        vistos.add(e)
        print(f"  ERRO  {e}")
    for a in avisos:
        print(f"  AVISO {a}")
    if not erros:
        print("  RESULTADO: estrutura válida, sem erros")
    return 1 if erros else 0


if __name__ == "__main__":
    alvo = sys.argv[1] if len(sys.argv) > 1 else "."
    sys.exit(check(os.path.join(alvo, "index.html")))
