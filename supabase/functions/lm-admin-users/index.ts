// Edge Function: o Master cria, lista e remove acessos do Monitor de Lotes.
// Remover tira só o acesso a este app (lm_papeis). O usuário do Supabase NÃO é apagado, pois o projeto é compartilhado com o PointBot.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // quem está chamando?
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: quem, error: eQuem } = await servico.auth.getUser(token);
    if (eQuem || !quem?.user) return json({ erro: "Sessão inválida" }, 401);
    const { data: meu } = await servico.from("lm_papeis").select("papel").eq("user_id", quem.user.id).maybeSingle();
    if (meu?.papel !== "master") return json({ erro: "Apenas o Master pode gerenciar acessos" }, 403);

    const b = await req.json().catch(() => ({}));
    const acao = String(b.acao || "");

    const todosUsuarios = async () => {
      const lista: { id: string; email?: string }[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await servico.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        lista.push(...data.users);
        if (data.users.length < 200) break;
      }
      return lista;
    };

    if (acao === "listar") {
      const { data: papeis, error } = await servico.from("lm_papeis").select("user_id, papel, nome, criado_em").order("criado_em");
      if (error) throw error;
      const emails = new Map((await todosUsuarios()).map((u) => [u.id, u.email]));
      return json({ usuarios: (papeis || []).map((p) => ({ ...p, email: emails.get(p.user_id) || "(sem e-mail)", eu: p.user_id === quem.user.id })) });
    }

    if (acao === "criar") {
      const email = String(b.email || "").trim().toLowerCase();
      const senha = String(b.senha || "");
      const nome = String(b.nome || "").trim().slice(0, 80) || null;
      const papel = b.papel === "master" ? "master" : "admin";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: "E-mail inválido" }, 400);

      let id = (await todosUsuarios()).find((u) => (u.email || "").toLowerCase() === email)?.id;
      let jaExistia = !!id;
      if (!id) {
        if (senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres" }, 400);
        const { data, error } = await servico.auth.admin.createUser({ email, password: senha, email_confirm: true });
        if (error) return json({ erro: error.message }, 400);
        id = data.user.id; jaExistia = false;
      }
      const { error: eP } = await servico.from("lm_papeis").upsert({ user_id: id, papel, nome });
      if (eP) throw eP;
      return json({ ok: true, jaExistia });
    }

    if (acao === "remover") {
      const id = String(b.user_id || "");
      if (id === quem.user.id) return json({ erro: "Você não pode remover o seu próprio acesso" }, 400);
      const { error } = await servico.from("lm_papeis").delete().eq("user_id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ erro: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ erro: (e as Error).message || "Erro interno" }, 500);
  }
});
