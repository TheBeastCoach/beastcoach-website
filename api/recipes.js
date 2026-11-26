// Full recipes for signed-in users (GET /api/recipes?id=<recipe id>).
// The caller sends its Supabase access token as "Authorization: Bearer <token>". The token is checked with
// Supabase on the server (userFromToken), and the recipe is read with that same token, so Supabase's row-level
// security on public.recipes_full (see supabase/recipes-full.sql) allows the read only for a signed-in user.
// No token, or a token Supabase does not accept, gets 401 and no recipe data.
const { userFromToken, userRead } = require('./_coaching.js');

function send(res, status, body) { return res.status(status).json(body); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const token = (/^Bearer\s+(\S+)$/.exec((req.headers && req.headers.authorization) || '') || [])[1];
  if (!token) return send(res, 401, { error: 'sign_in', message: 'Sign in to see the full recipe.' });
  let user = null;
  try { user = await userFromToken(token); } catch (e) { user = null; }
  if (!user) return send(res, 401, { error: 'sign_in', message: 'Sign in to see the full recipe.' });
  const id = String((req.query && req.query.id) || '');
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return send(res, 404, { error: 'not_found' });
  let rows = [];
  try { rows = await userRead(token, 'recipes_full?id=eq.' + encodeURIComponent(id) + '&select=data&limit=1'); } catch (e) { rows = []; }
  if (!rows.length || !rows[0].data) return send(res, 404, { error: 'not_found' });
  return send(res, 200, { recipe: rows[0].data });
};
