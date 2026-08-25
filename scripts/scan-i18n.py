#!/usr/bin/env python3
"""
Onde ainda ha portugues escrito dentro do componente.

Corre da raiz do repositorio: `python3 scripts/scan-i18n.py`

**Ignora comentarios de proposito.** Os comentarios deste codigo sao em
portugues por decisao de projeto, e uma varredura que os conte devolve
centenas de falsos positivos — o suficiente para o numero deixar de ser
util e a lista deixar de ser lida. Por isso corta `/* */` e `//` antes de
procurar, e so olha para string literal e texto entre tags.

A deteccao e por PALAVRA portuguesa, nao por acento: "Data", "Conta" e
"Valor" nao tem acento nenhum e sao exatamente o que aparece numa tela.
Marca `SEM-t` o ficheiro que nem sequer importa o dicionario — esse
precisa do `useT()` alem das chaves.
"""
import re, os
# Texto PT visivel ao utilizador em JSX/strings, IGNORANDO comentarios (que sao PT de proposito).
strip_block = re.compile(r'/\*.*?\*/', re.S)
strip_line  = re.compile(r'^\s*//.*$', re.M)
# palavras que so existem em portugues
PT = r'\b(não|nao|você|voce|está|esta[rs]?|são|com|para|sem|por|uma?|dos?|das?|nos?|nas?|até|já|também|então|quando|onde|qual|todos?|todas?|cliente|conta|nota|venda|compra|banco|razão|razao|saldo|lançamento|lancamento|título|titulo|período|periodo|fornecedor|guardar|gravar|apagar|fechar|abrir|erro|aviso|selecion\w+|escolh\w+|adicionar|remover|nenhum\w*|carregando|pesquisar|semana|folha|pagamento|contabil\w*|balanç\w+|imposto|data|valor)\b'
pt_re = re.compile(PT, re.I)
rows=[]
for root,dirs,files in os.walk('.'):
    if any(x in root for x in ('node_modules','.next','.git','selfhost/docker','selfhost/backups')): continue
    for fn in files:
        if not fn.endswith(('.tsx','.ts')): continue
        p=os.path.join(root,fn)
        if '/lib/i18n/' in p: continue
        src=open(p,encoding='utf-8',errors='ignore').read()
        code=strip_line.sub('', strip_block.sub('', src))
        hits=set()
        # strings literais e texto JSX
        for m in re.finditer(r'"([^"\n]{4,120})"|\'([^\'\n]{4,120})\'|>\s*([^<>{}\n]{4,120})\s*<', code):
            s=(m.group(1) or m.group(2) or m.group(3) or '').strip()
            if not s or s.startswith(('@/','./','../','http')): continue
            if pt_re.search(s): hits.add(s)
        if hits:
            has_t = bool(re.search(r'useI18n|from "@/lib/i18n"', src))
            rows.append((len(hits), 'com-t' if has_t else 'SEM-t', p, sorted(hits)[:3]))
rows.sort(reverse=True)
print(f"ficheiros com texto PT fora do i18n: {len(rows)}")
print(f"ocorrencias totais: {sum(r[0] for r in rows)}")
print(f"  destes, ficheiros que nem importam i18n: {sum(1 for r in rows if r[1]=='SEM-t')}")
print()
for n,tag,p,ex in rows[:25]:
    print(f"{n:4d} {tag:6s} {p}")
    for e in ex: print(f"          · {e[:80]}")
