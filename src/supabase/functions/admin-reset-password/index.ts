import { createClient } from "npm:@supabase/supabase-js@2";
const headers = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const DOMAIN="staff.polumya.app";
const normalize=(v:string)=>v.trim().toLowerCase().replace(/[^a-z0-9._-]/g,"");
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  try{
    const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key) throw new Error("Не налаштовані серверні ключі Supabase");
    const service=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
    const {data:current,error:currentError}=await service.auth.getUser(token);
    if(currentError||!current.user) throw new Error("Потрібна авторизація адміністратора");
    const {data:profile}=await service.from("profiles").select("role,active").eq("user_id",current.user.id).maybeSingle();
    const meta=current.user.user_metadata||{};
    const isAdmin=(profile?.role==="admin"&&profile?.active!==false)||(meta.role==="admin"&&meta.active!==false);
    if(!isAdmin) throw new Error("Недостатньо прав адміністратора");
    const body=await req.json(); const password=String(body.password||"");
    if(password.length<8) throw new Error("Пароль має містити щонайменше 8 символів");
    let userId=String(body.userId||"").trim();
    if(!userId&&body.login){
      const login=normalize(String(body.login));
      const {data:p}=await service.from("profiles").select("user_id").eq("login",login).maybeSingle(); userId=p?.user_id||"";
      if(!userId){ const email=login.includes("@")?login:`${login}@${DOMAIN}`; const {data:u}=await service.auth.admin.listUsers({page:1,perPage:1000}); userId=(u.users||[]).find(x=>String(x.email||"").toLowerCase()===email.toLowerCase())?.id||""; }
    }
    if(!userId) throw new Error("Акаунт працівника не знайдено");
    const {error}=await service.auth.admin.updateUserById(userId,{password}); if(error) throw error;
    return new Response(JSON.stringify({ok:true,userId}),{headers});
  }catch(error){return new Response(JSON.stringify({ok:false,error:error instanceof Error?error.message:"Помилка"}),{status:400,headers});}
});
