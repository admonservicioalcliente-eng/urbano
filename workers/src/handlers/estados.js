// handlers/estados.js — Estados de cuenta & dashboard
import { query } from '../db.js';

export async function handleGetByPropietario(request, env, user) {
  const url = new URL(request.url);
  const propId = url.searchParams.get('propietario_id');
  const anio = url.searchParams.get('anio') || new Date().getFullYear().toString();

  if (!propId) return err(400, 'ID de propietario requerido');

  // Validar pertenencia
  const propRows = await query(env, `SELECT urbanizacion_id FROM propietarios WHERE id = $1`, [propId]);
  if (!propRows.length) return err(404, 'Propietario no encontrado');
  if (user.rol !== 'superadmin' && propRows[0].urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // Ejecutar el cálculo y recalculo de intereses al vuelo para periodos abiertos
  const openEcs = await query(env, 
    `SELECT id FROM estados_cuenta WHERE propietario_id = $1 AND cerrado = false`, 
    [propId]
  );
  
  for (const ec of openEcs) {
    await query(env, 
      `UPDATE estados_cuenta SET 
        intereses = COALESCE((SELECT calcular_intereses($1)), 0)
       WHERE id = $1`, 
      [ec.id]
    );
  }

  // Traer los estados de cuenta actualizados
  const estados = await query(env,
    `SELECT * FROM estados_cuenta
     WHERE propietario_id = $1 AND anio = $2
     ORDER BY mes ASC`,
    [propId, parseInt(anio)]
  );

  // Totales generales acumulados del propietario
  const totals = await query(env,
    `SELECT 
      COALESCE(SUM(total_deuda), 0) AS total_deuda,
      COALESCE(SUM(saldo_favor), 0) AS total_saldo_favor,
      COUNT(CASE WHEN total_deuda > 0 AND cerrado = false THEN 1 END) AS meses_pendientes
     FROM estados_cuenta
     WHERE propietario_id = $1`,
    [propId]
  );

  return ok({
    estados,
    resumen: totals[0]
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

  // 3. Deuda total acumulada en la urbanización
  const deuda = await query(env,
    `SELECT COALESCE(SUM(ec.total_deuda) - SUM(ec.saldo_favor), 0) AS deuda_neta
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
