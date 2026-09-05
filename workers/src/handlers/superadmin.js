// handlers/superadmin.js — Gestión de urbanizaciones admitidas/rechazadas
import { query } from '../db.js';
import { hashPassword } from '../auth.js';

export async function handleRegistroUrbanizacion(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre, direccion, telefono, email, prefijo_doc, admin_nombre, admin_email, admin_password, logo_base64 } = body;
  if (!nombre) return err(400, 'El nombre de la urbanización es obligatorio');
  if (!admin_nombre || !admin_email || !admin_password) return err(400, 'Nombre, email y contraseña del administrador son obligatorios');
  if (admin_password.length < 8) return err(400, 'La contraseña debe tener al menos 8 caracteres');

  const password_hash = await hashPassword(admin_password);

  try {
    const existing = await query(env, `SELECT id FROM usuarios WHERE email = $1`, [admin_email.toLowerCase().trim()]);
    if (existing.length) return err(400, 'Ya existe un usuario con ese email');

    const urb = await query(env,
      `INSERT INTO urbanizaciones (nombre, direccion, telefono, email, estado, prefijo_doc, logo_base64)
       VALUES ($1, $2, $3, $4, 'pendiente', $5, $6) RETURNING *`,
      [nombre.trim(), direccion || null, telefono || null, email || null, (prefijo_doc || 'NAS').toUpperCase().substring(0, 10), logo_base64 || null]
    );

    const usr = await query(env,
      `INSERT INTO usuarios (nombre, email, password_hash, rol, urbanizacion_id, activo)
       VALUES ($1, $2, $3, 'admin_urb', $4, TRUE)
       RETURNING id, nombre, email, rol, activo, urbanizacion_id`,
      [admin_nombre.trim(), admin_email.toLowerCase().trim(), password_hash, urb[0].id]
    );

    return ok({ urbanizacion: urb[0], usuario: usr[0] }, 201);
  } catch (ex) {
    if (ex.message?.includes('usuarios_email_key')) return err(400, 'Ya existe un usuario con ese email');
    return err(500, ex.message);
  }
}

export async function handleGetUrbanizaciones(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');
  const rows = await query(env, `SELECT * FROM urbanizaciones ORDER BY nombre ASC`);
  return ok(rows);
}

export async function handleCreateUrbanizacion(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre, direccion, nit, telefono, email, prefijo_doc, 
          banco_numero_cuenta, banco_tipo_cuenta, banco_titular, banco_celular } = body;
  if (!nombre) return err(400, 'El nombre de la urbanización es obligatorio');

  const rows = await query(env,
    `INSERT INTO urbanizaciones (nombre, direccion, nit, telefono, email, estado, prefijo_doc,
                                banco_numero_cuenta, banco_tipo_cuenta, banco_titular, banco_celular)
     VALUES ($1, $2, $3, $4, $5, 'pendiente', $6, $7, $8, $9, $10) RETURNING *`,
    [nombre, direccion, nit, telefono, email, prefijo_doc || 'NAS',
     banco_numero_cuenta, banco_tipo_cuenta || 'ahorros', banco_titular, banco_celular]
  );
  return ok(rows[0], 201);
}

export async function handleUpdateEstado(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { estado } = body;
  if (!estado || !['admitida', 'rechazada', 'pendiente'].includes(estado)) {
    return err(400, 'Estado inválido. Debe ser admitida, rechazada o pendiente');
  }

  const rows = await query(env,
    `UPDATE urbanizaciones SET estado = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [estado, id]
  );

  if (!rows.length) return err(404, 'Urbanización no encontrada');
  return ok(rows[0]);
}

export async function handleGetStats(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  const urbs = await query(env, `SELECT COUNT(*) FROM urbanizaciones`);
  const users = await query(env, `SELECT COUNT(*) FROM usuarios`);
  const props = await query(env, `SELECT COUNT(*) FROM propietarios`);

  return ok({
    total_urbanizaciones: parseInt(urbs[0].count) || 0,
    total_usuarios: parseInt(users[0].count) || 0,
    total_propietarios: parseInt(props[0].count) || 0
  });
}

export async function handleUpdateLogo(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { logo_base64 } = body;
  if (logo_base64 && logo_base64.length > 1000000) {
    return err(400, 'El logo no debe exceder 700 KB');
  }

  const rows = await query(env,
    `UPDATE urbanizaciones SET logo_base64 = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [logo_base64 || null, id]
  );

  if (!rows.length) return err(404, 'Urbanización no encontrada');
  return ok(rows[0]);
}

export async function handleUpdateUrbanizacion(request, env, user, id) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre, direccion, nit, telefono, email, prefijo_doc,
          banco_numero_cuenta, banco_tipo_cuenta, banco_titular, banco_celular } = body;

  // Construir SET dinámico solo con campos definidos
  const updates = [];
  const values = [];
  let idx = 1;

  if (nombre !== undefined) { updates.push(`nombre = $${idx++}`); values.push(nombre); }
  if (direccion !== undefined) { updates.push(`direccion = $${idx++}`); values.push(direccion); }
  if (nit !== undefined) { updates.push(`nit = $${idx++}`); values.push(nit); }
  if (telefono !== undefined) { updates.push(`telefono = $${idx++}`); values.push(telefono); }
  if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(email); }
  if (prefijo_doc !== undefined) { updates.push(`prefijo_doc = $${idx++}`); values.push(prefijo_doc); }
  if (banco_numero_cuenta !== undefined) { updates.push(`banco_numero_cuenta = $${idx++}`); values.push(banco_numero_cuenta); }
  if (banco_tipo_cuenta !== undefined) { updates.push(`banco_tipo_cuenta = $${idx++}`); values.push(banco_tipo_cuenta); }
  if (banco_titular !== undefined) { updates.push(`banco_titular = $${idx++}`); values.push(banco_titular); }
  if (banco_celular !== undefined) { updates.push(`banco_celular = $${idx++}`); values.push(banco_celular); }

  if (updates.length === 0) return err(400, 'No hay campos para actualizar');

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const rows = await query(env,
    `UPDATE urbanizaciones SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  if (!rows.length) return err(404, 'Urbanización no encontrada');
  return ok(rows[0]);
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
