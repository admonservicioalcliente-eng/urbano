-- ============================================================
-- SEEDS - Datos iniciales del sistema Nassau P.H.
-- Ejecutar DESPUÉS de schema.sql
-- ============================================================

-- 1. Urbanización Nassau P.H.
INSERT INTO urbanizaciones (id, nombre, direccion, estado, prefijo_doc)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000001',
    'Edificio Nassau P.H.',
    'Cll 32F # 66c-27',
    'admitida',
    'NAS'
);

-- 2. Parámetros año 2025
INSERT INTO parametros_anio (urbanizacion_id, anio, tasa_mora_mensual, dia_generacion_cuota, dia_vencimiento_sin_mora, dia_inicio_mora)
VALUES ('a1b2c3d4-0001-0001-0001-000000000001', 2025, 0.0150, 1, 5, 6);

-- 3. Parámetros año 2026
INSERT INTO parametros_anio (urbanizacion_id, anio, tasa_mora_mensual, dia_generacion_cuota, dia_vencimiento_sin_mora, dia_inicio_mora)
VALUES ('a1b2c3d4-0001-0001-0001-000000000001', 2026, 0.0150, 1, 5, 6);

-- 4. Usuario SuperAdmin
-- Contraseña: Nassau2026! (cambiar después del primer login)
-- Hash bcrypt de 'Nassau2026!' (cost 10)
INSERT INTO usuarios (nombre, email, password_hash, rol, urbanizacion_id)
VALUES (
    'Super Administrador',
    'superadmin@nassau.com',
    '$2a$10$xJ8GkTqI3Z7mQ9vL4wN2aO5HpR6sK0nM1yB8cF3dE7tU2iV9wX4qG',
    'superadmin',
    NULL
);

-- 5. Admin del Edificio Nassau
INSERT INTO usuarios (nombre, email, password_hash, rol, urbanizacion_id)
VALUES (
    'Paula Andrea Herrera Cano',
    'admin@nassau.com',
    '$2a$10$xJ8GkTqI3Z7mQ9vL4wN2aO5HpR6sK0nM1yB8cF3dE7tU2iV9wX4qG',
    'admin_urb',
    'a1b2c3d4-0001-0001-0001-000000000001'
);

-- NOTA: Los hashes anteriores son placeholders.
-- Al iniciar el sistema, el primer login debe cambiar la contraseña.
-- Contraseña temporal para ambos: Nassau2026!
-- ============================================================

-- 6. Propietarios de ejemplo (ajustar con datos reales)
-- Descomentar y editar para cargar los propietarios reales

/*
INSERT INTO propietarios (urbanizacion_id, nombre_propietario, apartamento, no_celda, cuota_admon, estado, modo_pago)
VALUES
('a1b2c3d4-0001-0001-0001-000000000001', 'NOMBRE PROPIETARIO 101', '101', 'C-01', 250000.00, 'activo', 'transferencia'),
('a1b2c3d4-0001-0001-0001-000000000001', 'NOMBRE PROPIETARIO 102', '102', 'C-02', 250000.00, 'activo', 'transferencia'),
('a1b2c3d4-0001-0001-0001-000000000001', 'NOMBRE PROPIETARIO 201', '201', 'C-03', 250000.00, 'activo', 'efectivo'),
('a1b2c3d4-0001-0001-0001-000000000001', 'NOMBRE PROPIETARIO 202', '202', 'C-04', 250000.00, 'moroso', 'transferencia');
*/
