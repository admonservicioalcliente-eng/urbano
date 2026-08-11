// handlers/auth.js — Login, me, change-password endpoints
import { query } from '../db.js';
import { createToken, verifyToken, verifyPassword, hashPassword } from '../auth.js';

/**
 * POST /api/auth/login
 * Body: { email, password, cf_token }
 */
export async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON body'); }

  const { email, password, cf_token, urb_id } = body;
  if (!email || !password) return err(400, 'Email y contraseña requeridos');
  if (!urb_id) return err(400, 'Debe seleccionar la urbanización');

  // ── Turnstile verification (optional) ──────────────────────────────────────
  if (env.TURNSTILE_SECRET_KEY && cf_token && cf_token !== 'dummy_token') {
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${env.TURNSTILE_SECRET_KEY}&response=${cf_token}`
    });
    const tsData = await tsRes.json();
    if (!tsData.success) return err(403, 'Verificación de seguridad fallida. Recargue la página.');
  }

  // ── Fetch user ──────────────────────────────────────────────────────────────
  const rows = await query(env,
    `SELECT id, nombre, email, password_hash, rol, urbanizacion_id, activo, fecha_expiracion
     FROM usuarios WHERE email = $1 LIMIT 1`,
    [email.toLowerCase().trim()]
  );
  if (!rows.length) return err(401, 'Credenciales incorrectas');
  const user = rows[0];

  if (!user.activo) return err(403, 'Cuenta revocada por el administrador. Contacte al administrador.');
  if (user.fecha_expiracion && new Date(user.fecha_expiracion) < new Date()) {
    return err(403, 'Registro vencido. Contacte al administrador para renovar la cuenta.');
  }

  // Validar que la cuenta pertenezca a la urbanización seleccionada.
  // El superadmin puede elegir cualquier urbanización del listado.
  if (user.rol !== 'superadmin' && user.urbanizacion_id !== urb_id) {
    return err(403, 'La cuenta no pertenece a la urbanización seleccionada.');
  }
  const urbanizacionId = user.rol === 'superadmin' ? urb_id : user.urbanizacion_id;

  // Validar que la urbanización esté admitida (las registradas quedan pendientes
  // de aprobación por el SUPERADMIN)
  if (user.rol !== 'superadmin') {
    const urbRows = await query(env, `SELECT estado FROM urbanizaciones WHERE id = $1`, [urbanizacionId]);
    if (!urbRows.length) return err(403, 'Urbanización no encontrada.');
    if (urbRows[0].estado !== 'admitida') {
      return err(403, 'Su urbanización está pendiente de aprobación por el SUPERADMIN. Espere a que sea admitida.');
    }
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return err(401, 'Credenciales incorrectas');

  // ── Update last login ───────────────────────────────────────────────────────
  await query(env, `UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1`, [user.id]);

  // ── Generate JWT ────────────────────────────────────────────────────────────
  const token = await createToken({
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    rol: user.rol,
    urbanizacion_id: urbanizacionId
  }, env.JWT_SECRET);

  return ok({ token, user: { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol, urbanizacion_id: urbanizacionId } });
}

/**
 * GET /api/auth/me
 */
export async function handleMe(request, env, user) {
  const rows = await query(env,
    `SELECT u.id, u.nombre, u.email, u.rol, u.urbanizacion_id, urb.nombre AS urbanizacion_nombre
     FROM usuarios u LEFT JOIN urbanizaciones urb ON urb.id = u.urbanizacion_id
     WHERE u.id = $1`,
    [user.id]
  );
  if (!rows.length) return err(404, 'Usuario no encontrado');
  return ok(rows[0]);
}

/**
 * POST /api/auth/change-password
 * Body: { current_password, new_password }
 */
export async function handleChangePassword(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON'); }
  const { current_password, new_password } = body;
  if (!current_password || !new_password) return err(400, 'Se requieren ambas contraseñas');
  if (new_password.length < 8) return err(400, 'La nueva contraseña debe tener al menos 8 caracteres');

  const rows = await query(env, `SELECT password_hash FROM usuarios WHERE id = $1`, [user.id]);
  if (!rows.length) return err(404, 'Usuario no encontrado');

  const valid = await verifyPassword(current_password, rows[0].password_hash);
  if (!valid) return err(401, 'Contraseña actual incorrecta');

  const newHash = await hashPassword(new_password);
  await query(env, `UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, user.id]);
  return ok({ message: 'Contraseña actualizada correctamente' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok  = (data, status = 200) => Response.json({ ok: true,  data },   { status });
const err = (status, message)    => Response.json({ ok: false, message }, { status });
