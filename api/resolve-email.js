const { createClient } = require('@supabase/supabase-js');
const readJsonBody = require('./lib/parse-body');

function normalizePhone(input) {
  return String(input || '').replace(/\D/g, '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  const identifier = body && body.identifier != null ? String(body.identifier).trim() : '';
  if (!identifier || identifier.includes('@')) {
    return res.status(400).json({ error: 'Envío solo para celular sin @' });
  }

  const phoneNorm = normalizePhone(identifier);
  if (phoneNorm.length < 10) {
    return res.status(400).json({
      error: 'Incluí código de país en el celular (ej. +57 …)',
    });
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_normalized', phoneNorm)
    .maybeSingle();

  if (pErr || !profile) {
    return res.status(404).json({ error: 'No encontramos ese celular' });
  }

  const { data: adminData, error: aErr } = await supabase.auth.admin.getUserById(profile.id);
  if (aErr || !adminData?.user?.email) {
    return res.status(404).json({ error: 'No encontramos ese celular' });
  }

  return res.status(200).json({ email: adminData.user.email });
};
