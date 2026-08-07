#!/bin/bash
# Duplo clique no Finder abre isto no Terminal.
cd "$(dirname "$0")/.." || exit 1

# O Finder inicia com um PATH mínimo; o Node instalado via Homebrew ou pelo
# instalador oficial mora em um destes.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[!] Node.js nao encontrado neste Mac."
  echo "    Instale a versao LTS em https://nodejs.org e rode este arquivo de novo."
  echo
  open "https://nodejs.org/en/download"
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo
  echo "[!] Docker nao encontrado neste Mac."
  echo "    macOS 14 (Sonoma) ou mais novo: instale o Docker Desktop."
  echo "    macOS 13 (Ventura) ou mais antigo: use o Colima —"
  echo "      brew install docker docker-compose colima"
  echo "      colima start --cpu 2 --memory 4 --disk 20"
  echo
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

node "selfhost/scripts/install.js"
code=$?

echo
if [ "$code" -ne 0 ]; then
  echo "A instalacao nao terminou. Veja a mensagem acima."
fi
read -r -p "Pressione Enter para fechar..."
exit "$code"
