#!/bin/bash
set -euo pipefail

PROJECT="$HOME/Desktop/персонал"
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

cd "$PROJECT"

echo "📦 Резервна копія..."
cp src/App.jsx "src/App.before-staff-access-fix-$STAMP.jsx"
mkdir -p "_backup_staff_access_$STAMP/supabase/functions/admin-create-user"
mkdir -p "_backup_staff_access_$STAMP/supabase/functions/admin-reset-password"
[ -f supabase/functions/admin-create-user/index.ts ] && cp supabase/functions/admin-create-user/index.ts "_backup_staff_access_$STAMP/supabase/functions/admin-create-user/index.ts"
[ -f supabase/functions/admin-reset-password/index.ts ] && cp supabase/functions/admin-reset-password/index.ts "_backup_staff_access_$STAMP/supabase/functions/admin-reset-password/index.ts"

echo "🧩 Встановлюю виправлення..."
cp "$PACKAGE_DIR/src/App.jsx" src/App.jsx
mkdir -p supabase/functions/admin-create-user supabase/functions/admin-reset-password
cp "$PACKAGE_DIR/supabase/functions/admin-create-user/index.ts" supabase/functions/admin-create-user/index.ts
cp "$PACKAGE_DIR/supabase/functions/admin-reset-password/index.ts" supabase/functions/admin-reset-password/index.ts

echo "☁️ Оновлюю функції Supabase..."
npx supabase functions deploy admin-create-user
npx supabase functions deploy admin-reset-password

echo "🏗 Перевіряю збірку..."
npm run build

echo "📤 Оновлюю GitHub..."
git add src/App.jsx supabase/functions/admin-create-user/index.ts supabase/functions/admin-reset-password/index.ts
git commit -m "Fix staff account creation and password reset" || true
git push

echo "🚀 Оновлюю той самий застосунок..."
npx vercel --prod --yes

echo ""
echo "✅ ГОТОВО"
echo "Тепер можна створювати працівника навіть якщо такий логін уже пробували додати раніше."
echo "Пароль повинен мати мінімум 8 символів."
