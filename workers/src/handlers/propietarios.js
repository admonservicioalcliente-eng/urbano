// handlers/propietarios.js — CRUD propietarios
import { query } from '../db.js';

export async function handleGetAll(request, env, user) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const urbId = user.rol === 'superadmin' ? (url.searchParams.get('urbanizacion_id') || user.urbanizacion_id) : user.urbanizacion_id;

  if (!urbId) return err(400, 'Urbanización no especificada');

  let sql = `SELECT * FROM propietarios WHERE urbanizacion_id = $1`;
  const params = [urbId];

  if (search) {
    sql += ` AND (nombre_propietario ILIKE $2 OR apartamento ILIKE $2 OR no_celda ILIKE $2)`;
    params.push(`%${search}%`);
  }

  sql += ` ORDER BY apartamento ASC`;
  const rows = await query(env, sql, params);
  return ok(rows);
}

export async function handleGetOne(request, env, user, id) {
  const rows = await query(env, `SELECT * FROM propietarios WHERE id = $1`, [id]);
  if (!rows.length) return err(404, 'Propietario no encontrado');
  
  const prop = rows[0];
  if (user.rol !== 'superadmin' && prop.urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }
  return ok(prop);
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas } = body;
  if (!nombre_propietario || !apartamento) return err(400, 'Nombre y Apartamento son requeridos');

  const urbId = user.urbanizacion_id;
  if (!urbId) return err(400, 'El usuario no tiene una urbanización asignada');

  try {
    const rows = await query(env,
      `INSERT INTO propietarios (
        urbanizacion_id, nombre_propietario, apartamento, no_celda, 
        cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        urbId, nombre_propietario, apartamento, no_celda, 
        cuota_admon || 0, estado || 'activo', numero_cuenta, modo_pago || 'efectivo',
        telefono, email, notas
      ]
    );
    return ok(rows[0], 201);
  } catch (ex) {
    if (ex.message.includes('unique') || ex.message.includes('violates unique constraint')) {
      return err(400, 'El apartamento ya está registrado');
    }
    return err(500, ex.message);
  }
}

export async function handleUpdate(request, env, user, id) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const rows = await query(env, `SELECT urbanizacion_id FROM propietarios WHERE id = $1`, [id]);
  if (!rows.length) return err(404, 'Propietario no encontrado');
  if (user.rol !== 'superadmin' && rows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  const { nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas } = body;

  const updateRows = await query(env,
    `UPDATE propietarios SET
      nombre_propietario = COALESCE($1, nombre_propietario),
      apartamento = COALESCE($2, apartamento),
      no_celda = $3,
      cuota_admon = COALESCE($4, cuota_admon),
      estado = COALESCE($5, estado),
      numero_cuenta = $6,
      modo_pago = COALESCE($7, modo_pago),
      telefono = $8,
      email = $9,
      notas = $10,
      updated_at = NOW()
    WHERE id = $11 RETURNING *`,
    [nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas, id]
  );

  return ok(updateRows[0]);
}

export async function handleDelete(request, env, user, id) {
  const rows = await query(env, `SELECT urbanizacion_id FROM propietarios WHERE id = $1`, [id]);
  if (!rows.length) return err(404, 'Propietario no encontrado');
  if (user.rol !== 'superadmin' && rows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // Verificar si tiene pagos asociados
  const countPagos = await query(env, `SELECT COUNT(*) FROM pagos WHERE propietario_id = $1`, [id]);
  const hasPagos = parseInt(countPagos[0].count) > 0;

  if (hasPagos) {
    // Si tiene pagos, mejor pasarlo a estado 'inactivo' para preservar historia financiera
    await query(env, `UPDATE propietarios SET estado = 'inactivo', updated_at = NOW() WHERE id = $1`, [id]);
    return ok({ message: 'El propietario tiene pagos y fue marcado como inactivo' });
  } else {
    // Si no tiene pagos, borrar físicamente
    await query(env, `DELETE FROM propietarios WHERE id = $1`, [id]);
    return ok({ message: 'Propietario eliminado correctamente' });
  }
}

export async function handleResumen(request, env, user, id) {
  const rows = await query(env, `SELECT urbanizacion_id FROM propietarios WHERE id = $1`, [id]);
  if (!rows.length) return err(404, 'Propietario no encontrado');
  if (user.rol !== 'superadmin' && rows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  const estados = await query(env,
    `SELECT * FROM estados_cuenta 
     WHERE propietario_id = $1 
     ORDER BY anio DESC, mes DESC LIMIT 12`,
    [id]
  );
  return ok(estados);
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
