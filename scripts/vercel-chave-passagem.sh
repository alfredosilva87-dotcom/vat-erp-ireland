#!/usr/bin/env bash
#
# Poe a chave da passagem na Vercel e reimplanta, sem copiar nada a mao.
#
# ---------------------------------------------------------------------------
# POR QUE ISTO EXISTE
#
# A chave certa ja esta em `.env.local.cloud-backup`, conferida contra a
# passagem. O que faltava era leva-la ao projeto da Vercel, e o caminho pelo
# painel tem tres armadilhas que ja custaram uma noite:
#
#   1. Guardar a variavel nao muda nada — a funcao em execucao foi construida
#      com o valor antigo e so um build novo a substitui.
#   2. Editar por cima do campo as vezes deixa resto do valor anterior.
#   3. Um espaco ou quebra de linha invisivel no fim invalida a chave, e o
#      erro que volta e so "Invalid API key".
#
# Aqui o valor sai do ficheiro e vai direto para a CLI: ninguem o ve, ninguem
# o digita, e a variavel e APAGADA antes de ser recriada, para nao restar nada
# do valor velho.
# ---------------------------------------------------------------------------
#
# Precisa de estar autenticado na Vercel uma vez: `npx vercel login`.
#
# Uso:  ./scripts/vercel-chave-passagem.sh [projeto]
#       (projeto por omissao: vat-erp-ireland)

set -euo pipefail
cd "$(dirname "$0")/.."

PROJETO="${1:-vat-erp-ireland}"
ENV_FILE=".env.local.cloud-backup"
VAR="RELAY_SUPABASE_SERVICE_ROLE_KEY"

CHAVE=$(grep -E "^$VAR=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
URL=$(grep -E '^RELAY_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n')
[ -n "$CHAVE" ] && [ "$CHAVE" != "COLE_AQUI" ] || { echo "Falta a chave em $ENV_FILE." >&2; exit 1; }

# Conferir ANTES de a mandar para a nuvem. Subir uma chave que nao presta e
# reimplantar por causa dela custa mais tempo do que este pedido.
echo -n "A conferir a chave contra a passagem... "
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE" \
  "$URL/rest/v1/phone_links?select=token&limit=1" || echo "000")
[ "$CODIGO" = "200" ] || { echo "FALHOU (HTTP $CODIGO). Nada foi enviado."; exit 1; }
echo "ok (${#CHAVE} caracteres)."

if [ ! -f .vercel/project.json ]; then
  echo
  echo "O projeto ainda nao esta ligado. A ligar a '$PROJETO'..."
  npx --yes vercel link --yes --project "$PROJETO"
fi

echo
for AMBIENTE in production preview development; do
  # Remover primeiro: `env add` sobre uma variavel existente falha, e editar
  # por cima no painel e onde fica resto do valor velho.
  npx --yes vercel env rm "$VAR" "$AMBIENTE" --yes >/dev/null 2>&1 || true
  printf '%s' "$CHAVE" | npx --yes vercel env add "$VAR" "$AMBIENTE" >/dev/null
  echo "  $VAR gravada em $AMBIENTE"
done

echo
echo "A reimplantar (variavel so entra em build novo)..."
npx --yes vercel deploy --prod

echo
echo "Feito. Confira com o Buscar agora, ou peca ao Claude para conferir."
