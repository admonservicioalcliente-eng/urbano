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

  const { nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas, prefijo, mes_inicio, anio_inicio, abono_inicial } = body;
  if (!nombre_propietario || !apartamento) return err(400, 'Nombre y Apartamento son requeridos');

  if (estado === 'moroso' || estado === 'abono_inicial') {
    if (!mes_inicio || !anio_inicio) return err(400, 'Para el estado ' + estado + ' debe indicar el mes y año de inicio');
    if (estado === 'abono_inicial' && (!abono_inicial || parseFloat(abono_inicial) <= 0)) {
      return err(400, 'Para el estado abono_inicial debe indicar un abono inicial mayor a 0');
    }
  }

  const urbId = user.urbanizacion_id;
  if (!urbId) return err(400, 'El usuario no tiene una urbanización asignada');

  try {
    const rows = await query(env,
      `INSERT INTO propietarios (
        urbanizacion_id, nombre_propietario, apartamento, no_celda, 
        cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas,
        prefijo, mes_inicio, anio_inicio, abono_inicial
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        urbId, nombre_propietario, apartamento, no_celda || null, 
        cuota_admon || 0, estado || 'activo', numero_cuenta || null, modo_pago || 'efectivo',
        telefono || null, email || null, notas || null,
        prefijo || null, mes_inicio || null, anio_inicio || null, parseFloat(abono_inicial) || 0
      ]
    );
    const prop = rows[0];

    // Sembrar estado de cuenta desde mes/anio de inicio hasta el mes actual
    await sembrarEstadosInicio(env, prop);

    // El abono inicial puede cambiar el estado a 'activo'; devolver el estado final
    const final = await query(env, `SELECT * FROM propietarios WHERE id = $1`, [prop.id]);

    return ok(final[0], 201);
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

  const { nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas, prefijo, mes_inicio, anio_inicio, abono_inicial } = body;

  if (estado === 'moroso' || estado === 'abono_inicial') {
    if (!mes_inicio || !anio_inicio) return err(400, 'Para el estado ' + estado + ' debe indicar el mes y año de inicio');
    if (estado === 'abono_inicial' && (!abono_inicial || parseFloat(abono_inicial) <= 0)) {
      return err(400, 'Para el estado abono_inicial debe indicar un abono inicial mayor a 0');
    }
  }

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
      prefijo = $11,
      mes_inicio = $12,
      anio_inicio = $13,
      abono_inicial = COALESCE($14, abono_inicial),
      updated_at = NOW()
    WHERE id = $15 RETURNING *`,
    [nombre_propietario || null, apartamento || null, no_celda || null, cuota_admon || null, estado || null, numero_cuenta || null, modo_pago || null, telefono || null, email || null, notas || null, prefijo || null, mes_inicio || null, anio_inicio || null, abono_inicial === undefined ? null : parseFloat(abono_inicial) || 0, id]
  );

  // Si se definió mes/año de inicio, sembrar estados faltantes
  const updated = updateRows[0];
  await sembrarEstadosInicio(env, updated);

  // El abono inicial puede cambiar el estado a 'activo'; devolver el estado final
  const final = await query(env, `SELECT * FROM propietarios WHERE id = $1`, [id]);
  return ok(final[0]);
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

// Crea los estados de cuenta del propietario desde su mes/anio de inicio
// hasta el mes actual inclusive (deuda histórica acumulada).
async function sembrarEstadosInicio(env, prop) {
  const estado = prop.estado;
  const mesInicio = parseInt(prop.mes_inicio);
  const anioInicio = parseInt(prop.anio_inicio);
  if (estado !== 'moroso' && estado !== 'abono_inicial') return;
  if (!mesInicio || !anioInicio) return;

  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;

  let cursorAnio = anioInicio;
  let cursorMes = mesInicio;
  const generados = [];

  while (cursorAnio < anioActual || (cursorAnio === anioActual && cursorMes <= mesActual)) {
    // Cuota del año correspondiente según parámetros (si existe)
    const params = await query(env,
      `SELECT cuota_admon FROM parametros_anio
       WHERE urbanizacion_id = $1 AND anio = $2 LIMIT 1`,
      [prop.urbanizacion_id, cursorAnio]
    );
    const cuota = (params.length && parseFloat(params[0].cuota_admon) > 0)
      ? parseFloat(params[0].cuota_admon)
      : (parseFloat(prop.cuota_admon) || 0);

    const created = await query(env,
      `INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (propietario_id, anio, mes) DO NOTHING
       RETURNING *`,
      [prop.id, cursorAnio, cursorMes, cuota]
    );
    if (created.length) generados.push(created[0]);

    cursorMes++;
    if (cursorMes > 12) { cursorMes = 1; cursorAnio++; }
  }

  // Aplicar abono inicial como pago real vinculado al estado más antiguo.
  // Se registra en la tabla pagos (tipo 'abono') para que conciliarPagos
  // lo mantenga como saldo_favor y la cuenta de cobro lo descuente.
  if (parseFloat(prop.abono_inicial) > 0) {
    const primerEstado = await query(env,
      `SELECT * FROM estados_cuenta
       WHERE propietario_id = $1
       ORDER BY anio ASC, mes ASC LIMIT 1`,
      [prop.id]
    );
    if (primerEstado.length) {
      const yaExiste = await query(env,
        `SELECT id FROM pagos
         WHERE propietario_id = $1 AND tipo_pago = 'abono' AND comprobante = 'ABONO-INICIAL'
         LIMIT 1`,
        [prop.id]
      );
      if (!yaExiste.length) {
        await query(env,
          `INSERT INTO pagos (propietario_id, estado_cuenta_id, monto, fecha_pago, tipo_pago, comprobante, descripcion)
           VALUES ($1, $2, $3, $4, 'abono', 'ABONO-INICIAL', 'Abono inicial registrado')
           ON CONFLICT DO NOTHING`,
          [prop.id, primerEstado[0].id, parseFloat(prop.abono_inicial), prop.created_at ? new Date(prop.created_at).toISOString().slice(0, 10) : null]
        );
      }
      // Sincronizar saldo_favor del primer estado con el total pagado
      const sumPagos = await query(env,
        `SELECT COALESCE(SUM(monto), 0) AS t FROM pagos WHERE estado_cuenta_id = $1`,
        [primerEstado[0].id]
      );
      const totalPagado = parseFloat(sumPagos[0].t) || 0;
      await query(env,
        `UPDATE estados_cuenta SET saldo_favor = $1, cerrado = $2 WHERE id = $3`,
        [totalPagado, totalPagado >= (parseFloat(primerEstado[0].pago_actual) + parseFloat(primerEstado[0].saldo_anterior) + parseFloat(primerEstado[0].intereses)), primerEstado[0].id]
      );
    }
    // El abono inicial ya se causó: el propietario pasa a estado activo
    await query(env, `UPDATE propietarios SET estado = 'activo' WHERE id = $1 AND estado = 'abono_inicial'`, [prop.id]);
  }

  return generados;
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
