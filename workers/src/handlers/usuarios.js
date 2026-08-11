// handlers/usuarios.js — Gestión de cuentas de usuario (solo superadmin)
import { query } from '../db.js';
import { hashPassword } from '../auth.js';

const CAMPOS = `
  u.id, u.urbanizacion_id, u.nombre, u.email, u.rol, u.activo,
  u.fecha_expiracion, u.ultimo_login, u.created_at,
  urb.nombre AS urbanizacion_nombre
`;

export async function handleGetAll(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');
  const rows = await query(env, `
    SELECT ${CAMPOS} FROM usuarios u
    LEFT JOIN urbanizaciones urb ON urb.id = u.urbanizacion_id
    ORDER BY u.created_at ASC`);
  return ok(rows);
}

export async function handleCreate(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre, email, password, rol, urbanizacion_id, fecha_expiracion } = body;
  if (!nombre || !email || !password) return err(400, 'Nombre, email y contraseña son obligatorios');
  if (password.length < 8) return err(400, 'La contraseña debe tener al menos 8 caracteres');
  if (!['admin_urb', 'propietario'].includes(rol || '')) return err(400, 'Rol inválido');

  const password_hash = await hashPassword(password);
  try {
    const rows = await query(env, `
      INSERT INTO usuarios (nombre, email, password_hash, rol, urbanizacion_id, fecha_expiracion)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, email, rol, activo, fecha_expiracion, urbanizacion_id`,
      [nombre.trim(), email.toLowerCase().trim(), password_hash, rol, urbanizacion_id || null, fecha_expiracion || null]
    );
    return ok(rows[0], 201);
  } catch (e) {
    if (e.message?.includes('usuarios_email_key')) return err(400, 'Ya existe un usuario con ese email');
    throw e;
  }
}

export async function handleUpdate(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const existentes = await query(env, `SELECT id FROM usuarios WHERE id = $1`, [id]);
  if (!existentes.length) return err(404, 'Usuario no encontrado');

  const sets = [];
  const params = [];
  const push = (sql, val) => { params.push(val); sets.push(` ${sql} = $${params.length}`); };

  if (body.nombre !== undefined) push('nombre', body.nombre.trim());
  if (body.email !== undefined) push('email', body.email.toLowerCase().trim());
  if (body.rol !== undefined) {
    if (!['superadmin', 'admin_urb', 'propietario'].includes(body.rol)) return err(400, 'Rol inválido');
    push('rol', body.rol);
  }
  if (body.urbanizacion_id !== undefined) push('urbanizacion_id', body.urbanizacion_id || null);
  if (body.activo !== undefined) push('activo', !!body.activo);
  if (body.fecha_expiracion !== undefined) push('fecha_expiracion', body.fecha_expiracion || null);
  if (body.password) {
    if (body.password.length < 8) return err(400, 'La contraseña debe tener al menos 8 caracteres');
    push('password_hash', await hashPassword(body.password));
  }

  if (!sets.length) return err(400, 'No hay campos para actualizar');

  setImmediate(() => {});
  const rows = await query(env, `
    UPDATE usuarios SET ${sets.join(',')}, updated_at = NOW()
    WHERE id = $${params.length + 1}
    RETURNING id, nombre, email, rol, activo, fecha_expiracion, urbanizacion_id`,
    [...params, id]
  );
  return ok(rows[0]);
}

export async function handleRevoke(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');
  if (id === user.id) return err(400, 'No puede revocar su propia cuenta');

  const rows = await query(env,
    `UPDATE usuarios SET activo = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, nombre, email, rol, activo`,
    [id]
  );
  if (!rows.length) return err(404, 'Usuario no encontrado');
  return ok(rows[0]);
}

export async function handleReinstate(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  const rows = await query(env,
    `UPDATE usuarios SET activo = TRUE, fecha_expiracion = NULL, updated_at = NOW() WHERE id = $1 RETURNING id, nombre, email, rol, activo, fecha_expiracion`,
    [id]
  );
  if (!rows.length) return err(404, 'Usuario no encontrado');
  return ok(rows[0]);
}

export async function handleDelete(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');
  if (id === user.id) return err(400, 'No puede eliminar su propia cuenta');

  const rows = await query(env,
    `DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre, email`,
    [id]
  );
  if (!rows.length) return err(404, 'Usuario no encontrado');
  return ok(rows[0]);
}

const ok  = (data, status = 200) => Response.json({ ok: true,  data }, { status });
const err = (status, message)    => Response.json({ ok: false, message }, { status });