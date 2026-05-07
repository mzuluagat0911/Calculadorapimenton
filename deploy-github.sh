#!/bin/bash
# Setup + push inicial a GitHub para Calculadorapimenton
# Uso:  bash deploy-github.sh
# (este archivo está en .gitignore, no se sube al repo)
set -e

cd "$(dirname "$0")"

echo "→ Limpiando .git previo (si existe)…"
rm -rf .git

echo "→ Inicializando repo (rama main)…"
git init -b main -q
git config user.name  "Mateo Zuluaga"
git config user.email "mateo@pimenton.io"

echo "→ Staging (respeta .gitignore: excluye node_modules/, .vercel/, .env, .DS_Store, deploy-github.sh)…"
git add -A

echo "→ Commit inicial…"
git commit -q -m "Initial commit: pricing calculator with Promoción Mundial

- Pricing Delivery (descuento %) — modo regular
- Promoción Mundial (cupón fijo \$7k/\$8k/\$9k) — toggle en header
- Login Supabase con perfil + correo retornante
- Cascada P&L con cálculo de margen sobre venta neta
- Endpoints serverless en /api (register, instant-login, resolve-email)"

echo "→ Conectando remote…"
git remote add origin https://github.com/mzuluagat0911/Calculadorapimenton.git 2>/dev/null || \
  git remote set-url origin https://github.com/mzuluagat0911/Calculadorapimenton.git

echo "→ Pusheando a main…"
git push -u origin main

echo ""
echo "✓ Listo. Repo: https://github.com/mzuluagat0911/Calculadorapimenton"
