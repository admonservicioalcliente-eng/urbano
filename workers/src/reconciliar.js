// src/reconciliar.js — Reconciliación de pagos ↔ estados de cuenta (FIFO)
// El total pagado se consume mes a mes desde la deuda más antigua: cada estado
// se cierra cuando su cuota (pago_actual + saldo_anterior + intereses) quedó
// cubierta, por lo que si los pagos dejan el total deuda en cero los meses
// pendientes quedan también en cero.
import { query } from './db.js';
import { SYNC_ESTADOS_SQL } from './sync_estados_sql.js';

// Deuda pendiente con corte al mes anterior. La cuota del mes en curso no
// cuenta como mora: un propietario que ya pagó todo hasta el mes anterior
// debe permanecer ACTIVO aunque la cuota del mes actual siga abierta.
export async function deudaHastaMesAnterior(env, propietarioId) {
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  const rows = await query(env,
    `SELECT COALESCE(SUM(GREATEST(0, pago_actual + intereses - saldo_favor)), 0) AS deuda
     FROM estados_cuenta
     WHERE propietario_id = $1
       AND cerrado = false
       AND (anio < $2 OR (anio = $2 AND mes < $3))`,
    [propietarioId, anioActual, mesActual]
  );
  return parseFloat(rows[0].deuda) || 0;
}

// Sincroniza el estado del propietario con su saldo hasta el mes anterior:
// con deuda queda MOROSO; en cero (o a favor) pasa a ACTIVO. Se respetan los
// estados manuales 'inactivo' y 'abono_inicial'.
export async function actualizarEstadoPropietario(env, propietarioId) {
  const deudaAnterior = await deudaHastaMesAnterior(env, propietarioId);
  const nuevoEstado = deudaAnterior > 0.009 ? 'moroso' : 'activo';
  await query(env,
    `UPDATE propietarios SET estado = $1
     WHERE id = $2 AND estado NOT IN ('inactivo', 'abono_inicial')`,
    [nuevoEstado, propietarioId]
  );
  return nuevoEstado;
}

// Sincroniza de una sola vez el estado de TODOS los propietarios según su
// deuda hasta el mes anterior. Devuelve cuántos cambiaron de estado.
export async function sincronizarEstadosPropietarios(env) {
  const ahora = new Date();
  const anio = ahora.getUTCFullYear();
  const mes = ahora.getUTCMonth() + 1;
  const rows = await query(env, SYNC_ESTADOS_SQL, [anio, mes]);
  return { actualizados: rows.length, propietarios: rows };
}

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
  //    saldo_favor almacena: en meses cerrados = monto_aplicado_al_mes,
  //    en meses abiertos = excedente (crédito) que se arrastra.
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
    const excedenteMes = Math.max(0, disponible - base);
    const cerrado = aplicadoMes >= base;
    // saldo_favor siempre refleja el monto aplicado al mes (para el PDF y el detalle)
    // El excedente se suma al último mes abierto después del loop
    const saldoFavor = aplicadoMes;
    await query(env,
      `UPDATE estados_cuenta SET saldo_favor = $1, cerrado = $2 WHERE id = $3`,
      [saldoFavor, cerrado, ec.id]
    );
    aplicado += aplicadoMes;
  }

  // 3. Excedente de pago por encima de toda la deuda → saldo a favor del último
  //    estado abierto (crédito), para que el PDF pueda calcular el saldo a favor.
  if (aplicado < totalPagado && estados.length) {
    const lastAbierto = [...estados].reverse().find(e => !e.cerrado) || estados[estados.length - 1];
    const excedente = totalPagado - aplicado;
    await query(env,
      `UPDATE estados_cuenta SET saldo_favor = saldo_favor + $1 WHERE id = $2`,
      [excedente, lastAbierto.id]
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
    // Meses cerrados (pagados) no contribuyen a deuda acumulada
    if (!ec.cerrado) {
      deudaAcumulada += deudaMes;
    }
  }

  // 5. Estado del propietario: si el saldo está en cero hasta el mes anterior
  //    (sin contar la cuota del mes en curso) pasa de MOROSO a ACTIVO; si
  //    sigue debiendo, queda MOROSO. Se respetan 'inactivo' y 'abono_inicial'.
  await actualizarEstadoPropietario(env, propietarioId);
}
