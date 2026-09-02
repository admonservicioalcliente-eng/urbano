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
    async generarReciboPago(pago, prop) {
        if (!window.jspdf) { window.NassauApp.showToast('Librería PDF no cargada', 'error'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'letter');

        const urbNombre = localStorage.getItem('nassau_urb_nombre') || 'EDIFICIO NASSAU P.H.';
        const logo = await this.loadLogo();
        const mesNames = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const M = 12;
        const RIGHT = W - M;

        const fecha = pago.fecha_pago ? new Date(pago.fecha_pago) : new Date();
        const fechaStr = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}`;
        const tipo = (pago.tipo_pago || 'cuota_regular').replace('_', ' ');
        const monto = Number(pago.monto) || 0;
        const comprobante = pago.comprobante || 'NAS-0000';

        const tipoMap = { 'cuota regular': 'Cuota de Administración', 'cuota extra': 'Cuota Extra', 'intereses': 'Intereses', 'abono': 'Abono' };
        const concepto = tipoMap[tipo] || tipo;

        doc.setGState(new doc.GState({ opacity: 0.1 }));
        doc.setTextColor(0, 150, 150);
        doc.setFontSize(70); doc.setFont('helvetica', 'bold');
        doc.text('NASSAU', W / 2, H / 2, { align: 'center', angle: 45 });
        doc.setFontSize(40);
        doc.text('P.H.', W / 2, H / 2 + 35, { align: 'center', angle: 45 });
        doc.setGState(new doc.GState({ opacity: 1 }));
        doc.setTextColor(0, 0, 0);

        if (logo) { try { doc.addImage(logo, 'JPEG', M, 12, 18, 18); } catch(e) { console.warn('Logo no válido', e); } }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
        doc.text(urbNombre, M + 22, 17);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.text('Recibo de pago de administración', M + 22, 21);

        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(200, 0, 0);
        doc.text(`COMPROBANTE No: ${comprobante}`, RIGHT, 17, { align: 'right' });
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text(`Fecha de pago: ${fechaStr}`, RIGHT, 22, { align: 'right' });

        doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5); doc.line(M, 32, RIGHT, 32);

        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Señor(a):', M, 40);
        doc.setFont('helvetica', 'normal');
        doc.text((prop?.nombre_propietario || '').toUpperCase(), M + 32, 40);
        doc.setFont('helvetica', 'bold'); doc.text('Apartamento:', M, 46);
        doc.setFont('helvetica', 'normal'); doc.text(prop?.apartamento || '', M + 32, 46);

        doc.setFont('helvetica', 'bold'); doc.text('Concepto:', M, 52);
        doc.setFont('helvetica', 'normal'); doc.text(concepto.toUpperCase(), M + 32, 52);
        if (pago.descripcion) {
            doc.setFont('helvetica', 'bold'); doc.text('Descripción:', M, 58);
            doc.setFont('helvetica', 'normal'); doc.text(pago.descripcion, M + 32, 58);
        }

        doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.6); doc.line(M, 66, RIGHT, 66);

        doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('VALOR PAGADO:', RIGHT, 76, { align: 'right' });
        doc.setFontSize(16); doc.setTextColor(0, 150, 150);
        doc.text(`$${monto.toLocaleString()}`, RIGHT, 82, { align: 'right' });
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');

        doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.6); doc.line(M, 88, RIGHT, 88);

        doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(8.5); doc.setTextColor(0, 150, 150);
        doc.text('¡GRACIAS POR SU PAGO CUMPLIDO!', W / 2, 100, { align: 'center' });
        doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');

        doc.save(`Comprobante-${comprobante}.pdf`);
    },
    async loadLogo() {
        const urbId = localStorage.getItem('nassau_urb_id');
        if (urbId) {
            try {
                const data = await window.NassauAPI.apiGet(`/urbanizaciones/${urbId}/logo`);
                if (data.logo) return data.logo;
            } catch(e) { console.warn('Logo desde API no disponible', e); }
        }
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
            // LOGO + encabezado urbanización (compacto)
            if (logo) {
                try { doc.addImage(logo, 'JPEG', M, b, 16, 16); } catch(e) { console.warn('Logo no válido', e); }
            }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
            doc.text(urb.nombre || 'EDIFICIO NASSAU P.H.', M + 20, b + 5);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            if (urb.direccion) doc.text(urb.direccion, M + 20, b + 9);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            doc.text('CUENTA DE COBRO', M + 20, b + 13);

            // N° documento + fecha generación (derecha)
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(200, 0, 0);
            doc.text(`No: ${data.codigo || data.codigo_doc || 'NAS-000'}`, RIGHT, b + 5, { align: 'right' });
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            const fechaGen = data.fecha_emision || data.fecha_generacion || Date.now();
            doc.text(`Fecha de generación: ${new Date(fechaGen).toLocaleDateString()}`, RIGHT, b + 9, { align: 'right' });
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 150, 150);
            doc.text(label, RIGHT, b + 13, { align: 'right' });
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');

            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4); doc.line(M, b + 18, RIGHT, b + 18);

            // Destinatario
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text('Señor(a):', M, b + 23);
            doc.setFont('helvetica', 'normal'); doc.text(data.propietario_nombre || data.nombre_propietario || prop.nombre || '', M + 24, b + 23);
            doc.setFont('helvetica', 'bold'); doc.text('Apartamento:', M, b + 27);
            doc.setFont('helvetica', 'normal'); doc.text(data.propietario_apto || data.apartamento || prop.apartamento || '', M + 24, b + 27);
            doc.line(M, b + 30, RIGHT, b + 30);

            // Cabecera de conceptos
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
            doc.text('CONCEPTO', M, b + 34.5); doc.text('VALOR', RIGHT - 12, b + 34.5, { align: 'right' });
            doc.line(M, b + 36.5, RIGHT, b + 36.5);

            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
            let y = b + 40.5;

            const rows = [];

            // Meses a aplicar (solo pendientes)
            (detalle?.periodos_pendientes || []).forEach(p => {
                const mesLabel = mesNames[p.mes] || `Mes ${p.mes}`;
                const anio = p.anio || new Date().getFullYear();
                if (!p.cerrado && Number(p.pendiente || 0) > 0) {
                    rows.push({ label: `${mesLabel} ${anio}`, value: Number(p.pendiente), bold: false });
                }
            });

            // Cuotas extras pendientes
            (detalle?.cuotas_extras || []).forEach(e => {
                rows.push({ label: `Cuota extra: ${e.descripcion || ''}`, value: Number(e.monto || 0), bold: false });
            });

            // Intereses
            if (Number(t.intereses || 0) > 0) {
                rows.push({ label: 'Intereses causados', value: Number(t.intereses), bold: false });
            }

            rows.forEach(r => {
                if (y > b + 80) return;
                doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
                const valStr = `$${Math.abs(r.value).toLocaleString()}`;
                doc.text(r.label, M, y);
                doc.text(valStr, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            });

            // Línea separadora antes de saldo a favor
            if (Number(t.saldo_favor || 0) > 0 || Number(t.abono_inicial || 0) > 0) {
                doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3);
                doc.line(M, y, RIGHT, y);
                y += 3;
            }

            // Saldo a favor / abonos aplicados
            if (Number(t.saldo_favor || 0) > 0) {
                doc.setFont('helvetica', 'normal');
                doc.text('Saldo a favor / abonos aplicados', M, y);
                doc.text(`-$${Number(t.saldo_favor).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            }
            if (Number(t.abono_inicial || 0) > 0) {
                doc.setFont('helvetica', 'normal');
                doc.text('Abono inicial', M, y);
                doc.text(`-$${Number(t.abono_inicial).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            }

            // Línea separadora antes del total
            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
            doc.line(RIGHT - 12, y, RIGHT, y);
            y += 2;

            // TOTAL A PAGAR
            const totalAMostrar = total <= 0 ? 0 : total;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
            doc.text('TOTAL A PAGAR:', M, y + 3);
            doc.text(`$${totalAMostrar.toLocaleString()}`, RIGHT - 12, y + 3, { align: 'right' });
            y += 6;

            // Línea separadora
            doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.4);
            doc.line(M, y, RIGHT, y);
            y += 5;

            // Cuota de administración del mes actual (dos renglones)
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
            doc.text('Cuota de administración mensual:', M, y);
            doc.text(`$${Number(t.cuota_admon || 0).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
            y += 4.5;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            const mesActualLabel = mesNames[new Date().getMonth() + 1] || '';
            doc.text(`Cuota ${mesActualLabel} ${new Date().getFullYear()}: $${Number(t.cuota_mes_actual || t.cuota_admon || 0).toLocaleString()}`, M, y);

            // Saldo a favor neto (si total es negativo)
            const saldoAFavor = total < 0 ? -total : 0;
            if (saldoAFavor > 0) {
                y += 6;
                const nombreDest = data.propietario_nombre || data.nombre_propietario || prop.nombre || 'El propietario';
                doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(7.5);
                doc.setTextColor(16, 185, 129);
                doc.text(`El propietario ${nombreDest} cuenta con un saldo a favor de $${saldoAFavor.toLocaleString()}`, M, y);
                doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
            }

            // ── Pie de copia: CONSIGNACIÓN (compacto) ─────────────────────────
            const yf = Math.max(b + 100, y + 10);
            doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.6); doc.line(M, yf, RIGHT, yf);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
            doc.text('CONSIGNACIÓN PROVISIONAL', W / 2, yf + 4.5, { align: 'center' });
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            doc.text('NEQUI  3002272559', W / 2, yf + 9, { align: 'center' });
            doc.setFont('helvetica', 'bold');
            doc.text('SONEIDA OSSA QUINTERO', W / 2, yf + 13.5, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.text('Cualquier pago favor enviar a: admonednassau@gmail.com o al cel. 300 227 25 58', W / 2, yf + 18, { align: 'center' });
            doc.setTextColor(0, 150, 150); doc.setFont('helvetica', 'bolditalic');
            doc.text('PAGAR CUMPLIDAMENTE NOS HACE TENER UNA MEJOR CALIDAD DE VIDA', W / 2, yf + 23, { align: 'center' });
            doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
            doc.setTextColor(150, 150, 150); doc.text('DOCUMENTO PROVISIONAL', W / 2, yf + 27, { align: 'center' }); doc.setTextColor(0, 0, 0);
        };

        // ── Primera copia: ORIGINAL ─────────────────────────────────────────
        drawCopy(8, 'ORIGINAL');

        // ── Segunda copia: COPIA ────────────────────────────────────────────
        drawCopy(141, 'COPIA');

        doc.save(`${data.codigo || data.codigo_doc || 'documento'}.pdf`);
    }
};