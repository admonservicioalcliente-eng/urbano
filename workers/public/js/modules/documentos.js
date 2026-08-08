window.NassauDocumentos = {
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Cuentas de Cobro Generadas</h2>
                <button class="btn-secondary" onclick="window.NassauDocumentos.loadDocumentos()">Actualizar</button>
            </div>
            <div class="card table-container">
                <table class="premium-table" id="docs-table">
                    <thead><tr><th>Código</th><th>Fecha Emisión</th><th>Propietario</th><th>Total</th><th>Acciones</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;
        document.getElementById('page-cobros').innerHTML = html;
        await this.loadDocumentos();
    },
    async loadDocumentos() {
        try {
            window.NassauApp.showLoading(true);
            const docs = await window.NassauAPI.apiGet('/cuentas-cobro');
            const tbody = document.querySelector('#docs-table tbody');
            if(docs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay documentos generados</td></tr>';
                return;
            }
            tbody.innerHTML = docs.map(d => `
                <tr>
                    <td><strong>${d.codigo}</strong></td><td>${new Date(d.fecha_emision).toLocaleDateString()}</td>
                    <td>${d.propietario_nombre}</td><td>$${Number(d.total_documento).toLocaleString()}</td>
                    <td><button class="btn-primary btn-sm" onclick='window.NassauDocumentos.reprintPDF(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Imprimir / PDF</button></td>
                </tr>`).join('');
        } catch(e) { window.NassauApp.showToast('Error cargando documentos', 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    reprintPDF(d) { this.generatePDF(d); },
    generatePDF(data) {
        if (!window.jspdf) { window.NassauApp.showToast('Librería PDF no cargada', 'error'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFont('helvetica');
        doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.text('EDIFICIO NASSAU P.H.', 105, 20, { align: 'center' });
        doc.setFontSize(12); doc.setFont('helvetica', 'normal'); doc.text('Cll 32F # 66c-27', 105, 28, { align: 'center' });
        
        doc.setFontSize(14); doc.setTextColor(200, 0, 0); doc.text(`Documento: ${data.codigo || 'NAS-000'}`, 190, 20, { align: 'right' });
        doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text(`Fecha: ${new Date(data.fecha_emision || Date.now()).toLocaleDateString()}`, 190, 28, { align: 'right' });
        
        doc.line(15, 35, 195, 35);
        
        doc.setFont('helvetica', 'bold'); doc.text('Señor(a):', 15, 45); doc.setFont('helvetica', 'normal'); doc.text(data.propietario_nombre || '', 40, 45);
        doc.setFont('helvetica', 'bold'); doc.text('Apartamento:', 15, 52); doc.setFont('helvetica', 'normal'); doc.text(data.propietario_apto || '', 45, 52);

        doc.line(15, 60, 195, 60);
        doc.setFont('helvetica', 'bold'); doc.text('Concepto', 20, 67); doc.text('Valor', 160, 67);
        doc.line(15, 70, 195, 70);

        doc.setFont('helvetica', 'normal');
        let y = 80;
        doc.text('Cuota de Administración', 20, y); doc.text(`$${Number(data.cuota_admon || 0).toLocaleString()}`, 160, y); y += 10;
        doc.text('Saldo Anterior', 20, y); doc.text(`$${Number(data.saldo_anterior || 0).toLocaleString()}`, 160, y); y += 10;
        doc.text('Intereses de Mora', 20, y); doc.text(`$${Number(data.intereses || 0).toLocaleString()}`, 160, y); y += 15;

        doc.line(150, y-5, 195, y-5);
        doc.setFontSize(14); doc.setFont('helvetica', 'bold');
        doc.text('TOTAL A PAGAR:', 100, y); doc.text(`$${Number(data.total_documento || 0).toLocaleString()}`, 160, y);
        
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.line(15, 250, 195, 250);
        doc.setFont('helvetica', 'bold'); doc.text('BANCOLOMBIA cuenta de ahorros No 106-251007-73', 105, 260, { align: 'center' });
        doc.text('PAULA ANDREA HERRERA CANO', 105, 265, { align: 'center' });
        
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        const legal = 'De conformidad con la Ley 675 de 2001 de Propiedad Horizontal, se hace efectivo el cobro de las cuotas de administración.';
        doc.text(legal, 105, 275, { align: 'center', maxWidth: 180 });
        doc.setTextColor(150, 150, 150); doc.text('DOCUMENTO PROVISIONAL', 105, 285, { align: 'center' });
        doc.save(`${data.codigo || 'documento'}.pdf`);
    }
};