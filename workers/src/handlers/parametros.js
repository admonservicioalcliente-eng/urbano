// handlers/parametros.js — Parámetros de año & generación de cuotas mensuales
import { query } from '../db.js';

export async function handleGet(request, env, user) {
  const rows = await query(env,
    `SELECT * FROM parametros_anio
     ORDER BY anio DESC`,
    []
  );
  return ok(rows);
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { anio, tasa_mora_mensual, dia_generacion_cuota, dia_vencimiento_sin_mora, dia_inicio_mora, prefijo_comprobante, cuota_admon, consecutivo_comprobante } = body;
  if (!anio || tasa_mora_mensual === undefined) {
    return err(400, 'Año y Tasa de mora son obligatorios');
  }

  const rows = await query(env,
    `INSERT INTO parametros_anio (
      urbanizacion_id, anio, tasa_mora_mensual, dia_generacion_cuota,
      dia_vencimiento_sin_mora, dia_inicio_mora, prefijo_comprobante, cuota_admon
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (urbanizacion_id, anio)
     DO UPDATE SET
      tasa_mora_mensual = EXCLUDED.tasa_mora_mensual,
      dia_generacion_cuota = EXCLUDED.dia_generacion_cuota,
      dia_vencimiento_sin_mora = EXCLUDED.dia_vencimiento_sin_mora,
      dia_inicio_mora = EXCLUDED.dia_inicio_mora,
      prefijo_comprobante = EXCLUDED.prefijo_comprobante,
      cuota_admon = EXCLUDED.cuota_admon
     RETURNING *`,
    [
      user.urbanizacion_id,
      parseInt(anio),
      parseFloat(tasa_mora_mensual),
      parseInt(dia_generacion_cuota) || 1,
      parseInt(dia_vencimiento_sin_mora) || 5,
      parseInt(dia_inicio_mora) || 6,
      (prefijo_comprobante || 'NAS').toUpperCase().substring(0, 10),
      parseFloat(cuota_admon) || 0
    ]
  );

  return ok(rows[0]);
}

export async function handleUpdate(request, env, user, id) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { consecutivo_comprobante, tasa_mora_mensual, dia_generacion_cuota, dia_vencimiento_sin_mora, dia_inicio_mora } = body;

  const consecutivo = consecutivo_comprobante === undefined ? null : parseInt(consecutivo_comprobante);
  if (consecutivo !== null && (isNaN(consecutivo) || consecutivo < 0)) return err(400, 'Consecutivo inválido');

  const rows = await query(env,
    `UPDATE parametros_anio SET
       consecutivo_comprobante = COALESCE($1, consecutivo_comprobante),
       tasa_mora_mensual = COALESCE($2, tasa_mora_mensual),
       dia_generacion_cuota = COALESCE($3, dia_generacion_cuota),
       dia_vencimiento_sin_mora = COALESCE($4, dia_vencimiento_sin_mora),
       dia_inicio_mora = COALESCE($5, dia_inicio_mora)
     WHERE id = $6
     RETURNING *`,
    [consecutivo, tasa_mora_mensual === undefined ? null : parseFloat(tasa_mora_mensual), dia_generacion_cuota === undefined ? null : parseInt(dia_generacion_cuota), dia_vencimiento_sin_mora === undefined ? null : parseInt(dia_vencimiento_sin_mora), dia_inicio_mora === undefined ? null : parseInt(dia_inicio_mora), id]
  );
  if (!rows.length) return err(404, 'Registro de configuración no encontrado');

  return ok(rows[0]);
}

export async function handleGenerarCuotas(request, env, user) {
  let body = {};
  try { body = await request.json() || {}; } catch {}

  const hoy = new Date();
  const anio = body.anio || hoy.getFullYear();
  const mes = body.mes || (hoy.getMonth() + 1);

  try {
    // Llamar al stored procedure de PostgreSQL
    const res = await query(env,
      `SELECT generar_cuotas_mes($1, $2, $3) AS creadas`,
      [user.urbanizacion_id, parseInt(anio), parseInt(mes)]
    );
    const creadas = res[0]?.creadas || 0;
    return ok({ creadas, message: `Se generaron las cuotas para ${creadas} propietarios` });
  } catch (ex) {
    return err(500, ex.message);
  }
}

const ok = (data, status = 200) => Response.json({ ok: true, data }, { status });
const err = (status, message) => Response.json({ ok: false, message }, { status });
