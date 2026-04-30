/**
 * BETA / captura de datos — sin seguridad real:
 * cualquiera que conozca un correo o celular registrado obtiene sesión.
 * Requiere en Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const readJsonBody = require('./lib/parse-body');

function normalizePhone(input) {
  return String(input || '').replace(/\D/g, '');
}

async function resolveEmailFromIdentifier(supabase, identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return id.trim().toLowerCase();
  const phoneNorm = normalizePhone(id);
  if (phoneNorm.length < 10) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_normalized', phoneNorm)
    .maybeSingle();
  if (!profile) return null;
  const { data: adminData, error } = await supabase.auth.admin.getUserById(profile.id);
  if (error || !adminData?.user?.email) return null;
  return adminData.user.email.trim().toLowerCase();
}

async function findUserByEmail(supabase, email) {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u) => (u.email || '').toLowerCase() === target);
    if (found) return found;
    if (users.length < perPage) return null;
    page += 1;
    if (page > 50) return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    return res.status(500).json({ error: 'Falta SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  const identifier = body && body.identifier != null ? String(body.identifier).trim() : '';
  if (!identifier) return res.status(400).json({ error: 'Falta correo o celular' });

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let email;
  try {
    email = await resolveEmailFromIdentifier(supabase, identifier);
  } catch {
    return res.status(500).json({ error: 'Error al resolver identificador' });
  }
  if (!email) return res.status(404).json({ error: 'No encontramos ese correo o celular' });

  let user;
  try {
    user = await findUserByEmail(supabase, email);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error buscando usuario' });
  }
  if (!user?.email) return res.status(404).json({ error: 'No encontramos ese correo o celular' });

  const tempPass = `beta_${crypto.randomBytes(32).toString('base64url')}`;

  const { error: updErr } = await supabase.auth.admin.updateUserById(user.id, {
    password: tempPass,
  });
  if (updErr) return res.status(500).json({ error: updErr.message });

  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email: user.email, password: tempPass }),
  });

  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return res.status(502).json({
      error: tokens.error_description || tokens.error || JSON.stringify(tokens) || 'No se pudo abrir sesión',
    });
  }

  return res.status(200).json({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    expires_at: tokens.expires_at,
    token_type: tokens.token_type,
  });
};
