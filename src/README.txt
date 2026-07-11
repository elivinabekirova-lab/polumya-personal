1) Замінити src/App.jsx файлом App_auth_ready.jsx.
2) У Supabase SQL Editor виконати supabase/migrations/20260711_auth_profiles.sql.
3) У Supabase Dashboard → Authentication → Users створити першого адміністратора:
   Email: elya@staff.polumya.app
   Password: ваш надійний пароль
   Auto Confirm User: увімкнути.
4) Скопіювати UUID створеного користувача і виконати в SQL Editor:

insert into public.profiles (user_id, role, staff_id, display_name, login, active)
values ('ВСТАВТЕ_UUID', 'admin', null, 'Еля', 'elya', true)
on conflict (user_id) do update set role='admin', display_name='Еля', login='elya', active=true;

5) Розгорнути Edge Function:
   npx supabase functions deploy admin-create-user
6) npm run build; git add .; git commit; git push; npx vercel --prod
7) В адмінці «Персонал → Додати» задавати кожному особистий логін і пароль.

Важливо: логін перетворюється всередині на технічний email login@staff.polumya.app; працівник бачить і вводить тільки логін.
