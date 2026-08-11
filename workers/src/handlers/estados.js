// handlers/estados.js — Estados de cuenta & dashboard
import { query } from '../db.js';

// Concilia los pagos registrados del propietario con sus estados de cuenta:
// vincula pagos sin estado asociado y recalcula saldo_aplicado / cerrado.
async function conciliarPagos(env, propietarioId) {
  // 1. Vincular pagos huérfanos al estado abierto más antiguo
  const unlinked = await query(env,
    `SELECT * FROM pagos
     WHERE propietario_id = $1 AND estado_cuenta_id IS NULL
     ORDER BY fecha_pago ASC, created_at ASC`,
    [propietarioId]
  );

  for (const pg of unlinked) {
    // El pago se aplica a la deuda más antigua (FIFO)
    const openRows = await query(env,
      `SELECT id FROM estados_cuenta
       WHERE propietario_id = $1 AND cerrado = false
       ORDER BY anio ASC, mes ASC LIMIT 1`,
      [propietarioId]
    );
    let ecId;
    if (openRows.length) {
      ecId = openRows[0].id;
    } else {
      const fd = new Date(pg.fecha_pago);
      const anioP = fd.getFullYear();
      const mesP = fd.getMonth() + 1;
      const propRow = await query(env, `SELECT cuota_admon, urbanizacion_id FROM propietarios WHERE id = $1`, [propietarioId]);
      const paramCuota = await query(env,
        `SELECT cuota_admon FROM parametros_anio
         WHERE urbanizacion_id = $1 AND anio = $2 LIMIT 1`,
        [propRow[0].urbanizacion_id, anioP]
      );
      const cuota = (paramCuota.length && parseFloat(paramCuota[0].cuota_admon) > 0)
        ? parseFloat(paramCuota[0].cuota_admon) : (parseFloat(propRow[0].cuota_admon) || 0);

      const created = await query(env,
        `INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual, saldo_anterior, saldo_favor, intereses, fecha_vencimiento)
         VALUES ($1, $2, $3, $4, 0, 0, 0, $5)
         ON CONFLICT (propietario_id, anio, mes) DO NOTHING
         RETURNING id`,
        [propietarioId, anioP, mesP, cuota, null]
      );
      if (created.length) {
        ecId = created[0].id;
      } else {
        const existing = await query(env,
          `SELECT id FROM estados_cuenta WHERE propietario_id = $1 AND anio = $2 AND mes = $3`,
          [propietarioId, anioP, mesP]
        );
        if (existing.length) ecId = existing[0].id;
      }
    }
    if (ecId) {
      await query(env, `UPDATE pagos SET estado_cuenta_id = $1 WHERE id = $2`, [ecId, pg.id]);
    }
  }

  // 2. Recalcular cada estado con sus pagos vinculados
  const estados = await query(env,
    `SELECT * FROM estados_cuenta WHERE propietario_id = $1 ORDER BY anio ASC, mes ASC`,
    [propietarioId]
  );
  for (const ec of estados) {
    const base = parseFloat(ec.pago_actual) + parseFloat(ec.saldo_anterior) + parseFloat(ec.intereses);
    const sumP = await query(env,
      `SELECT COALESCE(SUM(monto), 0) t FROM pagos WHERE estado_cuenta_id = $1`,
      [ec.id]
    );
    const paid = parseFloat(sumP[0].t) || 0;
    await query(env,
      `UPDATE estados_cuenta SET saldo_favor = $1, cerrado = $2 WHERE id = $3`,
      [paid, paid >= base, ec.id]
    );
  }
}

export async function handleGetByPropietario(request, env, user) {
  const url = new URL(request.url);
  const propId = url.searchParams.get('propietario_id');
  const anio = url.searchParams.get('anio') || new Date().getFullYear().toString();

  if (!propId) return err(400, 'ID de propietario requerido');

  // Validar pertenencia
  const propRows = await query(env, `SELECT urbanizacion_id, estado, cuota_admon FROM propietarios WHERE id = $1`, [propId]);
  if (!propRows.length) return err(404, 'Propietario no encontrado');
  if (user.rol !== 'superadmin' && propRows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // Reconciliar pagos y recalcular intereses proporcionales al día antes de mostrar
  await conciliarPagos(env, propId);
  await query(env, `SELECT actualizar_intereses_propietario($1)`, [propId]);
  await conciliarPagos(env, propId);

  // Traer los estados de cuenta del año
  const estados = await query(env,
    `SELECT * FROM estados_cuenta
     WHERE propietario_id = $1 AND anio = $2
     ORDER BY mes ASC`,
    [propId, parseInt(anio)]
  );

  // Mes en curso: si no existe su estado, se considera deuda vigente
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  let virtualMesActual = false;

  if (parseInt(anio) === anioActual && propRows[0].estado !== 'inactivo') {
    const yaTieneMes = estados.some(e => parseInt(e.mes) === mesActual);
    if (!yaTieneMes) {
      const params = await query(env,
        `SELECT cuota_admon FROM parametros_anio
         WHERE urbanizacion_id = $1 AND anio = $2 LIMIT 1`,
        [propRows[0].urbanizacion_id, anioActual]
      );
      const cuota = (params.length && parseFloat(params[0].cuota_admon) > 0)
        ? parseFloat(params[0].cuota_admon)
        : (parseFloat(propRows[0].cuota_admon) || 0);

      virtualMesActual = true;
      estados.push({
        id: null,
        propietario_id: propId,
        anio: anioActual,
        mes: mesActual,
        pago_actual: cuota,
        saldo_anterior: 0,
        saldo_favor: 0,
        intereses: 0,
        total_deuda: cuota,
        fecha_vencimiento: null,
        generado_at: null,
        cerrado: false,
        notas: null,
        dias_mora: 0
      });
    }
  }

  // Totales reales de TODOS los estados del propietario (todos los años):
  // cargos causados mes a mes MENOS los abonos/pagos aplicados (los abonos del
  // mes actual se aplican a la deuda más antigua y se descuentan del total).
  const totals = await query(env,
    `SELECT
       COALESCE(SUM(pago_actual + saldo_anterior + intereses), 0) AS total_cargos,
       COALESCE(SUM(saldo_favor), 0) AS total_saldo_favor,
       COUNT(CASE WHEN cerrado = false AND total_deuda > 0 THEN 1 END) AS meses_pendientes
     FROM estados_cuenta
     WHERE propietario_id = $1`,
    [propId]
  );
  let totalCargos = parseFloat(totals[0].total_cargos) || 0;
  if (virtualMesActual) totalCargos += parseFloat(estados[estados.length - 1].pago_actual) || 0;
  const totalSaldoFavor = parseFloat(totals[0].total_saldo_favor) || 0;
  const totalDeudaActual = Math.max(0, Math.round((totalCargos - totalSaldoFavor) * 100) / 100);
  const mesesPendientes = parseInt(totals[0].meses_pendientes) || 0;

  return ok({
    estados,
    totales: {
      total_deuda_actual: totalDeudaActual,
      total_saldo_favor: totalSaldoFavor,
      meses_pendientes: virtualMesActual ? mesesPendientes + 1 : mesesPendientes
    }
  });
}

export async function handleUpdateIntereses(request, env, user) {
  // Recalcula intereses de todos los propietarios de la urbanización
  const openEcs = await query(env,
    `SELECT ec.id 
     FROM estados_cuenta ec
     JOIN propietarios p ON p.id = ec.propietario_id
     WHERE p.urbanizacion_id = $1 AND ec.cerrado = false`,
    [user.urbanizacion_id]
  );

  let updatedCount = 0;
  for (const ec of openEcs) {
    await query(env,
      `UPDATE estados_cuenta SET 
        intereses = COALESCE((SELECT calcular_intereses($1)), 0)
       WHERE id = $1`,
      [ec.id]
    );
    updatedCount++;
  }

  return ok({ updated: updatedCount, message: 'Intereses actualizados correctamente' });
}

export async function handleGetDashboard(request, env, user) {
  const urbId = user.urbanizacion_id;
  if (!urbId) return err(400, 'El usuario no tiene una urbanización asignada');

  // 1. Propietarios totales y morosos
  const props = await query(env,
    `SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN estado = 'moroso' THEN 1 END) AS morosos,
      COUNT(CASE WHEN estado = 'activo' THEN 1 END) AS activos
     FROM propietarios
     WHERE urbanizacion_id = $1`,
    [urbId]
  );

  // 2. Recaudado en el mes actual
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  const rec = await query(env,
    `SELECT COALESCE(SUM(monto), 0) AS recaudado
     FROM pagos pg
     JOIN propietarios p ON p.id = pg.propietario_id
     WHERE p.urbanizacion_id = $1 
       AND EXTRACT(MONTH FROM pg.fecha_pago) = $2
       AND EXTRACT(YEAR FROM pg.fecha_pago) = $3`,
    [urbId, mesActual, anioActual]
  );

  // 3. Deuda total acumulada en la urbanización (cargos netos menos pagos)
  const deuda = await query(env,
    `SELECT COALESCE(SUM(ec.pago_actual + ec.saldo_anterior + ec.intereses - ec.saldo_favor), 0) AS deuda_neta
     FROM estados_cuenta ec
     JOIN propietarios p ON p.id = ec.propietario_id
     WHERE p.urbanizacion_id = $1 AND ec.cerrado = false`,
    [urbId]
  );

  // 4. Últimos pagos registrados
  const ultimosPagos = await query(env,
    `SELECT pg.*, p.nombre_propietario, p.apartamento
     FROM pagos pg
     JOIN propietarios p ON p.id = pg.propietario_id
     WHERE p.urbanizacion_id = $1
     ORDER BY pg.fecha_pago DESC, pg.created_at DESC LIMIT 5`,
    [urbId]
  );

  return ok({
    total_propietarios: parseInt(props[0].total) || 0,
    morosos: parseInt(props[0].morosos) || 0,
    activos: parseInt(props[0].activos) || 0,
    recaudado_mes: parseFloat(rec[0].recaudado) || 0,
    deuda_total: parseFloat(deuda[0].deuda_neta) || 0,
    ultimos_pagos: ultimosPagos
  });
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
