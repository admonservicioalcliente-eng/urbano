// SQL compartido para sincronizar el estado de los propietarios con su deuda
// hasta el mes anterior (sin contar la cuota del mes en curso).
//
// $1 = año actual, $2 = mes actual.
// - Con deuda pendiente en meses anteriores => 'moroso'
// - Sin deuda (o saldo a favor) hasta el mes anterior => 'activo'
// - Se respetan los estados manuales 'inactivo' y 'abono_inicial'.
//
// Se usa el saldo PROPIO de cada mes (pago_actual + intereses - saldo_favor).
// NO se suma saldo_anterior: es deuda acumulada que ya está representada por
// los meses previos y sumarla duplicaba la deuda.
export const SYNC_ESTADOS_SQL = `
WITH deuda AS (
  SELECT p.id,
    COALESCE(SUM(
      GREATEST(0, ec.pago_actual + ec.intereses - ec.saldo_favor)
    ) FILTER (
      WHERE ec.cerrado = false
        AND (ec.anio < $1 OR (ec.anio = $1 AND ec.mes < $2))
    ), 0) AS deuda
  FROM propietarios p
  LEFT JOIN estados_cuenta ec ON ec.propietario_id = p.id
  GROUP BY p.id
)
UPDATE propietarios p
SET estado = (CASE WHEN d.deuda > 0.009 THEN 'moroso' ELSE 'activo' END)::estado_propietario,
    updated_at = NOW()
FROM deuda d
WHERE p.id = d.id
  AND p.estado NOT IN ('inactivo', 'abono_inicial')
  AND p.estado IS DISTINCT FROM (CASE WHEN d.deuda > 0.009 THEN 'moroso' ELSE 'activo' END)::estado_propietario
RETURNING p.id, p.estado
`;
