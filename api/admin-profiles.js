/**
 * Lista todos los perfiles + email (solo correos superadmin, JWT de sesión).
 * Vercel: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Superadmins: variable ADMIN_EMAILS (coma): mateo@pimenton.io,juanchi@pimenton.io
 * Si no definís ADMIN_EMAILS ni ADMIN_EMAIL, se usan por defecto esos dos correos.
 */
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ADMIN_EMAILS = ['mateo@pimenton.io', 'juanchi@pimenton.io'];

function getAdminEmails() {
  const multi = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  if (multi.length) return multi;
  const one = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (one && one.includes('@')) return [one];
  return DEFAULT_ADMIN_EMAILS.slice();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function buildEmailByUserId(supabaseAdmin) {
  const map = new Map();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    for (const u of users) {
      if (u.id && u.email) map.set(u.id, String(u.email).trim());
    }
    if (users.length < perPage) break;
    page += 1;
    if (page > 200) break;
  }
  return map;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminEmails = getAdminEmails();
  if (!adminEmails.length) {
    return res.status(503).json({
      error: 'Configurá ADMIN_EMAILS (correos separados por coma) o ADMIN_EMAIL.',
    });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    return res.status(500).json({ error: 'Falta configuración Supabase en el servidor.' });
  }

  const authHeader = String(req.headers.authorization || '');
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = m ? m[1].trim() : '';
  if (!accessToken) {
    return res.status(401).json({ error: 'Enviá Authorization: Bearer <access_token> de tu sesión.' });
  }

  const anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(accessToken);
  const email = (userData?.user?.email || '').trim().toLowerCase();
  if (userErr || !email) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Volvé a entrar en la calculadora.' });
  }
  if (!adminEmails.includes(email)) {
    return res.status(403).json({ error: 'Este correo no tiene acceso al panel de administración.' });
  }

  try {
    const adminSb = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: rows, error: qErr } = await adminSb
      .from('profiles')
      .select('id, first_name, last_name, phone, phone_normalized, restaurant_name, created_at')
      .order('created_at', { ascending: false });

    if (qErr) throw qErr;

    const emailById = await buildEmailByUserId(adminSb);
    const profiles = (rows || []).map((r) => ({
      id: r.id,
      email: emailById.get(r.id) || '',
      first_name: r.first_name,
      last_name: r.last_name,
      phone: r.phone,
      phone_normalized: r.phone_normalized,
      restaurant_name: r.restaurant_name,
      created_at: r.created_at,
    }));

    return res.status(200).json({ profiles });
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'Error al leer perfiles',
    });
  }
};
