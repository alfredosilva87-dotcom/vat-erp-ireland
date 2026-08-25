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
GRAVADAS=0
for AMBIENTE in production preview development; do
  # Remover primeiro: `env add` sobre uma variavel existente falha, e editar
  # por cima no painel e onde fica resto do valor velho.
  npx --yes vercel env rm "$VAR" "$AMBIENTE" --yes >/dev/null 2>&1 || true

  # A saida NAO vai para o lixo, e o codigo de saida E conferido.
  #
  # Na primeira versao isto era `>/dev/null` sem verificacao, e o `env add`
  # falhou em silencio: o script disse "gravada" nos tres ambientes, a
  # variavel nao existia em nenhum, e o sintoma foi "Invalid API key" — que
  # manda procurar a chave errada em vez do comando que nao correu. Uma hora
  # perdida a conferir uma chave que sempre esteve certa.
  if printf '%s' "$CHAVE" | npx --yes vercel env add "$VAR" "$AMBIENTE" 2>&1 | sed "s|$CHAVE|<CHAVE>|g" | grep -q "Added"; then
    echo "  $VAR gravada em $AMBIENTE"
    GRAVADAS=$((GRAVADAS + 1))
  else
    echo "  FALHOU em $AMBIENTE" >&2
  fi
done

[ "$GRAVADAS" -gt 0 ] || { echo "Nao gravou em ambiente nenhum. Nada a reimplantar." >&2; exit 1; }

echo
# Reimplantar a producao que JA existe, em vez de enviar os ficheiros locais.
#
# `vercel deploy --prod` daqui sobe a arvore de trabalho e estoura o limite de
# 100 MB por causa das pastas de build (.next-*). Reimplantar nao envia nada:
# reaproveita a fonte que ja esta la e so relê as variaveis, que e exactamente
# o que se quer.
echo "A descobrir a producao actual..."
ULTIMA=$(npx --yes vercel ls --prod 2>/dev/null | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | head -1)
[ -n "$ULTIMA" ] || { echo "Nao consegui descobrir a implantacao. Reimplante pelo painel." >&2; exit 1; }
echo "A reimplantar $ULTIMA (variavel so entra em build novo)..."
npx --yes vercel redeploy "$ULTIMA"

echo
echo "Feito. Confira com o Buscar agora, ou peca ao Claude para conferir."
