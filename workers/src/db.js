// db.js — PostgreSQL connection via Cloudflare Hyperdrive (using postgres.js)
import postgres from 'postgres';

/**
 * Convenience wrapper for parameterized queries.
 * Each call creates a fresh connection (Workers I/O isolation).
 * @param {Object} env - Worker env bindings
 * @param {string} sqlText - SQL with $1, $2 placeholders
 * @param {Array} params - Parameter array
 * @returns {Promise<Array>} Result rows
 */
export async function query(env, sqlText, params = []) {
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('HYPERDRIVE or DATABASE_URL is not configured');
  }
  const sql = postgres(connectionString, { max: 1 });
  try {
    const result = await sql.unsafe(sqlText, params);
    return result;
  } finally {
    await sql.end();
  }
}

let migrated = false;
export async function ensureMigrations(env) {
  if (migrated) return;
  try {
    const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
    const sql = postgres(connectionString, { max: 1 });
    try {
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS logo_base64 TEXT`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS plan_activo BOOLEAN DEFAULT FALSE`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS fecha_pago TIMESTAMPTZ`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS fecha_expiracion TIMESTAMPTZ`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS paypal_order_id VARCHAR(100)`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS monto_pago DECIMAL(10,2)`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS banco_numero_cuenta VARCHAR(30)`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS banco_tipo_cuenta VARCHAR(20) DEFAULT 'ahorros'`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS banco_nombre VARCHAR(100)`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS banco_titular VARCHAR(150)`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS banco_celular VARCHAR(20)`);
// Campo mostrar_copia en parametros_anio
       await sql.unsafe(`ALTER TABLE parametros_anio ADD COLUMN IF NOT EXISTS mostrar_copia BOOLEAN DEFAULT TRUE`);
       // Campo retroactivo_admon en parametros_anio (Ley 675)
       await sql.unsafe(`ALTER TABLE parametros_anio ADD COLUMN IF NOT EXISTS retroactivo_admon DECIMAL(12,2) DEFAULT 0`);
// Campos cuota_extra
        await sql.unsafe(`ALTER TABLE parametros_anio ADD COLUMN IF NOT EXISTS cuota_extra DECIMAL(12,2) DEFAULT 0`);
        await sql.unsafe(`ALTER TABLE parametros_anio ADD COLUMN IF NOT EXISTS cuota_extra_mes_inicio INTEGER DEFAULT 0`);
        await sql.unsafe(`ALTER TABLE parametros_anio ADD COLUMN IF NOT EXISTS cuota_extra_anio_inicio INTEGER DEFAULT 0`);
         await sql.unsafe(`ALTER TABLE parametros_anio ADD COLUMN IF NOT EXISTS cuota_extra_duracion INTEGER DEFAULT 0`);
         console.log('Migration: cuota_extra columns added');
         // Propietarios: coeficientes y valores por inmueble (apto/celda/cuarto)
         await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_apto DECIMAL(10,4) DEFAULT 0`);
         await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_celda DECIMAL(10,4) DEFAULT 0`);
         await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS coef_cuarto_util DECIMAL(10,4) DEFAULT 0`);
          await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS valor_celda DECIMAL(12,2) DEFAULT 0`);
          await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS valor_cuarto_util DECIMAL(12,2) DEFAULT 0`);
          await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS has_celda BOOLEAN DEFAULT FALSE`);
          await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS has_cuarto_util BOOLEAN DEFAULT FALSE`);
          await sql.unsafe(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS cuota_total DECIMAL(12,2) DEFAULT 0`);
          await sql.unsafe(`UPDATE propietarios SET cuota_total = cuota_admon WHERE cuota_total IS NULL OR cuota_total = 0`);
          // Estados de cuenta: desglose por item
          await sql.unsafe(`ALTER TABLE estados_cuenta ADD COLUMN IF NOT EXISTS valor_apto DECIMAL(12,2) DEFAULT 0`);
          await sql.unsafe(`ALTER TABLE estados_cuenta ADD COLUMN IF NOT EXISTS valor_celda DECIMAL(12,2) DEFAULT 0`);
          await sql.unsafe(`ALTER TABLE estados_cuenta ADD COLUMN IF NOT EXISTS valor_cuarto_util DECIMAL(12,2) DEFAULT 0`);
          // Corregir estados existentes que tenían presupuesto como pago_actual (234000) -> usar cuota del propietario
          await sql.unsafe(`
            UPDATE estados_cuenta ec SET
              pago_actual = COALESCE(p.cuota_total, p.cuota_admon, ec.pago_actual),
              valor_apto = COALESCE(p.cuota_total, p.cuota_admon, ec.pago_actual),
              valor_celda = 0,
              valor_cuarto_util = 0
            FROM propietarios p
            WHERE ec.propietario_id = p.id
              AND (p.coef_apto IS NULL OR p.coef_apto = 0) AND COALESCE(p.has_celda,false)=false AND COALESCE(p.has_cuarto_util,false)=false
              AND ec.cerrado = false
          `);
          await sql.unsafe(`
            UPDATE estados_cuenta ec SET
              pago_actual = ROUND(pa.cuota_admon * (COALESCE(p.coef_apto,0) + CASE WHEN COALESCE(p.has_celda,false) THEN COALESCE(p.coef_celda,0) ELSE 0 END + CASE WHEN COALESCE(p.has_cuarto_util,false) THEN COALESCE(p.coef_cuarto_util,0) ELSE 0 END)/100 + CASE WHEN COALESCE(p.has_celda,false) THEN COALESCE(p.valor_celda,0) ELSE 0 END + CASE WHEN COALESCE(p.has_cuarto_util,false) THEN COALESCE(p.valor_cuarto_util,0) ELSE 0 END, 2),
              valor_apto = ROUND(pa.cuota_admon * COALESCE(p.coef_apto,0)/100, 2),
              valor_celda = CASE WHEN COALESCE(p.has_celda,false) THEN ROUND(pa.cuota_admon * COALESCE(p.coef_celda,0)/100 + COALESCE(p.valor_celda,0),2) ELSE 0 END,
              valor_cuarto_util = CASE WHEN COALESCE(p.has_cuarto_util,false) THEN ROUND(pa.cuota_admon * COALESCE(p.coef_cuarto_util,0)/100 + COALESCE(p.valor_cuarto_util,0),2) ELSE 0 END
            FROM propietarios p
            JOIN parametros_anio pa ON pa.urbanizacion_id = p.urbanizacion_id AND pa.anio = ec.anio
            WHERE ec.propietario_id = p.id
              AND (COALESCE(p.coef_apto,0) > 0 OR COALESCE(p.has_celda,false) OR COALESCE(p.has_cuarto_util,false))
              AND ec.cerrado = false
          `);
         // Función generar_cuotas_mes con fórmula de coeficientes
         await sql.unsafe(`
         CREATE OR REPLACE FUNCTION generar_cuotas_mes(p_urbanizacion_id UUID, p_anio INT, p_mes INT)
         RETURNS INTEGER AS $$
         DECLARE
             v_prop          RECORD;
             v_params        RECORD;
             v_saldo_ant     DECIMAL(12,2);
             v_fecha_vcto    DATE;
             v_mes_anterior  INT;
             v_anio_anterior INT;
             v_count         INTEGER := 0;
             v_cuota_extra   DECIMAL(12,2) := 0;
             v_inicio_mes_idx INTEGER := 0;
             v_mes_actual_idx INTEGER := 0;
             v_fin_mes_idx   INTEGER := 0;
             v_presupuesto   DECIMAL(12,2);
             v_sum_coef      DECIMAL(10,4);
             v_total_cuota   DECIMAL(12,2);
             v_vapto DECIMAL(12,2); v_vcelda DECIMAL(12,2); v_vcuarto DECIMAL(12,2);
         BEGIN
             SELECT * INTO v_params FROM parametros_anio WHERE urbanizacion_id = p_urbanizacion_id AND anio = p_anio;
             IF NOT FOUND THEN RAISE EXCEPTION 'Sin parámetros para año %', p_anio; END IF;
             v_fecha_vcto := MAKE_DATE(p_anio, p_mes, v_params.dia_vencimiento_sin_mora);
             IF p_mes = 1 THEN v_mes_anterior:=12; v_anio_anterior:=p_anio-1; ELSE v_mes_anterior:=p_mes-1; v_anio_anterior:=p_anio; END IF;
             FOR v_prop IN SELECT * FROM propietarios WHERE urbanizacion_id = p_urbanizacion_id AND estado != 'inactivo' LOOP
                 SELECT GREATEST(0, COALESCE(total_deuda,0)-COALESCE(saldo_favor,0)) INTO v_saldo_ant FROM estados_cuenta WHERE propietario_id=v_prop.id AND anio=v_anio_anterior AND mes=v_mes_anterior;
                 IF v_saldo_ant IS NULL THEN v_saldo_ant:=0; END IF;
                 v_cuota_extra:=0;
                 IF v_params.cuota_extra > 0 THEN
                     v_inicio_mes_idx:=(v_params.cuota_extra_anio_inicio-1)*12+v_params.cuota_extra_mes_inicio;
                     v_mes_actual_idx:=(p_anio-1)*12+p_mes;
                     v_fin_mes_idx:=v_inicio_mes_idx+v_params.cuota_extra_duracion-1;
                     IF v_mes_actual_idx >= v_inicio_mes_idx AND v_mes_actual_idx <= v_fin_mes_idx THEN v_cuota_extra:=v_params.cuota_extra; END IF;
                 END IF;
                  v_presupuesto:=COALESCE(v_params.cuota_admon,0);
                  -- exclusivo: si valor>0 se ignora coef de ese inmueble
                  v_sum_coef:=CASE WHEN COALESCE(v_prop.coef_apto,0)>0 THEN COALESCE(v_prop.coef_apto,0) ELSE 0 END
                    + CASE WHEN COALESCE(v_prop.has_celda,false) AND COALESCE(v_prop.valor_celda,0)=0 THEN COALESCE(v_prop.coef_celda,0) ELSE 0 END
                    + CASE WHEN COALESCE(v_prop.has_cuarto_util,false) AND COALESCE(v_prop.valor_cuarto_util,0)=0 THEN COALESCE(v_prop.coef_cuarto_util,0) ELSE 0 END;
                   IF v_sum_coef > 0 AND v_presupuesto > 0 THEN
                      v_vapto:=CASE WHEN COALESCE(v_prop.coef_apto,0)>0 THEN ROUND(v_presupuesto * COALESCE(v_prop.coef_apto,0)/100,2) ELSE 0 END;
                      v_vcelda:=CASE WHEN COALESCE(v_prop.has_celda,false) THEN CASE WHEN COALESCE(v_prop.valor_celda,0)>0 THEN ROUND(COALESCE(v_prop.valor_celda,0),2) ELSE ROUND(v_presupuesto * COALESCE(v_prop.coef_celda,0)/100,2) END ELSE 0 END;
                      v_vcuarto:=CASE WHEN COALESCE(v_prop.has_cuarto_util,false) THEN CASE WHEN COALESCE(v_prop.valor_cuarto_util,0)>0 THEN ROUND(COALESCE(v_prop.valor_cuarto_util,0),2) ELSE ROUND(v_presupuesto * COALESCE(v_prop.coef_cuarto_util,0)/100,2) END ELSE 0 END;
                      v_total_cuota:=ROUND(COALESCE(v_vapto,0) + COALESCE(v_vcelda,0) + COALESCE(v_vcuarto,0),2);
                   ELSIF COALESCE(v_prop.valor_celda,0)>0 OR COALESCE(v_prop.valor_cuarto_util,0)>0 THEN
                      v_vapto:=CASE WHEN COALESCE(v_prop.coef_apto,0)>0 AND v_presupuesto>0 THEN ROUND(v_presupuesto * COALESCE(v_prop.coef_apto,0)/100,2) ELSE 0 END;
                      v_vcelda:=CASE WHEN COALESCE(v_prop.has_celda,false) AND COALESCE(v_prop.valor_celda,0)>0 THEN ROUND(COALESCE(v_prop.valor_celda,0),2) ELSE 0 END;
                      v_vcuarto:=CASE WHEN COALESCE(v_prop.has_cuarto_util,false) AND COALESCE(v_prop.valor_cuarto_util,0)>0 THEN ROUND(COALESCE(v_prop.valor_cuarto_util,0),2) ELSE 0 END;
                      v_total_cuota:=ROUND(COALESCE(v_vapto,0) + COALESCE(v_vcelda,0) + COALESCE(v_vcuarto,0),2);
                      IF v_total_cuota=0 THEN v_total_cuota:=COALESCE(v_prop.cuota_total, v_prop.cuota_admon, 0); END IF;
                   ELSE
                       v_total_cuota:=COALESCE(v_prop.cuota_total, v_prop.cuota_admon, 0);
                       v_vapto:=v_total_cuota; v_vcelda:=0; v_vcuarto:=0;
                   END IF;
                  BEGIN
                      INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual, valor_apto, valor_celda, valor_cuarto_util, saldo_anterior, saldo_favor, intereses, fecha_vencimiento)
                      VALUES (v_prop.id, p_anio, p_mes, v_total_cuota + v_cuota_extra, v_vapto, v_vcelda, v_vcuarto, v_saldo_ant, 0, 0, v_fecha_vcto)
                      ON CONFLICT (propietario_id, anio, mes) DO UPDATE SET pago_actual = EXCLUDED.pago_actual, valor_apto = EXCLUDED.valor_apto, valor_celda = EXCLUDED.valor_celda, valor_cuarto_util = EXCLUDED.valor_cuarto_util;
                  EXCEPTION WHEN undefined_column THEN
                      INSERT INTO estados_cuenta (propietario_id, anio, mes, pago_actual, saldo_anterior, saldo_favor, intereses, fecha_vencimiento)
                      VALUES (v_prop.id, p_anio, p_mes, v_total_cuota + v_cuota_extra, v_saldo_ant, 0, 0, v_fecha_vcto)
                      ON CONFLICT (propietario_id, anio, mes) DO UPDATE SET pago_actual = EXCLUDED.pago_actual;
                  END;
                 v_count:=v_count+1;
             END LOOP;
             RETURN v_count;
         END; $$ LANGUAGE plpgsql;
         `);
        // Activar urbanizaciones existentes que ya estaban admitidas
        await sql.unsafe(`UPDATE urbanizaciones SET plan_activo = TRUE, fecha_expiracion = NOW() + INTERVAL '1 year' WHERE estado = 'admitida' AND (plan_activo IS FALSE OR plan_activo IS NULL)`);

        // Tabla: temp_pdfs (para servir PDFs temporales)
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS temp_pdfs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pdf_data BYTEA NOT NULL, codigo VARCHAR(20) DEFAULT 'documento', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_temp_pdfs_expires ON temp_pdfs(expires_at)`);

       // Función: calcular intereses moratorios (Ley 675 Art. 30 - cálculo diario)
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION calcular_intereses(p_estado_cuenta_id UUID)
        RETURNS DECIMAL(12,2) AS $$
        DECLARE
            v_ec            RECORD;
            v_params        RECORD;
            v_fecha_vcto    DATE;
            v_dias_mora     INTEGER;
            v_tasa_diaria   DECIMAL(10,8);
            v_deuda_base    DECIMAL(12,2);
            v_intereses     DECIMAL(12,2);
            v_hoy           DATE := CURRENT_DATE;
        BEGIN
            SELECT * INTO v_ec FROM estados_cuenta WHERE id = p_estado_cuenta_id;
            IF NOT FOUND OR v_ec.cerrado THEN
                RETURN 0;
            END IF;
            SELECT * INTO v_params FROM parametros_anio
            WHERE urbanizacion_id = (
                SELECT urbanizacion_id FROM propietarios WHERE id = v_ec.propietario_id
            ) AND anio = v_ec.anio;
            IF NOT FOUND THEN
                RETURN 0;
            END IF;
            v_fecha_vcto := MAKE_DATE(v_ec.anio, v_ec.mes, v_params.dia_vencimiento_sin_mora);
            IF v_hoy > v_fecha_vcto THEN
                v_dias_mora := v_hoy - v_fecha_vcto;
            ELSE
                v_dias_mora := 0;
            END IF;
            IF v_dias_mora = 0 THEN
                RETURN 0;
            END IF;
            v_deuda_base := GREATEST(0, v_ec.pago_actual + v_ec.saldo_anterior - v_ec.saldo_favor);
            IF v_deuda_base <= 0 THEN
                RETURN 0;
            END IF;
            v_tasa_diaria := v_params.tasa_mora_mensual / 30;
            v_intereses := v_tasa_diaria * v_dias_mora * v_deuda_base;
            v_intereses := ROUND(v_intereses, 2);
            RETURN v_intereses;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Función: actualizar intereses de todos los meses abiertos
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION actualizar_intereses_propietario(p_propietario_id UUID)
        RETURNS VOID AS $$
        DECLARE
            v_ec RECORD;
            v_intereses DECIMAL(12,2);
            v_dias_mora INTEGER;
            v_fecha_vcto DATE;
            v_params RECORD;
            v_hoy DATE := CURRENT_DATE;
        BEGIN
            FOR v_ec IN
                SELECT ec.id, ec.anio, ec.mes, ec.pago_actual, ec.saldo_anterior, ec.saldo_favor
                FROM estados_cuenta ec
                WHERE ec.propietario_id = p_propietario_id AND ec.cerrado = false
                ORDER BY ec.anio ASC, ec.mes ASC
            LOOP
                v_intereses := calcular_intereses(v_ec.id);
                
                -- Calcular días de mora para actualizar
                SELECT * INTO v_params FROM parametros_anio
                WHERE urbanizacion_id = (
                    SELECT urbanizacion_id FROM propietarios WHERE id = p_propietario_id
                ) AND anio = v_ec.anio;
                
                IF FOUND THEN
                    v_fecha_vcto := MAKE_DATE(v_ec.anio, v_ec.mes, v_params.dia_vencimiento_sin_mora);
                    IF v_hoy > v_fecha_vcto THEN
                        v_dias_mora := v_hoy - v_fecha_vcto;
                    ELSE
                        v_dias_mora := 0;
                    END IF;
                ELSE
                    v_dias_mora := 0;
                END IF;
                
                UPDATE estados_cuenta 
                SET intereses = v_intereses, dias_mora = v_dias_mora 
                WHERE id = v_ec.id;
            END LOOP;
        END;
        $$ LANGUAGE plpgsql;
      `);

      migrated = true;
    } finally { await sql.end(); }
  } catch (e) { console.error('Migration error:', e.message); }
}
