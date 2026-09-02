// handlers/paypal.js — PayPal integration for subscriptions
import { query } from '../db.js';

const PAYPAL_API = 'https://api-m.sandbox.paypal.com';
const ANUAL_PRICE = '29.00';
const CURRENCY = 'USD';

function ok(data, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
function err(status, message) {
  return new Response(JSON.stringify({ ok: false, message }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

async function getAccessToken(env) {
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

/**
 * POST /api/paypal/create-order
 * Body: { urb_id, email, nombre }
 * Creates a PayPal order and returns the approval URL
 */
export async function handleCreateOrder(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { urb_id, email, nombre } = body;
  if (!urb_id || !email) return err(400, 'urb_id y email requeridos');

  try {
    const token = await getAccessToken(env);
    const frontendUrl = env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev';

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: urb_id,
          description: 'Nassau P.H. - Suscripción Anual',
          amount: {
            currency_code: CURRENCY,
            value: ANUAL_PRICE,
            breakdown: {
              item_total: { currency_code: CURRENCY, value: ANUAL_PRICE }
            }
          },
          items: [{
            name: 'Nassau P.H. - Plan Anual',
            description: 'Suscripción anual para administración de edificio',
            unit_amount: { currency_code: CURRENCY, value: ANUAL_PRICE },
            quantity: '1'
          }]
        }],
        application_context: {
          brand_name: 'Nassau P.H.',
          landing_page: 'BILLING',
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          return_url: `${frontendUrl}/api/paypal/capture?urb_id=${urb_id}&email=${encodeURIComponent(email)}`,
          cancel_url: `${frontendUrl}/api/paypal/cancel?urb_id=${urb_id}`
        }
      })
    });

    const orderData = await orderRes.json();

    if (orderData.id) {
      const approveUrl = orderData.links?.find(l => l.rel === 'approve')?.href;
      return ok({ orderId: orderData.id, approveUrl, price: ANUAL_PRICE, currency: CURRENCY });
    }

    console.error('PayPal order error:', JSON.stringify(orderData));
    return err(500, orderData.message || orderData.error || 'Error creando orden PayPal');
  } catch (e) {
    return err(500, e.message);
  }
}

/**
 * GET /api/paypal/capture?token=...&urb_id=...&email=...
 * PayPal redirects here after user approves payment
 */
export async function handleCapture(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const urb_id = url.searchParams.get('urb_id');
  const email = url.searchParams.get('email');

  if (!token || !urb_id) {
    const frontendUrl = env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev';
    return Response.redirect(`${frontendUrl}/?error=missing_params`, 302);
  }

  try {
    const accessToken = await getAccessToken(env);

    const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${token}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const captureData = await captureRes.json();

    if (captureData.status === 'COMPLETED') {
      const now = new Date();
      const expiry = new Date(now);
      expiry.setFullYear(expiry.getFullYear() + 1);

      const captureId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id || token;
      const amount = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || ANUAL_PRICE;

      // Activate urbanizacion
      await query(env,
        `UPDATE urbanizaciones
         SET estado = 'admitida', plan_activo = TRUE, fecha_pago = $1,
             fecha_expiracion = $2, paypal_order_id = $3, monto_pago = $4, updated_at = NOW()
         WHERE id = $5`,
        [now.toISOString(), expiry.toISOString(), captureId, parseFloat(amount), urb_id]
      );

      // Activate admin user with matching expiry
      await query(env,
        `UPDATE usuarios SET fecha_expiracion = $1 WHERE urbanizacion_id = $2 AND rol = 'admin_urb'`,
        [expiry.toISOString(), urb_id]
      );

      const frontendUrl = env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev';
      return Response.redirect(`${frontendUrl}/?payment=success`, 302);
    }

    const frontendUrl = env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev';
    return Response.redirect(`${frontendUrl}/?payment=failed`, 302);
  } catch (e) {
    const frontendUrl = env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev';
    return Response.redirect(`${frontendUrl}/?payment=error`, 302);
  }
}

/**
 * GET /api/paypal/cancel?urb_id=...
 * User cancelled PayPal payment
 */
export async function handleCancel(request, env) {
  const url = new URL(request.url);
  const urb_id = url.searchParams.get('urb_id');
  const frontendUrl = env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev';
  return Response.redirect(`${frontendUrl}/?payment=cancelled`, 302);
}

/**
 * POST /api/paypal/renew
 * Body: { urb_id }
 * Creates a new order for renewal
 */
export async function handleRenew(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'JSON inválido'); }

  const { urb_id } = body;
  if (!urb_id) return err(400, 'urb_id requerido');

  try {
    const rows = await query(env, `SELECT id, nombre, email FROM urbanizaciones WHERE id = $1`, [urb_id]);
    if (!rows.length) return err(404, 'Urbanización no encontrada');

    const urb = rows[0];
    const newBody = { urb_id: urb.id, email: urb.email, nombre: urb.nombre };

    const orderRes = await handleCreateOrder({ json: async () => newBody }, env);
    return orderRes;
  } catch (e) {
    return err(500, e.message);
  }
}

/**
 * GET /api/paypal/status/:urb_id
 * Returns subscription status for an urbanizacion
 */
export async function handleStatus(request, env, user, urbId) {
  try {
    const rows = await query(env,
      `SELECT plan_activo, fecha_pago, fecha_expiracion, monto_pago, paypal_order_id
       FROM urbanizaciones WHERE id = $1`,
      [urbId]
    );
    if (!rows.length) return err(404, 'Urbanización no encontrada');

    const urb = rows[0];
    const now = new Date();
    const exp = urb.fecha_expiracion ? new Date(urb.fecha_expiracion) : null;
    const diasRestantes = exp ? Math.ceil((exp - now) / (1000 * 60 * 60 * 24)) : null;
    const preaviso30 = diasRestantes !== null && diasRestantes <= 30 && diasRestantes > 0;
    const vencido = exp ? exp < now : false;

    return ok({
      plan_activo: urb.plan_activo,
      fecha_pago: urb.fecha_pago,
      fecha_expiracion: urb.fecha_expiracion,
      monto_pago: urb.monto_pago,
      paypal_order_id: urb.paypal_order_id,
      dias_restantes: diasRestantes,
      preaviso_30_dias: preaviso30,
      vencido
    });
  } catch (e) {
    return err(500, e.message);
  }
}
