#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "1/5 Встановлюю залежності..."
npm install

echo "2/5 Перевіряю збірку..."
npm run build

echo "3/5 Оновлюю серверні функції..."
npx supabase functions deploy admin-create-user --no-verify-jwt
npx supabase functions deploy admin-reset-password --no-verify-jwt

echo "4/5 Зберігаю зміни..."
git add src/App.jsx supabase/functions/admin-create-user/index.ts supabase/functions/admin-reset-password/index.ts package-lock.json
git commit -m "Fix login and staff access" || true
git push

echo "5/5 Оновлюю той самий застосунок..."
npx vercel --prod --yes

echo "✅ ГОТОВО"
echo "Вхід адміністратора: admin / Polumya#2417!"
