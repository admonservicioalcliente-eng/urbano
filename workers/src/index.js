import { authMiddleware } from './auth.js';
import * as authHandler from './handlers/auth.js';
import * as propietariosHandler from './handlers/propietarios.js';
import * as pagosHandler from './handlers/pagos.js';
import * as estadosHandler from './handlers/estados.js';
import * as cuentasCobroHandler from './handlers/cuentas_cobro.js';
import * as parametrosHandler from './handlers/parametros.js';
import * as superadminHandler from './handlers/superadmin.js';

const corsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.FRONTEND_URL || '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS,PUT,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
});

function jsonResponse(data, status = 200, env) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(env) });
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
      // Public routes
      if (path === '/api/auth/login' && method === 'POST') {
        const res = await authHandler.handleLogin(request, env);
        Object.entries(corsHeaders(env)).forEach(([k, v]) => res.headers.set(k, v));
        return res;
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
      } else if (path.startsWith('/api/parametros')) {
        if (method === 'GET') res = await parametrosHandler.handleGet(request, env, user);
        else if (method === 'POST') res = await parametrosHandler.handleCreate(request, env, user);
      } else if (path === '/api/cuotas/generar' && method === 'POST') {
        res = await parametrosHandler.handleGenerarCuotas(request, env, user);
      } else if (path.startsWith('/api/urbanizaciones')) {
        if (method === 'GET') res = await superadminHandler.handleGetUrbanizaciones(request, env, user);
        else if (method === 'POST') res = await superadminHandler.handleCreateUrbanizacion(request, env, user);
        else if (method === 'PUT' && resourceId && subAction === 'estado') res = await superadminHandler.handleUpdateEstado(request, env, user, resourceId);
      } else if (path === '/api/admin/stats' && method === 'GET') {
        res = await superadminHandler.handleGetStats(request, env, user);
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
    // Basic implementation of the cron event triggered every 1-5 day of month.
    // In reality, we'd need to iterate all active urbanizaciones and call the handler
    // We'll stub this based on the user req.
    console.log('Cron triggered:', event.cron);
    // ctx.waitUntil(runScheduledGeneration(env));
  }
};
