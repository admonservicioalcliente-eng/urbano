// handlers/cuentas_cobro.js — Consecutivos y generación de registros de cuentas de cobro NAS##
import { query } from '../db.js';
import { reconciliarPagos } from '../reconciliar.js';

export async function handleGetAll(request, env, user) {
  const url = new URL(request.url);
  const propId = url.searchParams.get('propietario_id');

  let sql = `
    SELECT
      cc.id,
      cc.codigo_doc AS codigo,
      cc.fecha_generacion AS fecha_emision,
       p.nombre_propietario AS propietario_nombre,
       p.apartamento AS propietario_apto,
       p.email AS propietario_email,
       p.telefono AS propietario_telefono,
       cc.total_deuda AS total_documento,
      cc.total_deuda AS total_deuda,
      cc.detalle_json,
      cc.consecutivo,
      cc.created_at,
      cc.propietario_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM estados_cuenta ec
        WHERE ec.propietario_id = p.id
      )
      THEN (
        SELECT COALESCE(SUM(GREATEST(0, ec.pago_actual + ec.saldo_anterior + ec.intereses - ec.saldo_favor)), 0)
        FROM estados_cuenta ec
        WHERE ec.propietario_id = p.id AND ec.cerrado = false
      )
      ELSE p.cuota_admon
      END AS deuda_actual
    FROM cuentas_cobro cc
    JOIN propietarios p ON p.id = cc.propietario_id
    WHERE cc.urbanizacion_id = $1
  `;
  const params = [user.urbanizacion_id];

  if (propId) {
    sql += ` AND cc.propietario_id = $2`;
    params.push(propId);
  }

  sql += ` ORDER BY cc.consecutivo DESC LIMIT 100`;

  const rows = await query(env, sql, params);
  // Aplanar los totales del detalle_json para que la reimpresión del PDF
  // tenga el estado de cuenta calculado (saldo a pagar / saldo a favor).
  for (const r of rows) {
    let dj = r.detalle_json;
    if (typeof dj === 'string' && dj) { try { dj = JSON.parse(dj); } catch { dj = null; } }
    const tt = dj && typeof dj === 'object' ? dj.totales : null;
    if (tt) {
      r.total_documento = Number(r.total_deuda) || 0;
      r.cuota_admon = Number(tt.cuota_admon) || 0;
      r.saldo_anterior = Number(tt.saldo_anterior) || 0;
      r.intereses = Number(tt.intereses) || 0;
      r.total_cargos = Number(tt.total_cargos) || 0;
      r.pagos_aplicados = Number(tt.pagos_aplicados) || 0;
      r.deuda_anterior = Number(tt.deuda_anterior) || 0;
      r.cuota_mes_actual = Number(tt.cuota_mes_actual) || 0;
      r.intereses_mes_actual = Number(tt.intereses_mes_actual) || 0;
      r.saldo_a_pagar = Number(tt.saldo_a_pagar) || 0;
      r.valor_a_pagar = Number(tt.valor_a_pagar) || 0;
      r.valor_a_pagar_a_favor = Number(tt.valor_a_pagar_a_favor) || 0;
      r.es_a_favor = !!tt.es_a_favor;
    }
  }
  return ok(rows);
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { propietario_id } = body;
  if (!propietario_id) return err(400, 'ID del propietario requerido');

  const propRows = await query(env, `SELECT * FROM propietarios WHERE id = $1`, [propietario_id]);
  if (!propRows.length) return err(404, 'Propietario no encontrado');
   const prop = propRows[0];
   if (user.rol !== 'superadmin' && prop.urbanizacion_id !== user.urbanizacion_id) {
     return err(403, 'Acceso denegado');
   }

// calcular desglose cuota por coeficientes
  let presupuestoCC = 0;
  try {
    const prCC = await query(env, `SELECT cuota_admon FROM parametros_anio WHERE urbanizacion_id=$1 AND anio=EXTRACT(YEAR FROM NOW())`, [prop.urbanizacion_id]);
    presupuestoCC = prCC.length ? parseFloat(prCC[0].cuota_admon) : 0;
  } catch {}
  const coefA = parseFloat(prop.coef_apto)||0, coefC = prop.has_celda ? parseFloat(prop.coef_celda)||0 :0, coefQ = prop.has_cuarto_util ? parseFloat(prop.coef_cuarto_util)||0:0, coefL = prop.has_local ? parseFloat(prop.coef_local)||0:0;
  const vcFixed = prop.has_celda ? parseFloat(prop.valor_celda)||0 :0;
  const vqFixed = prop.has_cuarto_util ? parseFloat(prop.valor_cuarto_util)||0 :0;
  const vlFixed = prop.has_local ? parseFloat(prop.valor_local)||0 :0;
  let vAptoCC=0, vCeldaCC=0, vCuartoCC=0, vLocalCC=0;
  if (presupuestoCC>0 && (coefA+coefC+coefQ+coefL)>0) {
    vAptoCC = Math.round(presupuestoCC * coefA /100 *100)/100;
    vCeldaCC = prop.has_celda ? Math.round((presupuestoCC * coefC /100 + vcFixed)*100)/100 :0;
    vCuartoCC = prop.has_cuarto_util ? Math.round((presupuestoCC * coefQ /100 + vqFixed)*100)/100 :0;
    vLocalCC = prop.has_local ? Math.round((presupuestoCC * coefL /100 + vlFixed)*100)/100 :0;
  }

   const propContacto = {
     nombre: prop.nombre_propietario,
     apartamento: prop.apartamento,
     cuota_admon: prop.cuota_admon,
     email: prop.email || '',
     telefono: prop.telefono || '',
      coef_apto: prop.coef_apto, coef_celda: prop.coef_celda, coef_cuarto_util: prop.coef_cuarto_util, coef_local: prop.coef_local,
      valor_celda: prop.valor_celda, valor_cuarto_util: prop.valor_cuarto_util, valor_local: prop.valor_local,
      has_celda: prop.has_celda, has_cuarto_util: prop.has_cuarto_util, has_local: prop.has_local,
      desglose: { valor_apto: vAptoCC, valor_celda: vCeldaCC, valor_cuarto_util: vCuartoCC, valor_local: vLocalCC, presupuesto: presupuestoCC }
   };

  // ¿Es la primera cuenta de cobro del propietario? Si es nueva y tiene abono
  // inicial, el abono se arrastra como ítem de pago en esta primera cuenta.
  const ccCount = await query(env, `SELECT COUNT(*) AS n FROM cuentas_cobro WHERE propietario_id = $1`, [propietario_id]);
  const esPrimeraCC = parseInt(ccCount[0].n) === 0;
  const abonoInicial = parseFloat(prop.abono_inicial) || 0;
  const abonoAplicado = (esPrimeraCC && abonoInicial > 0) ? abonoInicial : 0;

  // Traer datos de la urbanización
  const urbRows = await query(env,
    `SELECT nombre, direccion, telefono, email, prefijo_doc, nit, 
            banco_numero_cuenta, banco_tipo_cuenta, banco_nombre, banco_titular, banco_celular 
     FROM urbanizaciones WHERE id = $1`,
    [user.urbanizacion_id]
  );
  const urb = urbRows[0] || { nombre: 'EDIFICIO NASSAU P.H.', direccion: '', telefono: '', prefijo_doc: 'NAS' };
  const prefijo = urb.prefijo_doc || 'NAS';

// Traer parametros del parámetro anual activo
   const paramRows = await query(env,
     `SELECT mostrar_copia, retroactivo_admon, cuota_extra, cuota_extra_mes_inicio, cuota_extra_anio_inicio, cuota_extra_duracion FROM parametros_anio
      WHERE urbanizacion_id = $1 AND anio = EXTRACT(YEAR FROM NOW())`,
     [user.urbanizacion_id]
   );
   const mostrarCopia = paramRows[0]?.mostrar_copia !== false;
   const retroactivoMonto = parseFloat(paramRows[0]?.retroactivo_admon) || 0;
   const cuotaExtra = parseFloat(paramRows[0]?.cuota_extra) || 0;

  // Lock para consecutivo seguro
  const consecRows = await query(env,
    `SELECT COALESCE(MAX(consecutivo), 0) + 1 AS proximo
     FROM cuentas_cobro
     WHERE urbanizacion_id = $1`,
    [user.urbanizacion_id]
  );
  const proximo = parseInt(consecRows[0].proximo);
  const codigoDoc = `${prefijo}${String(proximo).padStart(3, '0')}`;

  // Reconciliación primero: aplica pagos y cierra meses cubiertos ANTES de intereses
  await reconciliarPagos(env, propietario_id);
  // Luego calcula intereses solo sobre meses ABIERTOS restantes
  await query(env, `SELECT actualizar_intereses_propietario($1)`, [propietario_id]);
  // YA NO se vuelve a reconciliar, para no alterar cerrado

    let ecs = await query(env,
    `SELECT * FROM estados_cuenta
     WHERE propietario_id = $1
     ORDER BY anio ASC, mes ASC`,
    [propietario_id]
  );

  // Pagos reales del propietario (para mostrar en el PDF)
  const pagosRows = await query(env,
    `SELECT monto, fecha_pago, tipo_pago, comprobante, descripcion
     FROM pagos WHERE propietario_id = $1
     ORDER BY fecha_pago ASC`,
    [propietario_id]
  );
  let totalPagos = 0;
  for (const pg of pagosRows) totalPagos += parseFloat(pg.monto) || 0;

  // Cuotas extras pendientes del propietario o de la urbanización (no aplicadas)
  const extras = await query(env,
    `SELECT * FROM cuotas_extras
     WHERE urbanizacion_id = $1 AND aplicado = false
       AND (propietario_id = $2 OR propietario_id IS NULL)
     ORDER BY fecha_vencimiento ASC`,
    [user.urbanizacion_id, propietario_id]
  );

  // Mes actual: si el período actual no tiene estado (cuota aún no
  // generada por el cron), se incluye la cuota vigente como período
  // virtual (sin persistir) para que el estado de cuenta sea completo.
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;

  const tieneMesActual = ecs.some(e => parseInt(e.anio) === anioActual && parseInt(e.mes) === mesActual);
  if (!tieneMesActual && prop.estado !== 'inactivo') {
    const sumDesglose = vAptoCC + vCeldaCC + vCuartoCC + vLocalCC;
    const cuotaVirtual = sumDesglose > 0
      ? sumDesglose
      : (parseFloat(prop.cuota_total) || parseFloat(prop.cuota_admon) || 0);
    ecs = [...ecs, {
      anio: anioActual,
      mes: mesActual,
      pago_actual: cuotaVirtual,
      saldo_anterior: 0,
      saldo_favor: 0,
      intereses: 0,
      cerrado: false,
      dias_mora: 0,
      valor_apto: vAptoCC,
      valor_celda: vCeldaCC,
      valor_cuarto_util: vCuartoCC,
      valor_local: vLocalCC,
      virtual: true
    }];
  }

  // ── FÓRMULA COMPLETA DEL ESTADO DE CUENTA ───────────────────────────
  // SALDO A PAGAR = (Σ cuotas + Σ intereses + cuotas extras + retroactivo
  //                  + cuota extra) − (Σ pagos aplicados)
  // El abono inicial ya se registra como pago real (tabla pagos, tipo
  // 'abono'), por lo que Σ pagos lo incluye: NO se descuenta aparte.
  let totalCuotas = 0, totalIntereses = 0;
  let cargosAnteriores = 0, cuotaMesActual = 0, interesesMesActual = 0;
  for (const ec of ecs) {
    const pago = parseFloat(ec.pago_actual) || 0;
    const inte = parseFloat(ec.intereses) || 0;
    totalCuotas += pago;
    totalIntereses += inte;
    const esActual = parseInt(ec.anio) === anioActual && parseInt(ec.mes) === mesActual;
    if (esActual) { cuotaMesActual = pago; interesesMesActual = inte; }
    else { cargosAnteriores += pago + inte; }
  }
  let totalExtras = 0;
  for (const ex of extras) totalExtras += parseFloat(ex.monto) || 0;

  const totalCargos = totalCuotas + totalIntereses + totalExtras + retroactivoMonto + cuotaExtra;
  const pagosAplicados = totalPagos; // Σ pagos (ya incluye abono inicial)
  const saldoAPagarNeto = Math.round((totalCargos - pagosAplicados) * 100) / 100;
  const esAFavor = saldoAPagarNeto < 0;
  const valorAPagar = esAFavor ? 0 : saldoAPagarNeto;
  const valorAPagarAFavor = esAFavor ? Math.round(-saldoAPagarNeto * 100) / 100 : 0;
  // Deuda arrastrada anterior al mes actual, neta de pagos. Puede ser
  // negativa (saldo a favor) cuando los pagos superan los cargos previos.
  const deudaAnteriorNeta = Math.round((cargosAnteriores + totalExtras + retroactivoMonto + cuotaExtra - pagosAplicados) * 100) / 100;

  // El documento almacena el valor a pagar (0 si hay saldo a favor);
  // el detalle_json guarda el saldo neto con signo.
  const totalDeuda = valorAPagar;

const detalleJson = {
     mostrar_copia: mostrarCopia,
     cuota_extra: cuotaExtra,
     cuota_extra_mes_inicio: paramRows[0]?.cuota_extra_mes_inicio || 0,
     cuota_extra_anio_inicio: paramRows[0]?.cuota_extra_anio_inicio || 0,
     cuota_extra_duracion: paramRows[0]?.cuota_extra_duracion || 0,
     urbanizacion: {
      nombre: urb.nombre,
      direccion: urb.direccion,
      telefono: urb.telefono,
      email: urb.email,
      banco_numero_cuenta: urb.banco_numero_cuenta,
      banco_tipo_cuenta: urb.banco_tipo_cuenta,
      banco_nombre: urb.banco_nombre,
      banco_titular: urb.banco_titular,
      banco_celular: urb.banco_celular
    },
     propietario: propContacto,
    desglose_cuota: propContacto.desglose,
    periodos_pendientes: ecs.map(e => {
      const base = parseFloat(e.pago_actual) + parseFloat(e.saldo_anterior) + parseFloat(e.intereses);
      const favor = parseFloat(e.saldo_favor) || 0;
      const montoAplicado = favor;
      const pagado = montoAplicado;
      const saldo = Math.max(0, base - montoAplicado);
      const cerrado = saldo === 0 && base > 0;
      return {
        anio: e.anio,
        mes: e.mes,
        pago_actual: e.pago_actual,
        valor_apto: e.valor_apto, valor_celda: e.valor_celda, valor_cuarto_util: e.valor_cuarto_util, valor_local: e.valor_local,
        saldo_anterior: e.saldo_anterior,
        intereses: e.intereses,
        saldo_favor: e.saldo_favor,
        dias_mora: e.dias_mora,
        cerrado: cerrado,
        total_deuda: base,
        monto_aplicado: montoAplicado,
        pagado: pagado,
        pendiente: saldo,
        total_periodo: saldo
      };
    }),
    cuotas_extras: extras.map(ex => ({
      descripcion: ex.descripcion,
      monto: ex.monto,
      fecha_vencimiento: ex.fecha_vencimiento
    })),
    retroactivo: retroactivoMonto > 0 ? {
      descripcion: 'Retroactivo Ley 675 (diferencia cuota administración)',
      monto: retroactivoMonto
    } : null,
    abonos: abonoAplicado > 0 ? [{
      descripcion: 'Abono inicial',
      monto: abonoAplicado,
      fecha: prop.created_at ? new Date(prop.created_at).toISOString().slice(0, 10) : null
    }] : [],
    pagos_aplicados: pagosRows.map(pg => ({
      monto: parseFloat(pg.monto) || 0,
      fecha_pago: pg.fecha_pago,
      tipo_pago: pg.tipo_pago,
      comprobante: pg.comprobante,
      descripcion: pg.descripcion
    })),
    total_pagos: Math.round(totalPagos * 100) / 100,
     totales: {
        cuota_admon: Math.round(totalCuotas * 100) / 100,
        saldo_anterior: deudaAnteriorNeta,
        intereses: Math.round(totalIntereses * 100) / 100,
        cuotas_extras: Math.round(totalExtras * 100) / 100,
        retroactivo: Math.round(retroactivoMonto * 100) / 100,
        saldo_favor: Math.round(pagosAplicados * 100) / 100,
        abono_inicial: Math.round(abonoAplicado * 100) / 100,
        deuda_anterior: deudaAnteriorNeta,
        cuota_mes_actual: Math.round(cuotaMesActual * 100) / 100,
        intereses_mes_actual: Math.round(interesesMesActual * 100) / 100,
        cuota_extra: Math.round(cuotaExtra * 100) / 100,
        total_cargos: Math.round(totalCargos * 100) / 100,
        pagos_aplicados: Math.round(pagosAplicados * 100) / 100,
        total_pagos: Math.round(totalPagos * 100) / 100,
        saldo_a_pagar: saldoAPagarNeto,
        valor_a_pagar: valorAPagar,
        valor_a_pagar_a_favor: valorAPagarAFavor,
        es_a_favor: esAFavor,
        total: valorAPagar
      },
    cuenta_bancaria: {
      banco: 'NEQUI',
      tipo: 'Cuenta',
      numero: '3002272559',
      titular: 'SONEIDA OSSA QUINTERO'
    },
    celular: '324 502 52 01 - 311 392 60 86',
    nota: 'PAGAR CUMPLIDAMENTE NOS HACE TENER UNA MEJOR CALIDAD DE VIDA'
  };

  const insertRows = await query(env,
    `INSERT INTO cuentas_cobro (
      urbanizacion_id, propietario_id, consecutivo, codigo_doc, total_deuda, detalle_json, generado_por
    ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [user.urbanizacion_id, propietario_id, proximo, codigoDoc, totalDeuda, detalleJson, user.id]
  );

  const created = insertRows[0];
  created.detalle_json = detalleJson;
  created.codigo = codigoDoc;
  created.fecha_emision = hoy.toISOString();
  created.propietario_nombre = prop.nombre_propietario;
  created.propietario_apto = prop.apartamento;
  // Campos aplanados del estado de cuenta (para generación inmediata del PDF)
  created.total_documento = valorAPagar;
  created.cuota_admon = Math.round(totalCuotas * 100) / 100;
  created.saldo_anterior = deudaAnteriorNeta;
  created.intereses = Math.round(totalIntereses * 100) / 100;
  created.total_cargos = Math.round(totalCargos * 100) / 100;
  created.pagos_aplicados = Math.round(pagosAplicados * 100) / 100;
  created.deuda_anterior = deudaAnteriorNeta;
  created.cuota_mes_actual = Math.round(cuotaMesActual * 100) / 100;
  created.intereses_mes_actual = Math.round(interesesMesActual * 100) / 100;
  created.saldo_a_pagar = saldoAPagarNeto;
  created.valor_a_pagar = valorAPagar;
  created.valor_a_pagar_a_favor = valorAPagarAFavor;
  created.es_a_favor = esAFavor;

  // Limpiar retroactivo después de generar la CC (solo se cobra una vez)
  if (retroactivoMonto > 0) {
    await query(env,
      `UPDATE parametros_anio SET retroactivo_admon = 0
       WHERE urbanizacion_id = $1 AND anio = EXTRACT(YEAR FROM NOW())`,
      [user.urbanizacion_id]
    );
  }

  return ok(created, 201);
}

export async function handleDeleteAll(request, env, user) {
  const result = await query(env,
    `DELETE FROM cuentas_cobro WHERE urbanizacion_id = $1`,
    [user.urbanizacion_id]
  );
  return ok({ deleted: result.count || result.affectedRows || 0 });
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
