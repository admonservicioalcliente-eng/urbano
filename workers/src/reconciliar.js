// src/reconciliar.js — Reconciliación de pagos ↔ estados de cuenta (FIFO)
// El total pagado se consume mes a mes desde la deuda más antigua: cada estado
// se cierra cuando su cuota (pago_actual + saldo_anterior + intereses) quedó
// cubierta, por lo que si los pagos dejan el total deuda en cero los meses
// pendientes quedan también en cero.
import { query } from './db.js';

export async function reconciliarPagos(env, propietarioId) {
  // 1. Vincular pagos huérfanos (sin estado) a la deuda abierta más antigua
  //    o crear el estado del mes de la fecha del pago.
  const unlinked = await query(env,
    `SELECT * FROM pagos
     WHERE propietario_id = $1 AND estado_cuenta_id IS NULL
     ORDER BY fecha_pago ASC, created_at ASC`,
    [propietarioId]
  );

  for (const pg of unlinked) {
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

  // 2. Distribución FIFO del total pagado sobre los estados en orden de fecha.
  const estados = await query(env,
    `SELECT * FROM estados_cuenta WHERE propietario_id = $1 ORDER BY anio ASC, mes ASC`,
    [propietarioId]
  );
  const pagos = await query(env,
    `SELECT monto FROM pagos WHERE propietario_id = $1 ORDER BY fecha_pago ASC, created_at ASC`,
    [propietarioId]
  );
  let totalPagado = 0;
  for (const p of pagos) totalPagado += parseFloat(p.monto) || 0;

  let aplicado = 0;
  for (const ec of estados) {
    const base = parseFloat(ec.pago_actual) + parseFloat(ec.saldo_anterior) + parseFloat(ec.intereses);
    const disponible = Math.max(0, totalPagado - aplicado);
    const aplicadoMes = Math.min(base, disponible);
    await query(env,
      `UPDATE estados_cuenta SET saldo_favor = $1, cerrado = $2 WHERE id = $3`,
      [aplicadoMes, aplicadoMes >= base, ec.id]
    );
    aplicado += aplicadoMes;
  }

  // 3. Excedente de pago por encima de toda la deuda → saldo a favor del último
  //    estado (crédito), para que siga apareciendo en el estado de cuenta.
  if (aplicado < totalPagado && estados.length) {
    const last = estados[estados.length - 1];
    await query(env,
      `UPDATE estados_cuenta SET saldo_favor = saldo_favor + $1 WHERE id = $2`,
      [totalPagado - aplicado, last.id]
    );
  }

  // 4. Recalcular saldo_anterior de cada mes: la deuda real de meses anteriores
  //    que aún no ha sido cubierta por pagos.
  const todosEstados = await query(env,
    `SELECT id, anio, mes, pago_actual, saldo_anterior, saldo_favor, intereses, cerrado
     FROM estados_cuenta WHERE propietario_id = $1 ORDER BY anio ASC, mes ASC`,
    [propietarioId]
  );
  let deudaAcumulada = 0;
  for (const ec of todosEstados) {
    const base = parseFloat(ec.pago_actual) + parseFloat(ec.intereses);
    const favor = parseFloat(ec.saldo_favor) || 0;
    const deudaMes = Math.max(0, base - favor);
    const nuevoSaldoAnterior = deudaAcumulada;
    // Solo actualizar si cambió
    if (Math.abs(nuevoSaldoAnterior - parseFloat(ec.saldo_anterior)) > 0.01) {
      await query(env,
        `UPDATE estados_cuenta SET saldo_anterior = $1 WHERE id = $2`,
        [nuevoSaldoAnterior, ec.id]
      );
    }
    deudaAcumulada += deudaMes;
  }

  // 5. Estado del propietario: si ya no debe nada (cero o saldo a favor) pasa a
  //    ACTIVO. Nunca se altera un propietario 'inactivo'.
  const deudaRows = await query(env,
    `SELECT COALESCE(SUM(total_deuda), 0) AS deuda
     FROM estados_cuenta
     WHERE propietario_id = $1 AND cerrado = false`,
    [propietarioId]
  );
  if (parseFloat(deudaRows[0].deuda) <= 0) {
    await query(env,
      `UPDATE propietarios SET estado = 'activo' WHERE id = $1 AND estado <> 'inactivo'`,
      [propietarioId]
    );
  }
}
