#!/usr/bin/env bash
# Pull latest from GitHub, publish static files, stamp asset URLs with the commit, restart the API.
set -euo pipefail
cd /home/tide/cansncats
git pull --ff-only
sudo rsync -a --delete --exclude .git --exclude .env --exclude server --exclude worker --exclude .openai \
  --exclude deploy.sh --exclude .gitignore --exclude README.md ./ /var/www/cansncats.com/
# Cache-bust CSS/JS (Cloudflare and browsers cache them for 7 days): ?v=dev → ?v=<short sha>.
SHA="$(git rev-parse --short HEAD)"
sudo sed -i "s/?v=dev/?v=${SHA}/g; s/?v=[0-9a-f]\{7,\}/?v=${SHA}/g" /var/www/cansncats.com/*.html
pm2 restart cansncats-api --update-env >/dev/null
echo "deployed ${SHA}"
