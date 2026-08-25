#!/usr/bin/env bash
#
# Cola a chave secreta da passagem no `.env.local.cloud-backup`, sem a mostrar.
#
# ---------------------------------------------------------------------------
# POR QUE UM SCRIPT PARA UMA LINHA
#
# Três atritos, e cada um já custou tempo:
#
#   1. O ficheiro começa por ponto, então o Finder esconde-o. Procurá-lo na
#      pasta não dá em nada, e não há nada de errado com a pasta.
#   2. A chave na Vercel não se lê de volta — valores sensíveis são de escrita
#      apenas. Tem de vir do painel do Supabase.
#   3. Colar um segredo num editor deixa-o no histórico do editor, e colá-lo
#      num comando deixa-o no histórico da shell. Aqui não aparece em lado
#      nenhum: entra com o eco desligado e vai direto para o ficheiro.
#
# No fim CONFERE a chave contra a passagem de verdade. Sem isso, uma chave
# errada só se descobriria três passos à frente, com uma mensagem que se lê
# como "a passagem está partida".
# ---------------------------------------------------------------------------
#
# Uso:  ./scripts/colar-chave-passagem.sh

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local.cloud-backup"
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE." >&2; exit 1; }

URL=$(grep -E '^RELAY_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "$URL" ] || { echo "Falta RELAY_SUPABASE_URL em $ENV_FILE." >&2; exit 1; }

echo "Passagem: $URL"
echo "Painel do Supabase -> vat-erp-passagem -> Project Settings -> API Keys"
echo "-> Reveal na chave 'service_role' (a secret) e copiar."
echo
printf "Cole a chave e carregue Enter (nao vai aparecer): "
IFS= read -rs CHAVE
echo

[ -n "$CHAVE" ] || { echo "Nada colado." >&2; exit 1; }

# A chave publicavel comeca por sb_publishable_ e nao serve: a passagem tem RLS
# sem politica nenhuma, entao ela nao le nem escreve la nada. Vale a pena
# recusar aqui, porque o sintoma mais a frente e uma lista vazia — que se le
# como "nao chegou foto" em vez de "chave errada".
case "$CHAVE" in
  sb_publishable_*|*'"anon"'*)
    echo "Essa e a chave PUBLICAVEL. Precisa da 'service_role' (a secret)." >&2
    exit 1 ;;
esac

echo -n "A conferir contra a passagem... "
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
  "$URL/rest/v1/phone_links?select=token&limit=1" || echo "000")

if [ "$CODIGO" != "200" ]; then
  echo "FALHOU (HTTP $CODIGO)."
  echo "A chave nao foi gravada. Confirme que copiou a 'service_role' do projeto certo." >&2
  exit 1
fi
echo "ok."

# Reescreve a linha sem nunca imprimir o valor.
TMP=$(mktemp)
CHAVE="$CHAVE" awk '
  /^RELAY_SUPABASE_SERVICE_ROLE_KEY=/ { print "RELAY_SUPABASE_SERVICE_ROLE_KEY=" ENVIRON["CHAVE"]; feito=1; next }
  { print }
  END { if (!feito) print "RELAY_SUPABASE_SERVICE_ROLE_KEY=" ENVIRON["CHAVE"] }
' "$ENV_FILE" > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$ENV_FILE"

echo
echo "Gravada em $ENV_FILE (gitignorado)."
echo "Agora reinicie o servidor:  ./scripts/dev-contra-nuvem.sh 3200"
