import { authMiddleware } from './auth.js';
import { ensureMigrations } from './db.js';
import * as authHandler from './handlers/auth.js';
import * as propietariosHandler from './handlers/propietarios.js';
import * as pagosHandler from './handlers/pagos.js';
import * as estadosHandler from './handlers/estados.js';
import * as cuentasCobroHandler from './handlers/cuentas_cobro.js';
import * as tempPdfHandler from './handlers/temp_pdf.js';
import * as parametrosHandler from './handlers/parametros.js';
import * as superadminHandler from './handlers/superadmin.js';
import * as usuariosHandler from './handlers/usuarios.js';
import * as paypalHandler from './handlers/paypal.js';

const corsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.FRONTEND_URL || '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
});

function jsonResponse(data, status = 200, env) {
  const body = JSON.stringify(data);
  return new Response(body, { status, headers: { ...corsHeaders(env), 'Content-Type': 'application/json' } });
}

function errorResponse(msg, status = 400, env) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders(env) });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      await ensureMigrations(env);

      if (path === '/api/debug/cleanup-estados' && method === 'POST') {
        const { query } = await import('./db.js');
        const result = await query(env, `
          DELETE FROM estados_cuenta ec
          USING propietarios p
          WHERE ec.propietario_id = p.id
            AND p.created_at IS NOT NULL
            AND (ec.anio < EXTRACT(YEAR FROM p.created_at)
                 OR (ec.anio = EXTRACT(YEAR FROM p.created_at) AND ec.mes < EXTRACT(MONTH FROM p.created_at)))
        `);
        return jsonResponse({ deleted: result.length || result.count || 0 }, 200, env);
      }

      if (path === '/api/admin/reproyectar' && method === 'POST') {
        const auth2 = await authMiddleware(request, env);
        if (auth2.error) return errorResponse(auth2.error, auth2.status, env);
        if (auth2.user.rol !== 'superadmin') return errorResponse('Solo superadmin', 403, env);
        const { query } = await import('./db.js');
        const { reconciliarPagos } = await import('./reconciliar.js');
        // backup
        await query(env, `CREATE TABLE IF NOT EXISTS estados_backup_202509 AS SELECT * FROM estados_cuenta WHERE 1=0`);
        await query(env, `INSERT INTO estados_backup_202509 SELECT * FROM estados_cuenta WHERE propietario_id IN (SELECT id FROM propietarios WHERE estado != 'inactivo')`);
        // borrar todo (incluido cerrado) para reproyectar con coef - solo valor propietario, no presupuesto default
        await query(env, `DELETE FROM estados_cuenta WHERE propietario_id IN (SELECT id FROM propietarios WHERE estado != 'inactivo')`);
        const urbs = await query(env, `SELECT id FROM urbanizaciones WHERE estado != 'rechazada'`);
        const hoy = new Date(); const anioAct = hoy.getFullYear(); const mesAct = hoy.getMonth()+1;
        let creadas = 0;
        for (const u of urbs) {
          const pars = await query(env, `SELECT anio FROM parametros_anio WHERE urbanizacion_id=$1 ORDER BY anio`, [u.id]);
          let anios = pars.map(r=>r.anio);
          if (!anios.length) anios = [anioAct];
          for (const anio of anios) {
            const hastaMes = anio === anioAct ? mesAct : 12;
            for (let m=1; m<=hastaMes; m++) {
              try { const r = await query(env, `SELECT generar_cuotas_mes($1,$2,$3) AS creadas`, [u.id, anio, m]); creadas += r[0]?.creadas||0; } catch(e) { console.error('gen', anio, m, e.message); }
            }
          }
        }
        // respetar mes_inicio/anio_inicio para morosos: borrar meses generados antes de su inicio
        await query(env, `DELETE FROM estados_cuenta ec USING propietarios p WHERE ec.propietario_id = p.id AND p.estado = 'moroso' AND p.mes_inicio IS NOT NULL AND p.anio_inicio IS NOT NULL AND (ec.anio < p.anio_inicio OR (ec.anio = p.anio_inicio AND ec.mes < p.mes_inicio))`);
        // reconciliar pagos por propietario
        const props = await query(env, `SELECT id FROM propietarios WHERE estado != 'inactivo'`);
        for (const p of props) { try { await reconciliarPagos(env, p.id); await query(env, `SELECT actualizar_intereses_propietario($1)`, [p.id]); } catch(e){} }
        return jsonResponse({ ok:true, creadas, propietarios: props.length }, 200, env);
      }

      if (path === '/api/debug/reconciliar' && method === 'POST') {
        const { query } = await import('./db.js');
        const { reconciliarPagos } = await import('./reconciliar.js');
        const propId = url.searchParams.get('propietario_id');
        if (!propId) return jsonResponse({ error: 'propietario_id requerido' }, 400, env);
        await reconciliarPagos(env, propId);
        await query(env, `SELECT actualizar_intereses_propietario($1)`, [propId]);
        return jsonResponse({ ok: true }, 200, env);
      }

      if (path === '/api/debug/cleanup-estados' && method === 'POST') {
        const { query } = await import('./db.js');
        const result = await query(env, `
          DELETE FROM estados_cuenta ec
          USING propietarios p
          WHERE ec.propietario_id = p.id
            AND p.created_at IS NOT NULL
            AND (ec.anio < EXTRACT(YEAR FROM p.created_at)
                 OR (ec.anio = EXTRACT(YEAR FROM p.created_at) AND ec.mes < EXTRACT(MONTH FROM p.created_at)))
        `);
        await query(env, `UPDATE estados_cuenta SET saldo_anterior = 0, intereses = 0 WHERE saldo_anterior > 0`);
        return jsonResponse({ deleted: result.length || result.count || 0 }, 200, env);
      }

      if (path === '/api/debug/del-cc' && method === 'POST') {
        const { query } = await import('./db.js');
        const urb = url.searchParams.get('urb');
        if (!urb) return jsonResponse({ error: 'urb requerido' }, 400, env);
        const result = await query(env, `DELETE FROM cuentas_cobro WHERE urbanizacion_id IN (SELECT id FROM urbanizaciones WHERE nombre ILIKE $1)`, [`%${urb}%`]);
        return jsonResponse({ deleted: result.length || result.count || 0 }, 200, env);
      }

      if (path === '/api/debug/reset-saldo' && method === 'POST') {
        const { query } = await import('./db.js');
        const result = await query(env, `UPDATE estados_cuenta SET saldo_anterior = 0, intereses = 0 WHERE saldo_anterior > 0`);
        return jsonResponse({ reset: result.length || result.count || 0 }, 200, env);
      }

      if (path === '/api/debug/recalc-local' && method === 'POST') {
        const { query } = await import('./db.js');
        const props = await query(env, `SELECT p.id, p.coef_local, p.valor_local, p.has_local, p.coef_apto, p.coef_celda, p.coef_cuarto_util, p.valor_celda, p.valor_cuarto_util, p.has_celda, p.has_cuarto_util, p.cuota_total, p.cuota_admon, pa.cuota_admon AS presupuesto FROM propietarios p JOIN parametros_anio pa ON pa.urbanizacion_id = p.urbanizacion_id AND pa.anio = EXTRACT(YEAR FROM NOW()) WHERE p.estado != 'inactivo'`);
        let updated = 0;
        for (const p of props) {
          const hasA = Number(p.coef_apto) > 0;
          const hasC = !!p.has_celda;
          const hasQ = !!p.has_cuarto_util;
          const hasL = !!p.has_local;
          const presupuesto = Number(p.presupuesto)||0;
          const vc = hasC ? (Number(p.valor_celda)||0) : 0;
          const vq = hasQ ? (Number(p.valor_cuarto_util)||0) : 0;
          const vl = hasL ? (Number(p.valor_local)||0) : 0;
          const cc = hasC && vc === 0 ? (Number(p.coef_celda)||0) : 0;
          const cq = hasQ && vq === 0 ? (Number(p.coef_cuarto_util)||0) : 0;
          const cl = hasL && vl === 0 ? (Number(p.coef_local)||0) : 0;
          const vApto = hasA && presupuesto > 0 ? Math.round(presupuesto * Number(p.coef_apto) / 100 * 100)/100 : 0;
          const vCelda = hasC ? (vc > 0 ? vc : (presupuesto > 0 ? Math.round(presupuesto * cc / 100 * 100)/100 : 0)) : 0;
          const vCuarto = hasQ ? (vq > 0 ? vq : (presupuesto > 0 ? Math.round(presupuesto * cq / 100 * 100)/100 : 0)) : 0;
          const vLocal = hasL ? (vl > 0 ? vl : (presupuesto > 0 ? Math.round(presupuesto * cl / 100 * 100)/100 : 0)) : 0;
          const sumDesglose = vApto + vCelda + vCuarto + vLocal;
          const totalCuota = sumDesglose > 0 ? sumDesglose : Number(p.cuota_total)||Number(p.cuota_admon)||0;
          await query(env, `UPDATE estados_cuenta SET valor_local = $1, pago_actual = $2, cerrado = false WHERE propietario_id = $3`, [vLocal, totalCuota, p.id]);
          updated++;
        }
        return jsonResponse({ updated }, 200, env);
      }

      if (path === '/api/debug/gen-cuotas' && method === 'POST') {
        const { query } = await import('./db.js');
        const mes = url.searchParams.get('mes') || (new Date().getMonth() + 1);
        const anio = url.searchParams.get('anio') || new Date().getFullYear();
        const urbs = await query(env, `SELECT id FROM urbanizaciones WHERE estado = 'admitida'`);
        let total = 0;
        for (const u of urbs) {
          const r = await query(env, `SELECT generar_cuotas_mes($1,$2,$3) AS creadas`, [u.id, anio, mes]);
          total += r[0]?.creadas || 0;
        }
        return jsonResponse({ generated: total }, 200, env);
      }

      if (path === '/api/debug/pagos' && method === 'GET') {
        const { query } = await import('./db.js');
        const propId = url.searchParams.get('propietario_id');
        if (!propId) return jsonResponse({ error: 'propietario_id requerido' }, 400, env);
        const pagos = await query(env, `SELECT id, monto, fecha_pago, tipo_pago, comprobante, descripcion, estado_cuenta_id FROM pagos WHERE propietario_id = $1 ORDER BY fecha_pago ASC`, [propId]);
        return jsonResponse({ pagos }, 200, env);
      }

      if (path === '/api/debug/pagos' && method === 'GET') {
        const { query } = await import('./db.js');
        const propId = url.searchParams.get('propietario_id');
        if (!propId) return jsonResponse({ error: 'propietario_id requerido' }, 400, env);
        const pagos = await query(env, `SELECT id, monto, fecha_pago, tipo_pago, comprobante, descripcion, estado_cuenta_id FROM pagos WHERE propietario_id = $1 ORDER BY fecha_pago ASC`, [propId]);
        return jsonResponse({ pagos }, 200, env);
      }

      if (path === '/api/debug/prop' && method === 'GET') {
        const { query } = await import('./db.js');
        const propId = url.searchParams.get('id');
        const urbName = url.searchParams.get('urb');
        const search = url.searchParams.get('search');
        if (search) {
          const props = await query(env, `SELECT p.id, p.apartamento, p.nombre_propietario, p.estado, p.mes_inicio, p.anio_inicio, p.created_at, p.cuota_admon, p.cuota_total, p.coef_apto, p.coef_celda, p.coef_cuarto_util, p.coef_local, p.valor_celda, p.valor_cuarto_util, p.valor_local, p.has_celda, p.has_cuarto_util, p.has_local, (SELECT count(*) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS num_estados, (SELECT min(ec.anio || '-' || ec.mes) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS primer_estado, (SELECT max(ec.anio || '-' || ec.mes) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS ultimo_estado FROM propietarios p JOIN urbanizaciones u ON u.id = p.urbanizacion_id WHERE p.nombre_propietario ILIKE $1 ORDER BY p.apartamento`, [`%${search}%`]);
          return jsonResponse({ propietarios: props }, 200, env);
        }
        if (urbName) {
          const props = await query(env, `SELECT p.id, p.apartamento, p.nombre_propietario, p.estado, p.mes_inicio, p.anio_inicio, p.created_at, p.cuota_admon, p.cuota_total, (SELECT count(*) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS num_estados, (SELECT min(ec.anio || '-' || ec.mes) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS primer_estado, (SELECT max(ec.anio || '-' || ec.mes) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS ultimo_estado FROM propietarios p JOIN urbanizaciones u ON u.id = p.urbanizacion_id WHERE u.nombre ILIKE $1 ORDER BY p.apartamento`, [`%${urbName}%`]);
          return jsonResponse({ propietarios: props }, 200, env);
        }
        if (search) {
          const props = await query(env, `SELECT p.id, p.apartamento, p.nombre_propietario, p.estado, p.mes_inicio, p.anio_inicio, p.created_at, p.cuota_admon, p.cuota_total, p.coef_apto, p.coef_celda, p.coef_cuarto_util, p.coef_local, p.valor_celda, p.valor_cuarto_util, p.valor_local, p.has_celda, p.has_cuarto_util, p.has_local, (SELECT count(*) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS num_estados, (SELECT min(ec.anio || '-' || ec.mes) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS primer_estado, (SELECT max(ec.anio || '-' || ec.mes) FROM estados_cuenta ec WHERE ec.propietario_id = p.id) AS ultimo_estado FROM propietarios p JOIN urbanizaciones u ON u.id = p.urbanizacion_id WHERE p.nombre_propietario ILIKE $1 ORDER BY p.apartamento`, [`%${search}%`]);
          return jsonResponse({ propietarios: props }, 200, env);
        }
        if (!propId && !urbName) return jsonResponse({ error: 'id, urb o search requerido' }, 400, env);
        const prop = await query(env, `SELECT id, apartamento, nombre_propietario, estado, mes_inicio, anio_inicio, created_at, cuota_admon, cuota_total FROM propietarios WHERE id = $1`, [propId]);
        const estados = await query(env, `SELECT id, anio, mes, pago_actual, saldo_anterior, saldo_favor, intereses, cerrado FROM estados_cuenta WHERE propietario_id = $1 ORDER BY anio ASC, mes ASC`, [propId]);
        return jsonResponse({ propietario: prop[0], estados }, 200, env);
      }

      // Public routes
      if (path === '/api/auth/login' && method === 'POST') {
        const res = await authHandler.handleLogin(request, env);
        Object.entries(corsHeaders(env)).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }

      // Public: registro de nueva urbanización + admin (queda pendiente de aprobación)
      if (path === '/api/registro-urbanizacion' && method === 'POST') {
        return superadminHandler.handleRegistroUrbanizacion(request, env);
      }

      // Public: PayPal routes
      if (path === '/api/paypal/create-order' && method === 'POST') {
        const res = await paypalHandler.handleCreateOrder(request, env);
        Object.entries(corsHeaders(env)).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }
      if (path === '/api/paypal/capture' && method === 'GET') {
        return paypalHandler.handleCapture(request, env);
      }
      if (path === '/api/paypal/cancel' && method === 'GET') {
        return paypalHandler.handleCancel(request, env);
      }

      // Public: urbanizaciones for login page (only when NOT authenticated)
      if (path === '/api/urbanizaciones' && method === 'GET' && !request.headers.get('Authorization')) {
        try {
          const { query } = await import('./db.js');
          const rows = await query(env, 'SELECT id, nombre FROM urbanizaciones WHERE estado = $1', ['admitida']);
          return jsonResponse(rows, 200, env);
        } catch (err) {
          return jsonResponse([], 200, env);
        }
      }

      // Public: logo de urbanización (para pantalla de login)
      if (path.match(/^\/api\/urbanizaciones\/[^/]+\/logo$/) && method === 'GET') {
        const urbId = path.split('/')[3];
        try {
          const { query } = await import('./db.js');
          const rows = await query(env, 'SELECT logo_base64 FROM urbanizaciones WHERE id = $1', [urbId]);
          if (rows.length && rows[0].logo_base64) {
            return jsonResponse({ logo: rows[0].logo_base64 }, 200, env);
          }
          return jsonResponse({ logo: null }, 200, env);
       } catch (err) {
           return jsonResponse({ logo: null }, 200, env);
       }
       }

        // Public: temp-pdf upload (sin autenticación)
      if (path === '/api/temp-pdf' && method === 'POST') {
        const res = await tempPdfHandler.handleStore(request, env);
        const status = res.status || (res.ok ? 200 : 400);
        return jsonResponse(res, status, env);
      }

      // Public: temp-pdf download (sin autenticación, para enlaces compartidos)
        if (path.startsWith('/api/pdf/') && method === 'GET') {
          const res = await tempPdfHandler.handleGet(request, env);
if (res instanceof Response) return res;
          return jsonResponse(res, res.status || 404, env);
        }

        // Public: short URL redirect
        if (path.startsWith('/api/s/') && method === 'GET') {
          const id = path.split('/')[3];
          const redirectUrl = 'https://nassau-api.policomputo.workers.dev/api/pdf/' + id;
          return new Response(null, { status: 302, headers: { Location: redirectUrl } });
        }

        // Protected routes
        const auth = await authMiddleware(request, env);
      if (auth.error) {
        return errorResponse(auth.error, auth.status, env);
      }
      const user = auth.user;

      // Extract dynamic ID if exists
      const pathParts = path.split('/');
      const resourceId = pathParts.length > 3 ? pathParts[3] : null;
      const subAction = pathParts.length > 4 ? pathParts[4] : null;

      let res;

      // Routing logic
      if (path === '/api/auth/me' && method === 'GET') {
        res = await authHandler.handleMe(request, env, user);
      } else if (path === '/api/auth/change-password' && method === 'POST') {
        res = await authHandler.handleChangePassword(request, env, user);
      } else if (path.startsWith('/api/propietarios')) {
        if (method === 'GET' && resourceId && subAction === 'resumen') res = await propietariosHandler.handleResumen(request, env, user, resourceId);
        else if (method === 'GET' && resourceId) res = await propietariosHandler.handleGetOne(request, env, user, resourceId);
        else if (method === 'GET') res = await propietariosHandler.handleGetAll(request, env, user);
        else if (method === 'POST') res = await propietariosHandler.handleCreate(request, env, user);
        else if (method === 'PUT' && resourceId) res = await propietariosHandler.handleUpdate(request, env, user, resourceId);
        else if (method === 'DELETE' && resourceId) res = await propietariosHandler.handleDelete(request, env, user, resourceId);
      } else if (path.startsWith('/api/pagos')) {
        if (method === 'GET') res = await pagosHandler.handleGetAll(request, env, user);
        else if (method === 'POST') res = await pagosHandler.handleCreate(request, env, user);
        else if (method === 'DELETE' && resourceId) res = await pagosHandler.handleDelete(request, env, user, resourceId);
      } else if (path.startsWith('/api/estados')) {
        if (path === '/api/estados/calcular-intereses' && method === 'POST') res = await estadosHandler.handleUpdateIntereses(request, env, user);
        else if (method === 'GET') res = await estadosHandler.handleGetByPropietario(request, env, user);
      } else if (path === '/api/dashboard' && method === 'GET') {
        res = await estadosHandler.handleGetDashboard(request, env, user);
      } else if (path.startsWith('/api/cuentas-cobro')) {
         if (method === 'GET') res = await cuentasCobroHandler.handleGetAll(request, env, user);
         else if (method === 'POST') res = await cuentasCobroHandler.handleCreate(request, env, user);
         else if (method === 'DELETE') res = await cuentasCobroHandler.handleDeleteAll(request, env, user);
       } else if (path === '/api/temp-pdf' && method === 'POST') {
         res = await tempPdfHandler.handleStore(request, env, user);
       } else if (path.startsWith('/api/pdf/') && method === 'GET') {
         res = await tempPdfHandler.handleGet(request, env, user);
} else if (path.startsWith('/api/parametros')) {
         if (method === 'GET') res = await parametrosHandler.handleGet(request, env, user);
         else if (method === 'POST') res = await parametrosHandler.handleCreate(request, env, user);
         else if (method === 'PUT' && resourceId) res = await parametrosHandler.handleUpdate(request, env, user, resourceId);
         else if (method === 'DELETE' && resourceId) res = await parametrosHandler.handleDelete(request, env, user, resourceId);
       } else if (path === '/api/cuotas/generar' && method === 'POST') {
        res = await parametrosHandler.handleGenerarCuotas(request, env, user);
      } else if (path.startsWith('/api/urbanizaciones')) {
        if (method === 'GET') res = await superadminHandler.handleGetUrbanizaciones(request, env, user);
        else if (method === 'POST') res = await superadminHandler.handleCreateUrbanizacion(request, env, user);
        else if (method === 'PUT' && resourceId && subAction === 'estado') res = await superadminHandler.handleUpdateEstado(request, env, user, resourceId);
        else if (method === 'PUT' && resourceId && subAction === 'logo') res = await superadminHandler.handleUpdateLogo(request, env, user, resourceId);
        else if (method === 'PUT' && resourceId) res = await superadminHandler.handleUpdateUrbanizacion(request, env, user, resourceId);
      } else if (path.startsWith('/api/usuarios')) {
        if (method === 'GET') res = await usuariosHandler.handleGetAll(request, env, user);
        else if (method === 'POST') res = await usuariosHandler.handleCreate(request, env, user);
        else if (method === 'PUT' && resourceId && subAction === 'revoke') res = await usuariosHandler.handleRevoke(request, env, user, resourceId);
        else if (method === 'PUT' && resourceId && subAction === 'reinstate') res = await usuariosHandler.handleReinstate(request, env, user, resourceId);
        else if (method === 'PUT' && resourceId) res = await usuariosHandler.handleUpdate(request, env, user, resourceId);
        else if (method === 'DELETE' && resourceId) res = await usuariosHandler.handleDelete(request, env, user, resourceId);
      } else if (path === '/api/admin/stats' && method === 'GET') {
        res = await superadminHandler.handleGetStats(request, env, user);
      } else if (path === '/api/paypal/renew' && method === 'POST') {
        res = await paypalHandler.handleRenew(request, env);
      } else if (path.match(/^\/api\/paypal\/status\/[^/]+$/) && method === 'GET') {
        res = await paypalHandler.handleStatus(request, env, user, resourceId);
      } else if (!path.startsWith('/api/')) {
        // Serve static assets for non-API routes (force no-cache so HTML updates instantly)
        const assetRes = await env.ASSETS.fetch(request);
        const headers = new Headers(assetRes.headers);
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        return new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers });
      } else {
        return errorResponse('Route not found', 404, env);
      }

      if (res) {
        Object.entries(corsHeaders(env)).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }
      return errorResponse('Method Not Allowed', 405, env);

    } catch (err) {
      console.error(err);
      return errorResponse(err.message || 'Internal Server Error', 500, env);
    }
  },

async scheduled(event, env, ctx) {
     console.log('Cron triggered:', event.cron);
     ctx.waitUntil(this.generateMonthlyCuotas(env));
     ctx.waitUntil(tempPdfHandler.handleCleanup(env));
   },

  async generateMonthlyCuotas(env) {
    const { query } = await import('./db.js');
    const { reconciliarPagos } = await import('./reconciliar.js');
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;

    try {
      const urbanizaciones = await query(env,
        `SELECT id, nombre FROM urbanizaciones WHERE estado = 'admitida'`
      );

      let totalGeneradas = 0;
      for (const urb of urbanizaciones) {
        try {
          const res = await query(env,
            `SELECT generar_cuotas_mes($1, $2, $3) AS creadas`,
            [urb.id, anio, mes]
          );
          const creadas = res[0]?.creadas || 0;
          totalGeneradas += creadas;
          console.log(`Urbanización ${urb.nombre}: ${creadas} cuotas generadas`);
        } catch (e) {
          console.error(`Error generando cuotas para ${urb.nombre}:`, e.message);
        }
      }
      // Reconciliar pagos de todos los propietarios después de generar cuotas
      const props = await query(env, `SELECT id FROM propietarios WHERE estado != 'inactivo'`);
      for (const p of props) {
        try { await reconciliarPagos(env, p.id); } catch(e) {}
      }
      console.log(`Total cuotas generadas: ${totalGeneradas}`);
    } catch (e) {
      console.error('Error en generación automática de cuotas:', e.message);
    }
  }
};

