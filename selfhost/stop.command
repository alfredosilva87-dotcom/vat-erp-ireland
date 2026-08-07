#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node "selfhost/scripts/stop.js"
read -r -p "Pressione Enter para fechar..."
