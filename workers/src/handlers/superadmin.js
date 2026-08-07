// handlers/superadmin.js — Gestión de urbanizaciones admitidas/rechazadas
import { query } from '../db.js';

export async function handleGetUrbanizaciones(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');
  const rows = await query(env, `SELECT * FROM urbanizaciones ORDER BY nombre ASC`);
  return ok(rows);
}

export async function handleCreateUrbanizacion(request, env, user) {
  if (user.rol !== 'superadmin') return err(403, 'Acceso denegado');

  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre, direccion, nit, telefono, email, prefijo_doc } = body;
  if (!nombre) return err(400, 'El nombre de la urbanización es obligatorio');

  const rows = await query(env,
    `INSERT INTO urbanizaciones (nombre, direccion, nit, telefono, email, estado, prefijo_doc)
     VALUES ($1, $2, $3, $4, $5, 'pendiente', $6) RETURNING *`,
    [nombre, direccion, nit, telefono, email, prefijo_doc || 'NAS']
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

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
