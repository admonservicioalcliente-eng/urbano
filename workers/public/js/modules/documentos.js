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
            tbody.innerHTML = docs.map(d => {
                const fecha = d.fecha_emision || d.fecha_generacion;
                const fechaStr = fecha ? new Date(fecha).toLocaleDateString() : '';
                const totalMostrar = Number(d.deuda_actual ?? (d.total_documento || d.total_deuda || 0)) || 0;
                return `
                <tr>
                    <td><strong>${d.codigo || d.codigo_doc}</strong></td><td>${fechaStr}</td>
                    <td><a href="#" class="link-apto" onclick='window.NassauDocumentos.verEstadoCuenta(${JSON.stringify({id:d.propietario_id, nombre:d.propietario_nombre||d.nombre_propietario, apto:d.propietario_apto||d.apartamento}).replace(/'/g, "&#39;")}); return false;'>${d.propietario_nombre || d.nombre_propietario || ''}</a> <small>(${d.propietario_apto || d.apartamento || ''})</small></td>
                    <td><strong>$${totalMostrar.toLocaleString()}</strong></td>
                    <td><button class="btn-primary btn-sm" onclick='window.NassauDocumentos.reprintPDF(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Imprimir / PDF</button></td>
                </tr>`;
            }).join('');
        } catch(e) { window.NassauApp.showToast('Error cargando documentos: '+e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    reprintPDF(d) { this.generatePDF(d); },
    verEstadoCuenta(prop) {
        window.NassauApp.showPage('estados').then(() => {
            window.NassauEstados.renderPage(prop.id, new Date().getFullYear());
        });
    },
    async loadLogo() {
        // Cargar logo de la urbanización como base64 para el PDF
        try {
            const resp = await fetch('/assets/logo.jpg');
            const blob = await resp.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch(e) {
            console.warn('No se pudo cargar el logo', e);
            return null;
        }
    },
    async generatePDF(data) {
        if (!window.jspdf) { window.NassauApp.showToast('Librería PDF no cargada', 'error'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'letter');

        let detalleRaw = data.detalle_json;
        if (typeof detalleRaw === 'string' && detalleRaw) { try { detalleRaw = JSON.parse(detalleRaw); } catch(e) { detalleRaw = null; } }
        const detalle = detalleRaw && typeof detalleRaw === 'object' ? detalleRaw : null;
        const prop = detalle?.propietario || {};
        const urb = detalle?.urbanizacion || {};
        const t = detalle?.totales || {};
        const mesNames = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

        const total = Number(t.total ?? data.total_documento ?? data.total_deuda ?? 0);
        const logo = await this.loadLogo();

        const W = doc.internal.pageSize.getWidth();   // 215.9 letter
        const H = doc.internal.pageSize.getHeight();  // 279.4 letter
        const M = 12;        // margen lateral
        const RIGHT = W - M;

        // ── Marca de agua TURQUESA de fondo ────────────────────────────────
        doc.setGState(new doc.GState({ opacity: 0.1 }));
        doc.setTextColor(0, 150, 150);
        doc.setFontSize(70); doc.setFont('helvetica', 'bold');
        doc.text('NASSAU', W / 2, 180, { align: 'center', angle: 45 });
        doc.setFontSize(40);
        doc.text('P.H.', W / 2, 215, { align: 'center', angle: 45 });
        doc.setGState(new doc.GState({ opacity: 1 }));
        doc.setTextColor(0, 0, 0);

        const drawCopy = (b, label) => {
            // LOGO + encabezado urbanización
            if (logo) {
                try { doc.addImage(logo, 'JPEG', M, b, 18, 18); } catch(e) { console.warn('Logo no válido', e); }
            }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
            doc.text(urb.nombre || 'EDIFICIO NASSAU P.H.', M + 22, b + 6);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            if (urb.direccion) doc.text(urb.direccion, M + 22, b + 11);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            doc.text('CUENTA DE COBRO', M + 22, b + 16);

            // N° documento + fecha generación (derecha)
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(200, 0, 0);
            doc.text(`No: ${data.codigo || data.codigo_doc || 'NAS-000'}`, RIGHT, b + 6, { align: 'right' });
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            const fechaGen = data.fecha_emision || data.fecha_generacion || Date.now();
            doc.text(`Fecha de generación: ${new Date(fechaGen).toLocaleDateString()}`, RIGHT, b + 11, { align: 'right' });
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 150, 150);
            doc.text(label, RIGHT, b + 16, { align: 'right' });
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');

            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4); doc.line(M, b + 22, RIGHT, b + 22);

            // Destinatario
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Señor(a):', M, b + 28);
            doc.setFont('helvetica', 'normal'); doc.text(data.propietario_nombre || data.nombre_propietario || prop.nombre || '', M + 26, b + 28);
            doc.setFont('helvetica', 'bold'); doc.text('Apartamento:', M, b + 33);
            doc.setFont('helvetica', 'normal'); doc.text(data.propietario_apto || data.apartamento || prop.apartamento || '', M + 26, b + 33);
            doc.line(M, b + 36, RIGHT, b + 36);

            // Cabecera de conceptos
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            doc.text('CONCEPTO', M, b + 42); doc.text('VALOR', RIGHT - 12, b + 42, { align: 'right' });
            doc.line(M, b + 44, RIGHT, b + 44);

            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            let y = b + 49;

            const rows = [];

            // Cuotas de administración mensuales
            if (detalle && detalle.periodos_pendientes && detalle.periodos_pendientes.length) {
                detalle.periodos_pendientes.forEach(per => {
                    rows.push({ label: `Cuota de Administración - ${mesNames[per.mes] || per.mes} ${per.anio}`, value: Number(per.pago_actual || 0), bold: true });
                });
            } else if (Number(t.cuota_admon || 0) > 0) {
                rows.push({ label: 'Cuota de Administración', value: Number(t.cuota_admon) || 0, bold: false });
            }

            // Saldos anteriores
            (detalle?.periodos_pendientes || []).filter(p => Number(p.saldo_anterior) > 0).forEach(p => {
                rows.push({ label: `  Saldo anterior ${mesNames[p.mes] || p.mes} ${p.anio}`, value: Number(p.saldo_anterior), bold: false });
            });

            // Cuotas extras
            (detalle?.cuotas_extras || []).forEach(e => {
                rows.push({ label: `  Cuota extra: ${e.descripcion || ''}`, value: Number(e.monto || 0), bold: false });
            });

            // Intereses
            if (Number(t.intereses || 0) > 0) {
                rows.push({ label: 'Intereses causados', value: Number(t.intereses), bold: false });
            }
            // Abono inicial (primera cuenta de cobro de propietario nuevo)
            if (Number(t.abono_inicial || 0) > 0) {
                rows.push({ label: 'Abono inicial', value: -Number(t.abono_inicial), bold: false });
            }
            // Saldo a favor / abonos (sin contar el abono inicial, que ya se lista arriba)
            const saldoFavorRestante = Number(t.saldo_favor || 0) - Number(t.abono_inicial || 0);
            if (saldoFavorRestante > 0) {
                rows.push({ label: 'Saldo a favor / abonos aplicados', value: -saldoFavorRestante, bold: false });
            }

            rows.forEach(r => {
                if (y > b + 115) return; // evita desbordar la mitad
                doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
                const valStr = r.value < 0 ? `-$${Math.abs(r.value).toLocaleString()}` : `$${Math.abs(r.value).toLocaleString()}`;
                doc.text(r.label, M, y);
                doc.text(valStr, RIGHT - 12, y, { align: 'right' });
                y += 5;
            });

            // Saldo a favor neto: cuando el total calculado es negativo
            const saldoAFavor = total < 0 ? -total : 0;
            const totalAMostrar = total <= 0 ? 0 : total;

            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
            doc.line(RIGHT - 12, y, RIGHT, y);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10);

            if (saldoAFavor > 0) {
                doc.setTextColor(16, 185, 129); // verde
            }
            doc.text('TOTAL A PAGAR:', M, y + 4);
            doc.text(`$${totalAMostrar.toLocaleString()}`, RIGHT - 12, y + 4, { align: 'right' });
            doc.setTextColor(0, 0, 0);

            // Si quedó saldo a favor, nota en verde debajo del total
            if (saldoAFavor > 0) {
                const nombreDest = data.propietario_nombre || data.nombre_propietario || prop.nombre || 'El propietario';
                doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(8);
                doc.setTextColor(16, 185, 129);
                doc.text(`El propietario ${nombreDest} cuenta con un saldo a favor de $${saldoAFavor.toLocaleString()}`, M, y + 10);
                doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
            }

            // ── Pie de copia: CONSIGNACIÓN ───────────────────────────────────
            const yf = Math.max(b + 112, y + (saldoAFavor > 0 ? 16 : 8));
            doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.6); doc.line(M, yf, RIGHT, yf);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
            doc.text('CONSIGNACIÓN PROVISIONAL', W / 2, yf + 6, { align: 'center' });
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            doc.text('BANCOLOMBIA cuenta de Ahorros No. 106-251007-73', W / 2, yf + 11, { align: 'center' });
            doc.setFont('helvetica', 'bold');
            doc.text('PAULA ANDREA HERRERA CANO', W / 2, yf + 16, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.text('Cualquier pago favor enviar a: admonednassau@gmail.com o al cel. 300 227 25 58', W / 2, yf + 21, { align: 'center' });
            doc.setTextColor(0, 150, 150); doc.setFont('helvetica', 'bolditalic');
            doc.text('PAGAR CUMPLIDAMENTE NOS HACE TENER UNA MEJOR CALIDAD DE VIDA', W / 2, yf + 27, { align: 'center' });
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
            doc.setTextColor(150, 150, 150); doc.text('DOCUMENTO PROVISIONAL', W / 2, yf + 32, { align: 'center' }); doc.setTextColor(0, 0, 0);
        };

        // ── Primera copia: ORIGINAL ─────────────────────────────────────────
        drawCopy(10, 'ORIGINAL');

        // ── Segunda copia: COPIA ────────────────────────────────────────────
        drawCopy(140, 'COPIA');

        doc.save(`${data.codigo || data.codigo_doc || 'documento'}.pdf`);
    }
};