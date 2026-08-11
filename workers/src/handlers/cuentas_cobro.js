// handlers/cuentas_cobro.js — Consecutivos y generación de registros de cuentas de cobro NAS##
import { query } from '../db.js';

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
  return ok(rows);
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { propietario_id } = body;
  if (!propietario_id) return err(400, 'ID del propietario requerido');

  // Validar pertenencia
  const propRows = await query(env, `SELECT urbanizacion_id, nombre_propietario, apartamento, cuota_admon, abono_inicial, created_at FROM propietarios WHERE id = $1`, [propietario_id]);
  if (!propRows.length) return err(404, 'Propietario no encontrado');
  const prop = propRows[0];
  if (user.rol !== 'superadmin' && prop.urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // ¿Es la primera cuenta de cobro del propietario? Si es nueva y tiene abono
  // inicial, el abono se arrastra como ítem de pago en esta primera cuenta.
  const ccCount = await query(env, `SELECT COUNT(*) AS n FROM cuentas_cobro WHERE propietario_id = $1`, [propietario_id]);
  const esPrimeraCC = parseInt(ccCount[0].n) === 0;
  const abonoInicial = parseFloat(prop.abono_inicial) || 0;
  const abonoAplicado = (esPrimeraCC && abonoInicial > 0) ? abonoInicial : 0;

  // Traer datos de la urbanización
  const urbRows = await query(env,
    `SELECT nombre, direccion, telefono, email, prefijo_doc, nit FROM urbanizaciones WHERE id = $1`,
    [user.urbanizacion_id]
  );
  const urb = urbRows[0] || { nombre: 'EDIFICIO NASSAU P.H.', direccion: '', telefono: '', prefijo_doc: 'NAS' };
  const prefijo = urb.prefijo_doc || 'NAS';

  // Lock para consecutivo seguro
  const consecRows = await query(env,
    `SELECT COALESCE(MAX(consecutivo), 0) + 1 AS proximo
     FROM cuentas_cobro
     WHERE urbanizacion_id = $1`,
    [user.urbanizacion_id]
  );
  const proximo = parseInt(consecRows[0].proximo);
  const codigoDoc = `${prefijo}${String(proximo).padStart(3, '0')}`;

  // Reconciliar pagos y recalcular intereses al día antes de la snapshot
  await query(env, `SELECT actualizar_intereses_propietario($1)`, [propietario_id]);

  // Traer TODOS los estados (abiertos y cerrados) para el cuerpo de la CC:
  // el primer mes del propietario (mes de inicio) queda cerrado cuando el
  // abono inicial cubre la cuota, pero debe seguir apareciendo como ítem.
  let ecs = await query(env,
    `SELECT * FROM estados_cuenta
     WHERE propietario_id = $1
     ORDER BY anio ASC, mes ASC`,
    [propietario_id]
  );

  // Cuotas extras pendientes del propietario o de la urbanización (no aplicadas)
  const extras = await query(env,
    `SELECT * FROM cuotas_extras
     WHERE urbanizacion_id = $1 AND aplicado = false
       AND (propietario_id = $2 OR propietario_id IS NULL)
     ORDER BY fecha_vencimiento ASC`,
    [user.urbanizacion_id, propietario_id]
  );

  // Estados abiertos: los que aún no se han pagado.
  // Si no hay ninguno, verificar si el período actual YA fue facturado.
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;

  if (!ecs.length) {
    const billed = await query(env,
      `SELECT COUNT(*) AS n FROM estados_cuenta
       WHERE propietario_id = $1 AND anio = $2 AND mes = $3`,
      [propietario_id, anioActual, mesActual]
    );
    // Solo si el período actual NO ha sido facturado se incluye la cuota del mes
    if (parseInt(billed[0].n) === 0) {
      ecs = [{
        anio: anioActual,
        mes: mesActual,
        pago_actual: prop.cuota_admon,
        saldo_anterior: '0',
        intereses: '0',
        saldo_favor: '0'
      }];
    }
  }

  let totalCuota = 0, totalInteres = 0, totalSaldoAnt = 0, totalSaldoFavor = 0;
  for (const ec of ecs) {
    totalCuota     += parseFloat(ec.pago_actual) || 0;
    totalInteres   += parseFloat(ec.intereses) || 0;
    totalSaldoAnt  += parseFloat(ec.saldo_anterior) || 0;
    totalSaldoFavor += parseFloat(ec.saldo_favor) || 0;
  }
  let totalExtras = 0;
  for (const ex of extras) {
    totalExtras += parseFloat(ex.monto) || 0;
  }

  // El cuerpo ahora incluye TODOS los estados, así que el saldo a favor y los
  // créditos de estados cerrados ya están capturados en totalSaldoFavor (vía
  // saldo_favor). No se suma crédito adicional para evitar doble descuento.
  const creditoAcumulado = 0;
  const saldoFavorTotal = totalSaldoFavor;
  // El abono inicial ya está aplicado como saldo_favor del primer estado
  // (sembrarEstadosInicio), así que no debe restarse de nuevo aquí.
  const totalDeuda = totalCuota + totalSaldoAnt + totalInteres + totalExtras - saldoFavorTotal;

  const detalleJson = {
    urbanizacion: {
      nombre: urb.nombre,
      direccion: urb.direccion,
      telefono: urb.telefono,
      email: urb.email
    },
    propietario: {
      nombre: prop.nombre_propietario,
      apartamento: prop.apartamento,
      cuota_admon: prop.cuota_admon
    },
    periodos_pendientes: ecs.map(e => ({
      anio: e.anio,
      mes: e.mes,
      pago_actual: e.pago_actual,
      saldo_anterior: e.saldo_anterior,
      intereses: e.intereses,
      saldo_favor: e.saldo_favor,
      dias_mora: e.dias_mora,
      total_periodo: parseFloat(e.pago_actual) + parseFloat(e.saldo_anterior) + parseFloat(e.intereses) - parseFloat(e.saldo_favor)
    })),
    cuotas_extras: extras.map(ex => ({
      descripcion: ex.descripcion,
      monto: ex.monto,
      fecha_vencimiento: ex.fecha_vencimiento
    })),
    abonos: abonoAplicado > 0 ? [{
      descripcion: 'Abono inicial',
      monto: abonoAplicado,
      fecha: prop.created_at ? new Date(prop.created_at).toISOString().slice(0, 10) : null
    }] : [],
    totales: {
      cuota_admon: Math.round(totalCuota * 100) / 100,
      saldo_anterior: Math.round(totalSaldoAnt * 100) / 100,
      intereses: Math.round(totalInteres * 100) / 100,
      cuotas_extras: Math.round(totalExtras * 100) / 100,
      saldo_favor: Math.round(saldoFavorTotal * 100) / 100,
      credito_acumulado: Math.round(creditoAcumulado * 100) / 100,
      abono_inicial: Math.round(abonoAplicado * 100) / 100,
      total: Math.round(totalDeuda * 100) / 100
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

  return ok(created, 201);
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
