import { query } from '../db.js';

export async function handleStore(request, env, user) {
  try {
    const { pdfBase64, codigo } = await request.json();
    if (!pdfBase64) return { error: 'pdfBase64 requerido', status: 400 };
    const id = crypto.randomUUID();
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    await query(env, `
      INSERT INTO temp_pdfs (id, pdf_data, codigo, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')
    `, [id, pdfBuffer, codigo || 'documento']);
    return { success: true, id, url: `${env.FRONTEND_URL || 'https://nassau-api.policomputo.workers.dev'}/api/pdf/${id}` };
  } catch(e) {
    console.error('Error storing temp PDF', e);
    return { error: 'Error storing PDF', status: 500 };
  }
}

export async function handleGet(request, env, user) {
  try {
    const id = request.url.split('/').pop();
    const row = await query(env, `SELECT pdf_data, codigo FROM temp_pdfs WHERE id = $1 AND expires_at > NOW()`, [id]);
    if (!row.length) return { error: 'PDF no encontrado o expirado', status: 404 };
    return new Response(row[0].pdf_data, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${row[0].codigo || 'documento'}.pdf"`,
        'Cache-Control': 'no-cache'
      }
    });
  } catch(e) {
    console.error('Error getting temp PDF', e);
    return { error: 'Error retrieving PDF', status: 500 };
  }
}

export async function handleCleanup(env) {
  try {
    await query(env, `DELETE FROM temp_pdfs WHERE expires_at < NOW()`);
    return { success: true };
  } catch(e) {
    console.error('Error cleaning up temp PDFs', e);
    return { error: 'Cleanup error', status: 500 };
  }
}
