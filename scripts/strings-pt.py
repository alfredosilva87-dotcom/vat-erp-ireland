#!/usr/bin/env python3
"""
As strings PT de UM ficheiro, prontas para virar chaves.

O `scan-i18n.py` diz ONDE falta traduzir; este diz O QUE. Sao dois passos
porque a lista completa de 721 strings nao cabe numa leitura util — e a
traducao faz-se ficheiro a ficheiro, que e a unidade em que se verifica.
"""
import re, sys
strip_block = re.compile(r'/\*.*?\*/', re.S)
strip_line  = re.compile(r'^\s*//.*$', re.M)
PT = r'\b(não|nao|você|está|esta[rs]?|são|com|para|sem|por|uma?|dos?|das?|nos?|nas?|até|já|também|então|quando|onde|qual|todos?|todas?|cliente|conta|nota|venda|compra|banco|razão|saldo|lançamento|título|período|fornecedor|guardar|gravar|apagar|fechar|abrir|erro|aviso|selecion\w+|escolh\w+|adicionar|remover|nenhum\w*|carregando|pesquisar|semana|folha|pagamento|contabil\w*|balanç\w+|imposto|data|valor|fatura|linhas?|enviar|emitir|anular|rascunho)\b'
pt = re.compile(PT, re.I)
src = open(sys.argv[1], encoding='utf-8').read()
code = strip_line.sub('', strip_block.sub('', src))
vistos = []
for m in re.finditer(r'"([^"\n]{3,160})"|\'([^\'\n]{3,160})\'|>\s*([^<>{}\n]{3,160})\s*<', code):
    s = (m.group(1) or m.group(2) or m.group(3) or '').strip()
    if not s or s.startswith(('@/', './', '../', 'http')): continue
    if re.search(r'[{}()\[\];]|&&|\|\||=>|\bconst\b|\breturn\b', s): continue
    if re.match(r'^[a-z]+\.[a-zA-Z]', s): continue
    if re.search(r'\b(flex|grid|text-|bg-|border-|px-|py-|mt-|w-|h-|rounded)\b', s): continue
    if not pt.search(s): continue
    # Uma palavra so, minuscula e sem espacos, e quase sempre um identificador
    # de estado — `setOcupado("gravar")` — e nao texto de ecra. Contar isso faz
    # a lista deixar de ser confiavel, que e o mesmo motivo por que os
    # comentarios ficam de fora.
    if re.fullmatch(r'[a-zà-ú]+', s): continue
    # Valores tecnicos que a palavra "no"/"data" apanha por engano.
    if s in ('no-store', 'no-cache', 'nao', 'data'): continue
    if re.fullmatch(r'[a-z-]+/[a-z0-9.+-]+', s): continue   # "application/pdf"

    if s not in vistos: vistos.append(s)
for s in vistos: print(s)
