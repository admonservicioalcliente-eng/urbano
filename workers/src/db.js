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
      // Activar urbanizaciones existentes que ya estaban admitidas
      await sql.unsafe(`UPDATE urbanizaciones SET plan_activo = TRUE, fecha_expiracion = NOW() + INTERVAL '1 year' WHERE estado = 'admitida' AND (plan_activo IS FALSE OR plan_activo IS NULL)`);

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
