// handlers/propietarios.js — CRUD propietarios
import { query } from '../db.js';

export async function handleGetAll(request, env, user) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const urbId = user.rol === 'superadmin' ? (url.searchParams.get('urbanizacion_id') || user.urbanizacion_id) : user.urbanizacion_id;

  if (!urbId) return err(400, 'Urbanización no especificada');

  let sql = `SELECT p.*, (
      SELECT pg.comprobante FROM pagos pg
      WHERE pg.propietario_id = p.id AND pg.comprobante IS NOT NULL AND pg.comprobante <> ''
      ORDER BY pg.fecha_pago DESC, pg.created_at DESC LIMIT 1
    ) AS ultimo_comprobante
    FROM propietarios p
    WHERE p.urbanizacion_id = $1`;
  const params = [urbId];

  if (search) {
    sql += ` AND (p.nombre_propietario ILIKE $2 OR p.apartamento ILIKE $2 OR p.no_celda ILIKE $2)`;
    params.push(`%${search}%`);
  }

  sql += ` ORDER BY p.apartamento ASC`;
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

function calcCuota(presupuesto, prop) {
  const hasCelda = !!prop.has_celda;
  const hasCuarto = !!prop.has_cuarto_util;
  const hasApto = !!prop.has_apto || parseFloat(prop.coef_apto) > 0 || (!hasCelda && !hasCuarto);
  const valC = hasCelda ? (parseFloat(prop.valor_celda) || 0) : 0;
  const valQ = hasCuarto ? (parseFloat(prop.valor_cuarto_util) || 0) : 0;
  const coefApto = hasApto ? (parseFloat(prop.coef_apto) || 0) : 0;
  // exclusivo: si hay valor >0, coef de ese inmueble se ignora
  const coefCelda = hasCelda && valC === 0 ? (parseFloat(prop.coef_celda) || 0) : 0;
  const coefCuarto = hasCuarto && valQ === 0 ? (parseFloat(prop.coef_cuarto_util) || 0) : 0;
  const cp = hasApto ? coefApto : 0;
  const suma = cp + coefCelda + coefCuarto;
  let base = 0;
  if (suma > 0 && presupuesto > 0) base = presupuesto * suma / 100;
  else if (!hasCelda && !hasCuarto && !hasApto) base = parseFloat(prop.cuota_admon) || 0;
  else if (suma === 0 && presupuesto > 0) base = 0;
  else base = parseFloat(prop.cuota_admon) || 0;
  return Math.round((base + valC + valQ) * 100) / 100;
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas, prefijo, mes_inicio, anio_inicio, abono_inicial, coef_apto, coef_celda, coef_cuarto_util, valor_celda, valor_cuarto_util, has_celda, has_cuarto_util } = body;
  if (!nombre_propietario || !apartamento) return err(400, 'Nombre y Apartamento son requeridos');

  if (estado === 'moroso' || estado === 'abono_inicial') {
    if (!mes_inicio || !anio_inicio) return err(400, 'Para el estado ' + estado + ' debe indicar el mes y año de inicio');
    if (estado === 'abono_inicial' && (!abono_inicial || parseFloat(abono_inicial) <= 0)) {
      return err(400, 'Para el estado abono_inicial debe indicar un abono inicial mayor a 0');
    }
  }

  const urbId = user.urbanizacion_id;
  if (!urbId) return err(400, 'El usuario no tiene una urbanización asignada');

  // asegurar columnas nuevas existan (por si migración aún no corrió)
  try { await query(env, `SELECT coef_apto FROM propietarios LIMIT 0`); } catch {
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_apto DECIMAL(10,4) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_celda DECIMAL(10,4) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_cuarto_util DECIMAL(10,4) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS valor_celda DECIMAL(12,2) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS valor_cuarto_util DECIMAL(12,2) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS has_celda BOOLEAN DEFAULT FALSE`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS has_cuarto_util BOOLEAN DEFAULT FALSE`);
    await query(env, `ALTER TABLE estados_cuenta ADD COLUMN IF NOT EXISTS valor_apto DECIMAL(12,2) DEFAULT 0`);
    await query(env, `ALTER TABLE estados_cuenta ADD COLUMN IF NOT EXISTS valor_celda DECIMAL(12,2) DEFAULT 0`);
    await query(env, `ALTER TABLE estados_cuenta ADD COLUMN IF NOT EXISTS valor_cuarto_util DECIMAL(12,2) DEFAULT 0`);
  }

  const cuotaManual = parseFloat(cuota_admon) || 0;
  let cuotaTotal = cuotaManual;
  const tieneCoef = (parseFloat(coef_apto)>0 || (has_celda && parseFloat(coef_celda)>0) || (has_cuarto_util && parseFloat(coef_cuarto_util)>0) || (has_celda && parseFloat(valor_celda)>0) || (has_cuarto_util && parseFloat(valor_cuarto_util)>0));
  if (tieneCoef) {
    try {
      const pr = await query(env, `SELECT cuota_admon FROM parametros_anio WHERE urbanizacion_id=$1 AND anio=EXTRACT(YEAR FROM NOW())`, [urbId]);
      const presupuesto = pr.length ? parseFloat(pr[0].cuota_admon) : 0;
      if (presupuesto>0) cuotaTotal = calcCuota(presupuesto, { coef_apto, coef_celda, coef_cuarto_util, valor_celda, valor_cuarto_util, has_celda, has_cuarto_util, cuota_admon: cuotaManual });
      else cuotaTotal = cuotaManual;
    } catch {}
  }
  // asegurar columna cuota_total exista
  try { await query(env, `SELECT cuota_total FROM propietarios LIMIT 0`); } catch { await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS cuota_total DECIMAL(12,2) DEFAULT 0`); }

  try {
    const rows = await query(env,
      `INSERT INTO propietarios (
        urbanizacion_id, nombre_propietario, apartamento, no_celda, 
        cuota_admon, cuota_total, estado, numero_cuenta, modo_pago, telefono, email, notas,
        prefijo, mes_inicio, anio_inicio, abono_inicial,
        coef_apto, coef_celda, coef_cuarto_util, valor_celda, valor_cuarto_util, has_celda, has_cuarto_util
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) RETURNING *`,
      [
        urbId, nombre_propietario, apartamento, no_celda || null, 
        cuotaManual, cuotaTotal, estado || 'activo', numero_cuenta || null, modo_pago || 'efectivo',
        telefono || null, email || null, notas || null,
        prefijo || null, mes_inicio || null, anio_inicio || null, parseFloat(abono_inicial) || 0,
        parseFloat(coef_apto) || 0, parseFloat(coef_celda) || 0, parseFloat(coef_cuarto_util) || 0,
        parseFloat(valor_celda) || 0, parseFloat(valor_cuarto_util) || 0,
        !!has_celda, !!has_cuarto_util
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

  const { nombre_propietario, apartamento, no_celda, cuota_admon, estado, numero_cuenta, modo_pago, telefono, email, notas, prefijo, mes_inicio, anio_inicio, abono_inicial, coef_apto, coef_celda, coef_cuarto_util, valor_celda, valor_cuarto_util, has_celda, has_cuarto_util } = body;

  // asegurar columnas
  try { await query(env, `SELECT coef_apto FROM propietarios LIMIT 0`); } catch {
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_apto DECIMAL(10,4) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_celda DECIMAL(10,4) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_cuarto_util DECIMAL(10,4) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS valor_celda DECIMAL(12,2) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS valor_cuarto_util DECIMAL(12,2) DEFAULT 0`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS has_celda BOOLEAN DEFAULT FALSE`);
    await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS has_cuarto_util BOOLEAN DEFAULT FALSE`);
  }

  if (estado === 'moroso' || estado === 'abono_inicial') {
    if (!mes_inicio || !anio_inicio) return err(400, 'Para el estado ' + estado + ' debe indicar el mes y año de inicio');
    if (estado === 'abono_inicial' && (!abono_inicial || parseFloat(abono_inicial) <= 0)) {
      return err(400, 'Para el estado abono_inicial debe indicar un abono inicial mayor a 0');
    }
  }

  // asegurar cuota_total
  try { await query(env, `SELECT cuota_total FROM propietarios LIMIT 0`); } catch { await query(env, `ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS cuota_total DECIMAL(12,2) DEFAULT 0`); }
  let cuotaManualUpd = cuota_admon;
  let cuotaTotalUpd = undefined;
  const needRecalc = coef_apto !== undefined || coef_celda !== undefined || coef_cuarto_util !== undefined || valor_celda !== undefined || valor_cuarto_util !== undefined || has_celda !== undefined || has_cuarto_util !== undefined || cuota_admon !== undefined;
  if (needRecalc) {
    try {
      const curb = await query(env, `SELECT urbanizacion_id FROM propietarios WHERE id=$1`, [id]);
      const urbId2 = curb[0]?.urbanizacion_id;
      const pr2 = await query(env, `SELECT cuota_admon FROM parametros_anio WHERE urbanizacion_id=$1 AND anio=EXTRACT(YEAR FROM NOW())`, [urbId2]);
      const presupuesto2 = pr2.length ? parseFloat(pr2[0].cuota_admon) : 0;
      const cur = await query(env, `SELECT * FROM propietarios WHERE id=$1`, [id]);
      const curP = cur[0] || {};
      const merged = {
        coef_apto: coef_apto !== undefined ? coef_apto : curP.coef_apto,
        coef_celda: coef_celda !== undefined ? coef_celda : curP.coef_celda,
        coef_cuarto_util: coef_cuarto_util !== undefined ? coef_cuarto_util : curP.coef_cuarto_util,
        valor_celda: valor_celda !== undefined ? valor_celda : curP.valor_celda,
        valor_cuarto_util: valor_cuarto_util !== undefined ? valor_cuarto_util : curP.valor_cuarto_util,
        has_celda: has_celda !== undefined ? has_celda : curP.has_celda,
        has_cuarto_util: has_cuarto_util !== undefined ? has_cuarto_util : curP.has_cuarto_util,
        cuota_admon: cuota_admon !== undefined ? cuota_admon : curP.cuota_admon
      };
      const manual = parseFloat(merged.cuota_admon)||0;
      const tieneCoef2 = (parseFloat(merged.coef_apto)>0 || (merged.has_celda && parseFloat(merged.coef_celda)>0) || (merged.has_cuarto_util && parseFloat(merged.coef_cuarto_util)>0) || (merged.has_celda && parseFloat(merged.valor_celda)>0) || (merged.has_cuarto_util && parseFloat(merged.valor_cuarto_util)>0));
      if (tieneCoef2 && presupuesto2>0) cuotaTotalUpd = calcCuota(presupuesto2, merged);
      else cuotaTotalUpd = manual;
      cuotaManualUpd = manual;
    } catch {}
  }

  const updateRows = await query(env,
    `UPDATE propietarios SET
      nombre_propietario = COALESCE($1, nombre_propietario),
      apartamento = COALESCE($2, apartamento),
      no_celda = $3,
      cuota_admon = COALESCE($4, cuota_admon),
      cuota_total = COALESCE($5, cuota_total),
      estado = COALESCE($6, estado),
      numero_cuenta = $7,
      modo_pago = COALESCE($8, modo_pago),
      telefono = $9,
      email = $10,
      notas = $11,
      prefijo = $12,
      mes_inicio = $13,
      anio_inicio = $14,
      abono_inicial = COALESCE($15, abono_inicial),
      coef_apto = COALESCE($16, coef_apto),
      coef_celda = COALESCE($17, coef_celda),
      coef_cuarto_util = COALESCE($18, coef_cuarto_util),
      valor_celda = COALESCE($19, valor_celda),
      valor_cuarto_util = COALESCE($20, valor_cuarto_util),
      has_celda = COALESCE($21, has_celda),
      has_cuarto_util = COALESCE($22, has_cuarto_util),
      updated_at = NOW()
    WHERE id = $23 RETURNING *`,
    [nombre_propietario || null, apartamento || null, no_celda || null, cuotaManualUpd === undefined ? null : (isNaN(parseFloat(cuotaManualUpd)) ? 0 : parseFloat(cuotaManualUpd)), cuotaTotalUpd === undefined ? null : (isNaN(parseFloat(cuotaTotalUpd)) ? 0 : parseFloat(cuotaTotalUpd)), estado || null, numero_cuenta || null, modo_pago || null, telefono || null, email || null, notas || null, prefijo || null, mes_inicio || null, anio_inicio || null, abono_inicial === undefined ? null : parseFloat(abono_inicial) || 0,
     coef_apto === undefined ? null : parseFloat(coef_apto) || 0,
     coef_celda === undefined ? null : parseFloat(coef_celda) || 0,
     coef_cuarto_util === undefined ? null : parseFloat(coef_cuarto_util) || 0,
     valor_celda === undefined ? null : parseFloat(valor_celda) || 0,
     valor_cuarto_util === undefined ? null : parseFloat(valor_cuarto_util) || 0,
     has_celda === undefined ? null : !!has_celda,
     has_cuarto_util === undefined ? null : !!has_cuarto_util,
     id]
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
    const params = await query(env,
      `SELECT cuota_admon FROM parametros_anio
       WHERE urbanizacion_id = $1 AND anio = $2 LIMIT 1`,
      [prop.urbanizacion_id, cursorAnio]
    );
    const presupuestoAnio = (params.length && parseFloat(params[0].cuota_admon) > 0) ? parseFloat(params[0].cuota_admon) : null;
    let cuota;
    const hasA = !!(parseFloat(prop.coef_apto)>0);
    const hasC = !!prop.has_celda;
    const hasQ = !!prop.has_cuarto_util;
    const valC_ = hasC ? parseFloat(prop.valor_celda)||0 : 0;
    const valQ_ = hasQ ? parseFloat(prop.valor_cuarto_util)||0 : 0;
    const useCoefC = hasC && valC_ === 0;
    const useCoefQ = hasQ && valQ_ === 0;
    if (presupuestoAnio !== null && (hasA || hasC || hasQ)) {
      cuota = calcCuota(presupuestoAnio, { ...prop, has_apto: hasA });
      const cp = hasA ? parseFloat(prop.coef_apto)||0 : 0;
      const cc = useCoefC ? parseFloat(prop.coef_celda)||0 : 0;
      const cq = useCoefQ ? parseFloat(prop.coef_cuarto_util)||0 : 0;
      const vApto = hasA ? presupuestoAnio * cp /100 : 0;
      const vCelda = hasC ? (valC_ > 0 ? valC_ : presupuestoAnio * cc /100) : 0;
      const vCuarto = hasQ ? (valQ_ > 0 ? valQ_ : presupuestoAnio * cq /100) : 0;
      prop._desglose = { vApto: Math.round(vApto*100)/100, vCelda: Math.round(vCelda*100)/100, vCuarto: Math.round(vCuarto*100)/100 };
    } else {
      cuota = parseFloat(prop.cuota_total) || parseFloat(prop.cuota_admon) || 0;
      prop._desglose = { vApto: cuota, vCelda: 0, vCuarto: 0 };
    }

    let created;
    try {
      created = await query(env,
        `INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual, valor_apto, valor_celda, valor_cuarto_util)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (propietario_id, anio, mes) DO NOTHING
         RETURNING *`,
        [prop.id, cursorAnio, cursorMes, cuota, prop._desglose?.vApto||cuota, prop._desglose?.vCelda||0, prop._desglose?.vCuarto||0]
      );
    } catch {
      created = await query(env,
        `INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (propietario_id, anio, mes) DO NOTHING
         RETURNING *`,
        [prop.id, cursorAnio, cursorMes, cuota]
      );
    }
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
