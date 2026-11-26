// Full recipes for signed-in users (GET /api/recipes?id=<recipe id>).
// The caller sends its Supabase access token as "Authorization: Bearer <token>". The token is checked with
// Supabase on the server (userFromToken). Any free account counts as signed in. No token, or a token Supabase
// does not accept, gets 401 and no recipe data. The recipe data lives in api/_recipes-full.js, which is not
// served as a file.
const { userFromToken } = require('./_coaching.js');
const RECIPES = require('./_recipes-full.js');

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
  const recipe = RECIPES.find(r => r.id === id);
  if (!recipe) return send(res, 404, { error: 'not_found' });
  return send(res, 200, { recipe });
};
