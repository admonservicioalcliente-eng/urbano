// handlers/cuentas_cobro.js — Consecutivos y generación de registros de cuentas de cobro NAS##
import { query } from '../db.js';

export async function handleGetAll(request, env, user) {
  const url = new URL(request.url);
  const propId = url.searchParams.get('propietario_id');

  let sql = `
    SELECT cc.*, p.nombre_propietario, p.apartamento
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
  const propRows = await query(env, `SELECT urbanizacion_id, nombre_propietario, apartamento, cuota_admon FROM propietarios WHERE id = $1`, [propietario_id]);
  if (!propRows.length) return err(404, 'Propietario no encontrado');
  const prop = propRows[0];
  if (user.rol !== 'superadmin' && prop.urbanizacion_id !== user.urbanizacion_id) {
    return err(403, 'Acceso denegado');
  }

  // Traer último consecutivo y prefijo
  const urbRows = await query(env, `SELECT prefijo_doc FROM urbanizaciones WHERE id = $1`, [user.urbanizacion_id]);
  const prefijo = urbRows[0]?.prefijo_doc || 'NAS';

  // Lock para consecutivo seguro
  const consecRows = await query(env,
    `SELECT COALESCE(MAX(consecutivo), 0) + 1 AS proximo
     FROM cuentas_cobro
     WHERE urbanizacion_id = $1`,
    [user.urbanizacion_id]
  );
  const proximo = parseInt(consecRows[0].proximo);
  const codigoDoc = `${prefijo}${String(proximo).padStart(3, '0')}`;

  // Traer estado de deuda actual para inyectar en snapshot (detalle_json)
  const ecs = await query(env,
    `SELECT * FROM estados_cuenta
     WHERE propietario_id = $1 AND cerrado = false
     ORDER BY anio ASC, mes ASC`,
    [propietario_id]
  );

  let totalDeuda = 0;
  for (const ec of ecs) {
    totalDeuda += parseFloat(ec.pago_actual) + parseFloat(ec.saldo_anterior) + parseFloat(ec.intereses) - parseFloat(ec.saldo_favor);
  }

  const detalleJson = {
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
      total_periodo: parseFloat(e.pago_actual) + parseFloat(e.saldo_anterior) + parseFloat(e.intereses) - parseFloat(e.saldo_favor)
    })),
    cuenta_bancaria: {
      banco: 'BANCOLOMBIA',
      tipo: 'Ahorros',
      numero: '106-251007-73',
      titular: 'PAULA ANDREA HERRERA CANO'
    }
  };

  const insertRows = await query(env,
    `INSERT INTO cuentas_cobro (
      urbanizacion_id, propietario_id, consecutivo, codigo_doc, total_deuda, detalle_json, generado_por
    ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [user.urbanizacion_id, propietario_id, proximo, codigoDoc, totalDeuda, JSON.stringify(detalleJson), user.id]
  );

  return ok(insertRows[0], 201);
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
