import { query } from '../db.js';

export async function handleStore(request, env, user) {
  try {
    const { pdfBase64, codigo } = await request.json();
    if (!pdfBase64) return { error: 'pdfBase64 requerido', status: 400 };
    const id = crypto.randomUUID();
    const base64Data = pdfBase64.replace(/^data:[^;]+;base64,/, '');
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    await query(env, `
      INSERT INTO temp_pdfs (id, pdf_data, codigo, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')
    `, [id, bytes, codigo || 'documento']);
    const baseUrl = new URL(request.url).origin;
    return { success: true, id, url: `${baseUrl}/api/pdf/${id}` };
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
