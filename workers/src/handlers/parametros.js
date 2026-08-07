// handlers/parametros.js — Parámetros de año & generación de cuotas mensuales
import { query } from '../db.js';

export async function handleGet(request, env, user) {
  const rows = await query(env,
    `SELECT * FROM parametros_anio
     WHERE urbanizacion_id = $1
     ORDER BY anio DESC`,
    [user.urbanizacion_id]
  );
  return ok(rows);
}

export async function handleCreate(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { anio, tasa_mora_mensual, dia_generacion_cuota, dia_vencimiento_sin_mora, dia_inicio_mora } = body;
  if (!anio || tasa_mora_mensual === undefined) {
    return err(400, 'Año y Tasa de mora son obligatorios');
  }

  // Insertar o actualizar parámetros
  const rows = await query(env,
    `INSERT INTO parametros_anio (
      urbanizacion_id, anio, tasa_mora_mensual, dia_generacion_cuota, dia_vencimiento_sin_mora, dia_inicio_mora
    ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (urbanizacion_id, anio)
     DO UPDATE SET
      tasa_mora_mensual = EXCLUDED.tasa_mora_mensual,
      dia_generacion_cuota = EXCLUDED.dia_generacion_cuota,
      dia_vencimiento_sin_mora = EXCLUDED.dia_vencimiento_sin_mora,
      dia_inicio_mora = EXCLUDED.dia_inicio_mora
     RETURNING *`,
    [
      user.urbanizacion_id,
      parseInt(anio),
      parseFloat(tasa_mora_mensual),
      parseInt(dia_generacion_cuota) || 1,
      parseInt(dia_vencimiento_sin_mora) || 5,
      parseInt(dia_inicio_mora) || 6
    ]
  );

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
