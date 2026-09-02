#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js nao encontrado. Rode selfhost/install.command primeiro."
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

# Mesma razao do start.command: o Colima nao sobe sozinho, e a atualizacao
# precisa do banco de pe para aplicar o esquema.
if command -v colima >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  echo "Iniciando o Colima (maquina Docker)..."
  colima start
fi

node "selfhost/scripts/update.js"

echo
read -r -p "Pressione Enter para fechar..."
