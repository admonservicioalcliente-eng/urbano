// handlers/pagos.js — Registros y visualización de pagos
import { query } from '../db.js';

export async function handleGetAll(request, env, user) {
  const url = new URL(request.url);
  const propId = url.searchParams.get('propietario_id');
  const anio = url.searchParams.get('anio');
  const mes = url.searchParams.get('mes');

  let sql = `
    SELECT pg.*, p.nombre_propietario, p.apartamento
    FROM pagos pg
    JOIN propietarios p ON p.id = pg.propietario_id
    WHERE p.urbanizacion_id = $1
  `;
  const params = [user.urbanizacion_id];
  let paramIdx = 2;

  if (propId) {
    sql += ` AND pg.propietario_id = $${paramIdx++}`;
    params.push(propId);
  }
  if (anio) {
    sql += ` AND EXTRACT(YEAR FROM pg.fecha_pago) = $${paramIdx++}`;
    params.push(anio);
  }
  if (mes) {
    sql += ` AND EXTRACT(MONTH FROM pg.fecha_pago) = $${paramIdx++}`;
    params.push(mes);
  }

  sql += ` ORDER BY pg.fecha_pago DESC, pg.created_at DESC LIMIT 100`;

  const rows = await query(env, sql, params);
  return ok(rows);
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { propietario_id, estado_cuenta_id, monto, fecha_pago, tipo_pago, comprobante, descripcion } = body;
  if (!propietario_id || !monto || !fecha_pago) {
    return err(400, 'Propietario, monto y fecha de pago son obligatorios');
  }

  // Verificar propiedad de la urbanización
  const propRows = await query(env, `SELECT urbanizacion_id, cuota_admon FROM propietarios WHERE id = $1`, [propietario_id]);
  if (!propRows.length) return err(404, 'Propietario no encontrado');
  if (user.rol !== 'superadmin' && propRows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // Auto-generar comprobante
  const anioPago = new Date(fecha_pago).getFullYear();
  const paramRows = await query(env,
    `SELECT prefijo_comprobante, consecutivo_comprobante FROM parametros_anio
     WHERE urbanizacion_id = $1 AND anio = $2`,
    [user.urbanizacion_id, anioPago]
  );

  let comprobanteGenerado;
  if (paramRows.length) {
    const param = paramRows[0];
    const nuevoConsecutivo = (param.consecutivo_comprobante || 0) + 1;
    comprobanteGenerado = `${param.prefijo_comprobante}-${String(nuevoConsecutivo).padStart(4, '0')}`;

    await query(env,
      `UPDATE parametros_anio SET consecutivo_comprobante = $1
       WHERE urbanizacion_id = $2 AND anio = $3`,
      [nuevoConsecutivo, user.urbanizacion_id, anioPago]
    );
  } else {
    comprobanteGenerado = `NAS-0001`;
  }

  // Si no se indicó estado de cuenta, asociar al abierto más antiguo
  // o crear el del mes de la fecha de pago
  let estadoCuentaId = estado_cuenta_id || null;
  if (!estadoCuentaId) {
    const openRows = await query(env,
      `SELECT id FROM estados_cuenta
       WHERE propietario_id = $1 AND cerrado = false
       ORDER BY anio ASC, mes ASC LIMIT 1`,
      [propietario_id]
    );
    if (openRows.length) {
      estadoCuentaId = openRows[0].id;
    } else {
      const pagoDate = new Date(fecha_pago);
      const anioP = pagoDate.getFullYear();
      const mesP = pagoDate.getMonth() + 1;

      const cuotaProp = parseFloat(propRows[0].cuota_admon) || 0;
      const paramCuota = await query(env,
        `SELECT cuota_admon FROM parametros_anio WHERE urbanizacion_id = $1 AND anio = $2`,
        [user.urbanizacion_id, anioP]
      );
      const cuotaMes = (paramCuota.length && parseFloat(paramCuota[0].cuota_admon) > 0)
        ? parseFloat(paramCuota[0].cuota_admon) : cuotaProp;

      const created = await query(env,
        `INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual, saldo_anterior, saldo_favor, intereses, fecha_vencimiento)
         VALUES ($1, $2, $3, $4, $5, 0, 0, $6)
         ON CONFLICT (propietario_id, anio, mes) DO NOTHING
         RETURNING id`,
        [propietario_id, anioP, mesP, cuotaMes, 0, null]
      );
      if (created.length) {
        estadoCuentaId = created[0].id;
      } else {
        const existing = await query(env,
          `SELECT id FROM estados_cuenta WHERE propietario_id = $1 AND anio = $2 AND mes = $3`,
          [propietario_id, anioP, mesP]
        );
        if (existing.length) estadoCuentaId = existing[0].id;
      }
    }
  }

  // Insertar pago
  const pRows = await query(env,
    `INSERT INTO pagos (
      propietario_id, estado_cuenta_id, monto, fecha_pago, tipo_pago, comprobante, descripcion, registrado_por
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [propietario_id, estadoCuentaId, monto, fecha_pago, tipo_pago || 'cuota_regular', comprobanteGenerado, descripcion || null, user.id]
  );

  const pago = pRows[0];

  // Si se asocia a un estado de cuenta, actualizar su distribución
  if (estadoCuentaId) {
    // 1. Obtener estado de cuenta actual
    const ecRows = await query(env, `SELECT * FROM estados_cuenta WHERE id = $1`, [estadoCuentaId]);
    if (ecRows.length) {
      const ec = ecRows[0];
      const totalDeudaActual = parseFloat(ec.pago_actual) + parseFloat(ec.saldo_anterior) + parseFloat(ec.intereses);
      
      // 2. Sumar todos los pagos a este estado de cuenta
      const sumRows = await query(env, `SELECT SUM(monto) as total FROM pagos WHERE estado_cuenta_id = $1`, [estadoCuentaId]);
      const totalPagado = parseFloat(sumRows[0].total) || 0;

      let nuevoSaldoFavor = 0;
      if (totalPagado > 0) {
        nuevoSaldoFavor = totalPagado;
      }

      // 3. Actualizar el estado de cuenta
      await query(env,
        `UPDATE estados_cuenta SET
          saldo_favor = $1,
          cerrado = CASE WHEN $2 >= $3 THEN true ELSE false END
        WHERE id = $4`,
        [nuevoSaldoFavor, totalPagado, totalDeudaActual, estadoCuentaId]
      );
    }
  }

  // ── Auto-actualizar estado del propietario (activo / moroso) ────────────────
  // Obtener sumatoria de deudas pendientes
  const deudaRows = await query(env,
    `SELECT COALESCE(SUM(total_deuda), 0) as deuda
     FROM estados_cuenta
     WHERE propietario_id = $1 AND cerrado = false`,
    [propietario_id]
  );
  const deudaRestante = parseFloat(deudaRows[0].deuda);
  const nuevoEstado = deudaRestante > 0 ? 'moroso' : 'activo';

  await query(env, `UPDATE propietarios SET estado = $1 WHERE id = $2`, [nuevoEstado, propietario_id]);

  return ok(pago, 201);
}

export async function handleDelete(request, env, user, id) {
  if (user.rol !== 'superadmin' && user.rol !== 'admin_urb') {
    return err(403, 'Rol no autorizado para borrar pagos');
  }

  // Obtener pago
  const pRows = await query(env, `SELECT * FROM pagos WHERE id = $1`, [id]);
  if (!pRows.length) return err(404, 'Pago no encontrado');
  const pago = pRows[0];

  // Verificar pertenencia a urbanización
  const propRows = await query(env, `SELECT urbanizacion_id FROM propietarios WHERE id = $1`, [pago.propietario_id]);
  if (user.rol !== 'superadmin' && propRows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // Borrar el pago
  await query(env, `DELETE FROM pagos WHERE id = $1`, [id]);

  // Si estaba asociado a un estado de cuenta, recalcular
  if (pago.estado_cuenta_id) {
    const ecRows = await query(env, `SELECT * FROM estados_cuenta WHERE id = $1`, [pago.estado_cuenta_id]);
    if (ecRows.length) {
      const ec = ecRows[0];
      const totalDeudaActual = parseFloat(ec.pago_actual) + parseFloat(ec.saldo_anterior) + parseFloat(ec.intereses);

      const sumRows = await query(env, `SELECT SUM(monto) as total FROM pagos WHERE estado_cuenta_id = $1`, [pago.estado_cuenta_id]);
      const totalPagado = parseFloat(sumRows[0].total) || 0;

      let nuevoSaldoFavor = 0;
      if (totalPagado > 0) {
        nuevoSaldoFavor = totalPagado;
      }

      await query(env,
        `UPDATE estados_cuenta SET
          saldo_favor = $1,
          cerrado = CASE WHEN $2 >= $3 THEN true ELSE false END
        WHERE id = $4`,
        [nuevoSaldoFavor, totalPagado, totalDeudaActual, pago.estado_cuenta_id]
      );
    }
  }

  // Recalcular estado propietario
  const deudaRows = await query(env,
    `SELECT COALESCE(SUM(total_deuda), 0) as deuda
     FROM estados_cuenta
     WHERE propietario_id = $1 AND cerrado = false`,
    [pago.propietario_id]
  );
  const deudaRestante = parseFloat(deudaRows[0].deuda);
  const nuevoEstado = deudaRestante > 0 ? 'moroso' : 'activo';
  await query(env, `UPDATE propietarios SET estado = $1 WHERE id = $2`, [nuevoEstado, pago.propietario_id]);

  return ok({ message: 'Pago revertido correctamente' });
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
