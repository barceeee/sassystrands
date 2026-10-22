// User management for Owner/Admin. Creating users and changing passwords needs the
// service-role key, so it lives here instead of in the browser.
//
// POST { action: "list" }
// POST { action: "create", username, full_name, role, password, email? }
// POST { action: "update", id, full_name?, role?, active? }
// POST { action: "reset_password", id, password }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ROLES = ["OWNER", "ADMIN", "INVENTORY", "PRODUCTION", "QA"];
// Staff sign in with a username; Supabase Auth needs an email, so usernames map to an
// address on a reserved, never-deliverable domain (RFC 2606).
const USERNAME_DOMAIN = "users.sassystrands.invalid";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function callerProfile(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in.");
  const { data: profile } = await admin.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile?.active || !["OWNER", "ADMIN"].includes(profile.role)) {
    throw new HttpError(403, "Only Owner and Admin users can manage users.");
  }
  return profile;
}

function checkPassword(password: unknown) {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters.");
  }
}

async function activeOwnerCount(excludingId?: string) {
  let q = admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "OWNER").eq("active", true);
  if (excludingId) q = q.neq("id", excludingId);
  const { count } = await q;
  return count ?? 0;
}

async function list() {
  const { data: profiles, error } = await admin.from("profiles").select("*").order("full_name");
  if (error) throw error;
  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const byId = new Map((authUsers?.users ?? []).map((u) => [u.id, u]));
  return profiles.map((p) => {
    const u = byId.get(p.id);
    const email = u?.email ?? null;
    return {
      ...p,
      email: email && !email.endsWith("@" + USERNAME_DOMAIN) ? email : null,
      last_sign_in_at: u?.last_sign_in_at ?? null,
    };
  });
}

async function create(body: Record<string, unknown>) {
  const username = String(body.username ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new HttpError(400, "Username: 3–32 characters, letters, numbers, dot, dash or underscore.");
  }
  if (!fullName) throw new HttpError(400, "Full name is required.");
  if (!ROLES.includes(role)) throw new HttpError(400, "Choose a valid role.");
  checkPassword(body.password);
  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) throw new HttpError(409, "That username is already used.");

  const email = String(body.email ?? "").trim().toLowerCase() || `${username}@${USERNAME_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: body.password as string,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
  });
  if (error) throw new HttpError(400, error.message);
  const { error: pErr } = await admin
    .from("profiles")
    .insert({ id: data.user.id, username, full_name: fullName, role, active: true });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new HttpError(400, pErr.message);
  }
  return { id: data.user.id };
}

async function update(caller: { id: string }, body: Record<string, unknown>) {
  const id = String(body.id ?? "");
  const { data: target } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!target) throw new HttpError(404, "User not found.");
  const patch: Record<string, unknown> = {};
  if (body.full_name !== undefined) {
    const name = String(body.full_name).trim();
    if (!name) throw new HttpError(400, "Full name is required.");
    patch.full_name = name;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(String(body.role))) throw new HttpError(400, "Choose a valid role.");
    patch.role = body.role;
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);

  if (id === caller.id && (patch.active === false || (patch.role && patch.role !== target.role))) {
    throw new HttpError(400, "You cannot deactivate yourself or change your own role.");
  }
  const losesOwner = target.role === "OWNER" && target.active && (patch.active === false || (patch.role && patch.role !== "OWNER"));
  if (losesOwner && (await activeOwnerCount(id)) === 0) {
    throw new HttpError(400, "There must always be at least one active Owner.");
  }

  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) throw new HttpError(400, error.message);
  if (patch.active !== undefined) {
    // Banning blocks new sign-ins and token refreshes; has_perm() already ignores inactive users.
    await admin.auth.admin.updateUserById(id, { ban_duration: patch.active ? "none" : "876000h" });
  }
  return { ok: true };
}

async function resetPassword(body: Record<string, unknown>) {
  checkPassword(body.password);
  const { error } = await admin.auth.admin.updateUserById(String(body.id ?? ""), { password: body.password as string });
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const caller = await callerProfile(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "list":
        return json(200, { users: await list() });
      case "create":
        return json(200, await create(body));
      case "update":
        return json(200, await update(caller, body));
      case "reset_password":
        return json(200, await resetPassword(body));
      default:
        return json(400, { error: "Unknown action" });
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json(status, { error: e instanceof Error ? e.message : String(e) });
  }
});
