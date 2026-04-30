/**
 * Registro sin correo: crea usuario confirmado y devuelve tokens.
 * Si el correo ya existe, actualiza perfil + contraseña temporal y entra igual.
 *
 * Supabase: Authentication → Providers → Email debe permitir login con CONTRASEÑA
 * (no solo magic link / OTP), o el paso passwordGrant falla.
 */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const readJsonBody = require('./lib/parse-body');

function normalizePhone(input) {
  return String(input || '').replace(/\D/g, '');
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

async function passwordGrant(url, anonKey, email, password) {
  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  return { ok: tokenRes.ok, tokens };
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
    return res.status(400).json({ error: 'JSON inválido en el cuerpo del POST' });
  }

  const first_name = String(body.first_name || '').trim();
  const last_name = String(body.last_name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const restaurant_name = String(body.restaurant_name || '').trim();

  if (!first_name || !last_name || !phone || !email || !restaurant_name) {
    return res.status(400).json({ error: 'Completá todos los campos' });
  }
  if (!email.includes('@')) return res.status(400).json({ error: 'Correo inválido' });
  const pNorm = normalizePhone(phone);
  if (pNorm.length < 10) return res.status(400).json({
    error: 'Celular incompleto: incluí código de país (ej. +57 300 1234567)',
  });

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const meta = { first_name, last_name, phone, restaurant_name };
  const tempPass = `beta_${crypto.randomBytes(32).toString('base64url')}`;

  const { data: created, error: creErr } = await supabase.auth.admin.createUser({
    email,
    password: tempPass,
    email_confirm: true,
    user_metadata: meta,
  });

  let loginEmail = email;

  if (!creErr && created?.user) {
    loginEmail = created.user.email || email;
  } else {
    const existing = await findUserByEmail(supabase, email).catch(() => null);
    if (!existing) {
      const msg = [
        creErr?.message,
        creErr?.code,
        typeof creErr === 'object' ? JSON.stringify(creErr) : '',
      ]
        .filter(Boolean)
        .join(' — ');
      return res.status(400).json({
        error:
          msg ||
          'No se pudo crear la cuenta. Si el celular ya está en uso con otro correo, probá otro número o correo.',
      });
    }
    const prevMeta = existing.user_metadata || {};
    await supabase.auth.admin.updateUserById(existing.id, {
      password: tempPass,
      user_metadata: { ...prevMeta, ...meta },
    });
    const { error: upErr } = await supabase.from('profiles').upsert(
      {
        id: existing.id,
        first_name,
        last_name,
        phone,
        phone_normalized: pNorm,
        restaurant_name,
      },
      { onConflict: 'id' }
    );
    if (upErr) {
      return res.status(500).json({ error: upErr.message || 'Error al actualizar perfil' });
    }
    loginEmail = existing.email;
  }

  const { ok, tokens } = await passwordGrant(url, anonKey, loginEmail, tempPass);
  if (!ok) {
    const hint =
      'Si el error menciona "password" o "grant", en Supabase → Authentication → Providers → Email ' +
      'activá el inicio de sesión con contraseña (no solo enlace / OTP).';
    const raw =
      tokens.error_description ||
      tokens.error ||
      tokens.msg ||
      (typeof tokens === 'string' ? tokens : JSON.stringify(tokens));
    return res.status(502).json({
      error: `No se pudo abrir sesión: ${raw}. ${hint}`,
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
