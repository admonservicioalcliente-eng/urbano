-- ============================================================
-- SISTEMA DE PAGOS - EDIFICIO NASSAU P.H.
-- Schema PostgreSQL completo v1.0
-- Ejecutar en PGAdmin 4 conectado a Neon.tech
-- ============================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TIPOS ENUMERADOS
-- ============================================================
CREATE TYPE estado_urbanizacion AS ENUM ('admitida', 'rechazada', 'pendiente');
CREATE TYPE rol_usuario          AS ENUM ('superadmin', 'admin_urb', 'propietario');
CREATE TYPE estado_propietario   AS ENUM ('activo', 'moroso', 'inactivo');
CREATE TYPE modo_pago_tipo       AS ENUM ('efectivo', 'transferencia', 'PSE', 'cheque', 'otro');
CREATE TYPE tipo_pago_enum       AS ENUM ('cuota_regular', 'cuota_extra', 'interes', 'abono', 'descuento');

-- ============================================================
-- TABLA: urbanizaciones
-- ============================================================
CREATE TABLE urbanizaciones (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre       VARCHAR(150) NOT NULL,
    direccion    VARCHAR(250),
    nit          VARCHAR(30),
    telefono     VARCHAR(20),
    email        VARCHAR(100),
    estado       estado_urbanizacion NOT NULL DEFAULT 'pendiente',
    prefijo_doc  VARCHAR(10) NOT NULL DEFAULT 'NAS',
    banco_numero_cuenta  VARCHAR(30),
    banco_tipo_cuenta    VARCHAR(20) DEFAULT 'ahorros',
    banco_nombre         VARCHAR(100),
    banco_titular        VARCHAR(150),
    banco_celular        VARCHAR(20),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: parametros_anio (tasa de mora configurable por año)
-- ============================================================
CREATE TABLE parametros_anio (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    urbanizacion_id          UUID NOT NULL REFERENCES urbanizaciones(id) ON DELETE CASCADE,
    anio                     INTEGER NOT NULL,
    tasa_mora_mensual        DECIMAL(6,4) NOT NULL DEFAULT 0.0150,
    dia_generacion_cuota     INTEGER NOT NULL DEFAULT 1,
    dia_vencimiento_sin_mora INTEGER NOT NULL DEFAULT 5,
    dia_inicio_mora          INTEGER NOT NULL DEFAULT 6,
    cuota_admon              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(urbanizacion_id, anio)
);

-- ============================================================
-- TABLA: usuarios
-- ============================================================
CREATE TABLE usuarios (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    urbanizacion_id  UUID REFERENCES urbanizaciones(id) ON DELETE SET NULL,
    nombre           VARCHAR(150) NOT NULL,
    email            VARCHAR(100) NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    rol              rol_usuario NOT NULL DEFAULT 'admin_urb',
    activo           BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_expiracion TIMESTAMPTZ,
    ultimo_login     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: propietarios
-- ============================================================
CREATE TABLE propietarios (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    urbanizacion_id     UUID NOT NULL REFERENCES urbanizaciones(id) ON DELETE CASCADE,
    nombre_propietario  VARCHAR(200) NOT NULL,
    apartamento         VARCHAR(20) NOT NULL,
    no_celda            VARCHAR(30),
    cuota_admon         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    estado              estado_propietario NOT NULL DEFAULT 'activo',
    numero_cuenta       VARCHAR(60),
    modo_pago           modo_pago_tipo NOT NULL DEFAULT 'efectivo',
    telefono            VARCHAR(30),
    email               VARCHAR(100),
    notas               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(urbanizacion_id, apartamento)
);

-- ============================================================
-- TABLA: estados_cuenta (un registro por propietario x mes x año)
-- ============================================================
CREATE TABLE estados_cuenta (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    propietario_id   UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
    anio             INTEGER NOT NULL,
    mes              INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    pago_actual      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    saldo_anterior   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    saldo_favor      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    intereses        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_deuda      DECIMAL(12,2) GENERATED ALWAYS AS (
                         pago_actual + saldo_anterior + intereses - saldo_favor
                     ) STORED,
    fecha_vencimiento DATE,
    generado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cerrado          BOOLEAN NOT NULL DEFAULT FALSE,
    notas            TEXT,
    UNIQUE(propietario_id, anio, mes)
);

-- ============================================================
-- TABLA: pagos
-- ============================================================
CREATE TABLE pagos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    propietario_id     UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
    estado_cuenta_id   UUID REFERENCES estados_cuenta(id) ON DELETE SET NULL,
    monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    fecha_pago         DATE NOT NULL,
    tipo_pago          tipo_pago_enum NOT NULL DEFAULT 'cuota_regular',
    comprobante        VARCHAR(100),
    descripcion        TEXT,
    registrado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: cuotas_extras
-- ============================================================
CREATE TABLE cuotas_extras (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    urbanizacion_id  UUID NOT NULL REFERENCES urbanizaciones(id) ON DELETE CASCADE,
    propietario_id   UUID REFERENCES propietarios(id) ON DELETE CASCADE,
    descripcion      VARCHAR(300) NOT NULL,
    monto            DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    fecha_vencimiento DATE NOT NULL,
    aplicado         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLA: cuentas_cobro (documentos NAS##)
-- ============================================================
CREATE TABLE cuentas_cobro (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    urbanizacion_id  UUID NOT NULL REFERENCES urbanizaciones(id) ON DELETE CASCADE,
    propietario_id   UUID NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
    consecutivo      INTEGER NOT NULL,
    codigo_doc       VARCHAR(20) NOT NULL,
    fecha_generacion DATE NOT NULL DEFAULT CURRENT_DATE,
    total_deuda      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    detalle_json     JSONB,
    generado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(urbanizacion_id, consecutivo)
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_propietarios_urb      ON propietarios(urbanizacion_id);
CREATE INDEX idx_propietarios_apto     ON propietarios(apartamento);
CREATE INDEX idx_estados_cuenta_prop   ON estados_cuenta(propietario_id);
CREATE INDEX idx_estados_cuenta_anio   ON estados_cuenta(anio, mes);
CREATE INDEX idx_pagos_propietario     ON pagos(propietario_id);
CREATE INDEX idx_pagos_fecha           ON pagos(fecha_pago);
CREATE INDEX idx_cuentas_cobro_prop    ON cuentas_cobro(propietario_id);
CREATE INDEX idx_usuarios_email        ON usuarios(email);

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_urbanizaciones_ua BEFORE UPDATE ON urbanizaciones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_usuarios_ua       BEFORE UPDATE ON usuarios       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_propietarios_ua   BEFORE UPDATE ON propietarios   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- FUNCIÓN: generar cuotas mensuales automáticas (llamada por cron)
-- ============================================================
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
BEGIN
    SELECT * INTO v_params FROM parametros_anio
    WHERE urbanizacion_id = p_urbanizacion_id AND anio = p_anio;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sin parámetros para año %', p_anio;
    END IF;

    v_fecha_vcto := MAKE_DATE(p_anio, p_mes, v_params.dia_vencimiento_sin_mora);

    IF p_mes = 1 THEN
        v_mes_anterior  := 12;
        v_anio_anterior := p_anio - 1;
    ELSE
        v_mes_anterior  := p_mes - 1;
        v_anio_anterior := p_anio;
    END IF;

    FOR v_prop IN
        SELECT * FROM propietarios
        WHERE urbanizacion_id = p_urbanizacion_id AND estado != 'inactivo'
    LOOP
        -- Traer deuda del mes anterior
        SELECT GREATEST(0, COALESCE(total_deuda, 0) - COALESCE(saldo_favor, 0))
        INTO v_saldo_ant
        FROM estados_cuenta
        WHERE propietario_id = v_prop.id
          AND anio = v_anio_anterior AND mes = v_mes_anterior;

        IF v_saldo_ant IS NULL THEN v_saldo_ant := 0; END IF;

        INSERT INTO estados_cuenta (
            propietario_id, anio, mes, pago_actual,
            saldo_anterior, saldo_favor, intereses, fecha_vencimiento
        )
        VALUES (
            v_prop.id, p_anio, p_mes,
            CASE WHEN v_params.cuota_admon > 0 THEN v_params.cuota_admon ELSE v_prop.cuota_admon END,
            v_saldo_ant, 0, 0, v_fecha_vcto
        )
        ON CONFLICT (propietario_id, anio, mes) DO NOTHING;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN: calcular intereses moratorios (Ley 675 Art. 30)
-- Cálculo DIARIO: (tasa_mensual / 30) × días_retraso × deuda
-- ============================================================
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
    -- Obtener el estado de cuenta
    SELECT * INTO v_ec FROM estados_cuenta WHERE id = p_estado_cuenta_id;
    
    IF NOT FOUND OR v_ec.cerrado THEN
        RETURN 0;
    END IF;
    
    -- Obtener parámetros de mora
    SELECT * INTO v_params FROM parametros_anio
    WHERE urbanizacion_id = (
        SELECT urbanizacion_id FROM propietarios WHERE id = v_ec.propietario_id
    ) AND anio = v_ec.anio;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- Calcular fecha de vencimiento
    v_fecha_vcto := MAKE_DATE(v_ec.anio, v_ec.mes, v_params.dia_vencimiento_sin_mora);
    
    -- Calcular días de mora (desde día después del vencimiento)
    IF v_hoy > v_fecha_vcto THEN
        v_dias_mora := v_hoy - v_fecha_vcto;
    ELSE
        v_dias_mora := 0;
    END IF;
    
    -- Si no hay días de mora, no hay intereses
    IF v_dias_mora = 0 THEN
        RETURN 0;
    END IF;
    
    -- Calcular deuda base (cuota + saldo anterior - saldo a favor)
    v_deuda_base := GREATEST(0, 
        v_ec.pago_actual + v_ec.saldo_anterior - v_ec.saldo_favor
    );
    
    -- Si no hay deuda, no hay intereses
    IF v_deuda_base <= 0 THEN
        RETURN 0;
    END IF;
    
    -- Calcular tasa diaria (Ley 675: tasa mensual / 30)
    v_tasa_diaria := v_params.tasa_mora_mensual / 30;
    
    -- Calcular intereses: tasa_diaria × días × deuda
    v_intereses := v_tasa_diaria * v_dias_mora * v_deuda_base;
    
    -- Redondear a 2 decimales
    v_intereses := ROUND(v_intereses, 2);
    
    -- Actualizar días de mora en el estado de cuenta
    UPDATE estados_cuenta SET dias_mora = v_dias_mora WHERE id = p_estado_cuenta_id;
    
    RETURN v_intereses;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCIÓN: actualizar intereses de todos los meses abiertos
-- ============================================================
CREATE OR REPLACE FUNCTION actualizar_intereses_propietario(p_propietario_id UUID)
RETURNS VOID AS $$
DECLARE
    v_ec RECORD;
    v_intereses DECIMAL(12,2);
BEGIN
    FOR v_ec IN
        SELECT id FROM estados_cuenta
        WHERE propietario_id = p_propietario_id AND cerrado = false
        ORDER BY anio ASC, mes ASC
    LOOP
        v_intereses := calcular_intereses(v_ec.id);
        UPDATE estados_cuenta SET intereses = v_intereses WHERE id = v_ec.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VISTA: resumen_propietarios (útil para dashboard)
-- ============================================================
CREATE OR REPLACE VIEW v_resumen_propietarios AS
SELECT
    p.id,
    p.urbanizacion_id,
    p.nombre_propietario,
    p.apartamento,
    p.no_celda,
    p.cuota_admon,
    p.estado,
    p.modo_pago,
    COALESCE(SUM(ec.total_deuda), 0)  AS deuda_total,
    COALESCE(SUM(ec.saldo_favor), 0)  AS saldo_a_favor,
    COUNT(CASE WHEN ec.total_deuda > 0 AND ec.cerrado = false THEN 1 END) AS meses_pendientes
FROM propietarios p
LEFT JOIN estados_cuenta ec ON ec.propietario_id = p.id
GROUP BY p.id, p.urbanizacion_id, p.nombre_propietario, p.apartamento,
         p.no_celda, p.cuota_admon, p.estado, p.modo_pago;
