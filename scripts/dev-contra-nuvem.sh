#!/usr/bin/env bash
#
# O ERP a correr NESTA MÁQUINA, contra o banco da NUVEM.
#
# ---------------------------------------------------------------------------
# POR QUE ISTO EXISTE
#
# A implantação da Vercel está no plano Hobby, e nele uma função corre no
# máximo 60 segundos. A leitura de um documento não cabe nisso: o mesmo PDF
# que deu 504 lá passou aqui em 35 s. O teto não se muda por código.
#
# Então, para fazer o ciclo inteiro — foto do telemóvel, ler a nota, virar
# conta a pagar, baixar pelo banco, contabilizar — o processo corre aqui e os
# dados continuam a ser os da nuvem. É a mesma base que a Vercel serve, então
# o que se fizer aqui aparece lá.
# ---------------------------------------------------------------------------
#
# As credenciais vêm de `.env.local.cloud-backup`, que é gitignorado. O
# `.env.local` (que aponta para o Postgres local) NÃO é tocado: as variáveis
# exportadas aqui têm precedência sobre ficheiros .env no Next.
#
# Uso:  ./scripts/dev-contra-nuvem.sh [porta]

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local.cloud-backup"
PORTA="${1:-3200}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Falta $ENV_FILE — é ele que guarda as credenciais da nuvem." >&2
  exit 1
fi

# Lê o ficheiro para o ambiente, ignorando comentários e linhas vazias.
while IFS='=' read -r chave valor; do
  case "$chave" in ''|\#*) continue ;; esac
  export "$chave=$valor"
done < <(grep -E '^[A-Z][A-Z0-9_]*=' "$ENV_FILE")

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "O $ENV_FILE não tem as credenciais do banco da nuvem." >&2
  exit 1
fi

# A passagem só se liga se a chave estiver mesmo lá.
#
# Com o marcador por preencher, `relayConfigured()` diria que sim (a variável
# não está vazia) e a busca falharia com erro de autenticação — que se lê como
# "a passagem está partida" em vez de "falta colar a chave". Melhor não a
# definir de todo: aí a tela diz honestamente que não está configurada.
if [ "${RELAY_SUPABASE_SERVICE_ROLE_KEY:-COLE_AQUI}" = "COLE_AQUI" ]; then
  unset RELAY_SUPABASE_SERVICE_ROLE_KEY RELAY_SUPABASE_URL PHONE_CAPTURE_URL || true
  RELAY_ESTADO="DESLIGADA — falta colar a chave em $ENV_FILE"
else
  RELAY_ESTADO="ligada -> ${RELAY_SUPABASE_URL}"
fi

# Pasta de build própria: `next dev` e `next build` não podem partilhar `.next`,
# e outra cópia do projeto pode estar a servir noutra porta.
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-nuvem}"

echo "banco:    $NEXT_PUBLIC_SUPABASE_URL"
echo "passagem: $RELAY_ESTADO"
echo "leitura:  ${GEMINI_MODEL:-(modelo padrão)}"
echo "porta:    $PORTA   (build em $NEXT_DIST_DIR)"
echo
echo "ATENÇÃO: isto escreve no banco de PRODUÇÃO da demonstração."
echo

exec npx next dev -p "$PORTA"
