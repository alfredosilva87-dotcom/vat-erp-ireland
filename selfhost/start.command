#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js nao encontrado. Rode selfhost/install.command primeiro."
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

# Colima (Mac antigo) não sobe sozinho no login — se estiver instalado e parado,
# ligue antes de tentar falar com o Docker.
if command -v colima >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  echo "Iniciando o Colima (maquina Docker)..."
  colima start
fi

node "selfhost/scripts/start.js"

echo
echo "O app foi encerrado."
read -r -p "Pressione Enter para fechar..."
