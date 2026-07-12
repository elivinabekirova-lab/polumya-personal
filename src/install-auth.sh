#!/bin/bash
set -e
PROJECT_REF="kxzhscuvrrnfhpvhxayl"
cd "$HOME/Desktop/персонал"
PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"

cp src/App.jsx "src/App_before_first_setup_$(date +%Y%m%d_%H%M%S).jsx" 2>/dev/null || true
cp "$PACKAGE_DIR/App_first_setup_ready.jsx" src/App.jsx
cp "$PACKAGE_DIR/pushNotifications.js" src/pushNotifications.js
mkdir -p supabase/functions/admin-create-user supabase/functions/admin-reset-password supabase/functions/bootstrap-admin supabase/migrations
cp "$PACKAGE_DIR/supabase/functions/admin-create-user/index.ts" supabase/functions/admin-create-user/index.ts
cp "$PACKAGE_DIR/supabase/functions/admin-reset-password/index.ts" supabase/functions/admin-reset-password/index.ts
cp "$PACKAGE_DIR/supabase/functions/bootstrap-admin/index.ts" supabase/functions/bootstrap-admin/index.ts
cp "$PACKAGE_DIR/supabase/migrations/20260711_auth_profiles.sql" supabase/migrations/20260711_auth_profiles.sql

npx supabase link --project-ref "$PROJECT_REF"
npx supabase db push
npx supabase functions deploy admin-create-user
npx supabase functions deploy admin-reset-password
npx supabase functions deploy bootstrap-admin --no-verify-jwt

npm run build
git add src/App.jsx src/pushNotifications.js supabase/functions supabase/migrations
git commit -m "Add first-run admin setup and managed staff login" || true
git push
npx vercel --prod

echo ""
echo "✅ ГОТОВО"
echo "Відкрий застосунок. На першому екрані сама придумай логін і пароль адміністратора."
