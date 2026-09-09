window.NassauDocumentos = {
    allDocs: [],
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Cuentas de Cobro Generadas</h2>
                <button class="btn-secondary" onclick="window.NassauDocumentos.loadDocumentos()">Actualizar</button>
            </div>
            <div class="card">
                <div style="margin-bottom: 1rem;">
                    <label for="select-propietario" style="font-weight: bold; margin-right: 0.5rem;">Propietario:</label>
                    <select id="select-propietario" onchange="window.NassauDocumentos.filtrarPorPropietario()" style="padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; min-width: 250px;">
                        <option value="">-- Seleccionar propietario --</option>
                    </select>
                </div>
                <div id="docs-por-propietario"></div>
            </div>`;
        document.getElementById('page-cobros').innerHTML = html;
        await this.loadDocumentos();
    },
    async loadDocumentos() {
        try {
            window.NassauApp.showLoading(true);
            this.allDocs = await window.NassauAPI.apiGet('/cuentas-cobro');
            
            // Agrupar por propietario
            const propietarios = {};
            this.allDocs.forEach(d => {
                const propId = d.propietario_id;
                const propNombre = d.propietario_nombre || d.nombre_propietario || 'Sin nombre';
                const propApto = d.propietario_apto || d.apartamento || '';
                if (!propietarios[propId]) {
                    propietarios[propId] = { nombre: propNombre, apto: propApto, docs: [] };
                }
                propietarios[propId].docs.push(d);
            });
            
            // Llenar select
            const select = document.getElementById('select-propietario');
            select.innerHTML = '<option value="">-- Seleccionar propietario --</option>';
            Object.keys(propietarios).sort((a, b) => propietarios[a].nombre.localeCompare(propietarios[b].nombre)).forEach(propId => {
                const prop = propietarios[propId];
                const option = document.createElement('option');
                option.value = propId;
                option.textContent = `${prop.nombre} (${prop.appto}) - ${prop.docs.length} cuenta(s)`;
                select.appendChild(option);
            });
            
            this.renderListaCompleta(propietarios);
        } catch(e) { window.NassauApp.showToast('Error cargando documentos: '+e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    renderListaCompleta(propietarios) {
        const container = document.getElementById('docs-por-propietario');
        if (this.allDocs.length === 0) {
            container.innerHTML = '<p class="text-center">No hay documentos generados</p>';
            return;
        }
        
        let html = '';
        Object.keys(propietarios).sort((a, b) => propietarios[a].nombre.localeCompare(propietarios[b].nombre)).forEach(propId => {
            const prop = propietarios[propId];
            html += `
            <div style="margin-bottom: 1.5rem; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                <div style="background: #f5f5f5; padding: 0.75rem 1rem; font-weight: bold; border-bottom: 1px solid #ddd;">
                    ${prop.nombre} <small style="color: #666;">(${prop.appto})</small>
                </div>
                <table class="premium-table" style="margin: 0;">
                    <thead><tr><th>Código</th><th>Fecha</th><th>Total</th><th>Acciones</th></tr></thead>
                    <tbody>`;
            prop.docs.sort((a, b) => (b.consecutivo || 0) - (a.consecutivo || 0)).forEach(d => {
                const fecha = d.fecha_emision || d.fecha_generacion;
                const fechaStr = fecha ? new Date(fecha).toLocaleDateString() : '';
                const totalMostrar = Number(d.total_documento || d.total_deuda || 0) || 0;
                html += `
                    <tr>
                        <td><strong>${d.codigo || d.codigo_doc}</strong></td>
                        <td>${fechaStr}</td>
                        <td><strong>$${totalMostrar.toLocaleString()}</strong></td>
                        <td><button class="btn-primary btn-sm" onclick='window.NassauDocumentos.reprintPDF(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Imprimir / PDF</button></td>
                    </tr>`;
            });
            html += `
                    </tbody>
                </table>
            </div>`;
        });
        container.innerHTML = html;
    },
    filtrarPorPropietario() {
        const propId = document.getElementById('select-propietario').value;
        const container = document.getElementById('docs-por-propietario');
        
        if (!propId) {
            // Mostrar todos agrupados
            const propietarios = {};
            this.allDocs.forEach(d => {
                const pid = d.propietario_id;
                const propNombre = d.propietario_nombre || d.nombre_propietario || 'Sin nombre';
                const propApto = d.propietario_apto || d.apartamento || '';
                if (!propietarios[pid]) {
                    propietarios[pid] = { nombre: propNombre, apto: propApto, docs: [] };
                }
                propietarios[pid].docs.push(d);
            });
            this.renderListaCompleta(propietarios);
            return;
        }
        
        // Filtrar por propietario seleccionado
        const prop = this.allDocs.find(d => d.propietario_id === propId);
        const propNombre = prop ? (prop.propietario_nombre || prop.nombre_propietario) : '';
        const propApto = prop ? (prop.propietario_apto || prop.apartamento) : '';
        const docsFiltrados = this.allDocs.filter(d => d.propietario_id === propId);
        
        let html = `
        <div style="margin-bottom: 1.5rem; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
            <div style="background: #f5f5f5; padding: 0.75rem 1rem; font-weight: bold; border-bottom: 1px solid #ddd;">
                ${propNombre} <small style="color: #666;">(${propApto})</small>
            </div>
            <table class="premium-table" style="margin: 0;">
                <thead><tr><th>Código</th><th>Fecha</th><th>Total</th><th>Acciones</th></tr></thead>
                <tbody>`;
        docsFiltrados.sort((a, b) => (b.consecutivo || 0) - (a.consecutivo || 0)).forEach(d => {
            const fecha = d.fecha_emision || d.fecha_generacion;
            const fechaStr = fecha ? new Date(fecha).toLocaleDateString() : '';
            const totalMostrar = Number(d.total_documento || d.total_deuda || 0) || 0;
            html += `
                <tr>
                    <td><strong>${d.codigo || d.codigo_doc}</strong></td>
                    <td>${fechaStr}</td>
                    <td><strong>$${totalMostrar.toLocaleString()}</strong></td>
                    <td><button class="btn-primary btn-sm" onclick='window.NassauDocumentos.reprintPDF(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Imprimir / PDF</button></td>
                </tr>`;
        });
        html += `
                </tbody>
            </table>
        </div>`;
        container.innerHTML = html;
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

            // Todas las cuotas de administración (pagadas y pendientes)
            const todasLasCuotas = [];
            (detalle?.periodos_pendientes || []).forEach(p => {
                const mesLabel = mesNames[p.mes] || `Mes ${p.mes}`;
                const anio = p.anio || new Date().getFullYear();
                const esMesActual = parseInt(p.mes) === new Date().getMonth() + 1 && parseInt(p.anio) === new Date().getFullYear();
                const cuotaMes = Number(p.pago_actual || 0);
                if (cuotaMes > 0 && !esMesActual) {
                    const estado = p.cerrado ? 'Pagado' : 'Pendiente';
                    todasLasCuotas.push({ 
                        label: `Cuota de Administración - ${mesLabel} ${anio}`, 
                        value: cuotaMes,
                        estado: estado
                    });
                }
            });

            todasLasCuotas.forEach(r => {
                if (y > b + 80) return;
                doc.setFont('helvetica', 'normal');
                doc.text(r.label, M, y);
                doc.text(`$${Math.abs(r.value).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            });

            // Cuotas extras
            (detalle?.cuotas_extras || []).forEach(e => {
                if (y > b + 80) return;
                doc.setFont('helvetica', 'normal');
                doc.text(`Cuota extra: ${e.descripcion || ''}`, M, y);
                doc.text(`$${Number(e.monto || 0).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            });

            // Intereses
            if (Number(t.intereses || 0) > 0) {
                doc.setFont('helvetica', 'normal');
                doc.text('Intereses causados', M, y);
                doc.text(`$${Number(t.intereses).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            }

            // Retroactivo Ley 675
            const retroactivo = detalle?.retroactivo;
            if (retroactivo && Number(retroactivo.monto || 0) > 0) {
                doc.setFont('helvetica', 'normal');
                doc.text(retroactivo.descripcion || 'Retroactivo Ley 675', M, y);
                doc.text(`$${Number(retroactivo.monto).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 4.3;
            }

            // TOTAL DE CUOTAS (suma de todas las cuotas de administración + retroactivo)
            let totalCuotas = 0;
            todasLasCuotas.forEach(r => { totalCuotas += r.value; });
            const retroactivoMonto = retroactivo && Number(retroactivo.monto || 0) > 0 ? Number(retroactivo.monto) : 0;
            totalCuotas += retroactivoMonto;
            
            // Pagos aplicados (abonos reales del propietario)
            const pagosAplicados = detalle?.pagos_aplicados || [];
            let totalPagos = 0;
            pagosAplicados.forEach(pg => { totalPagos += Number(pg.monto || 0); });
            
            // Construir descripción de pagos en una sola línea
            let pagosDescripcion = '';
            if (pagosAplicados.length > 0) {
                const pagosLista = pagosAplicados.map(pg => {
                    const fechaPg = pg.fecha_pago ? new Date(pg.fecha_pago).toLocaleDateString() : '';
                    return `${pg.comprobante || ''} ${fechaPg}`;
                }).join(', ');
                pagosDescripcion = ` (${pagosLista})`;
            }
            
            if (totalCuotas > 0) {
                doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
                doc.line(M, y, RIGHT, y);
                y += 4;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
                doc.text('TOTAL CUOTAS:', M, y);
                doc.text(`$${totalCuotas.toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 5;

                // Pagos aplicados en una o dos líneas
                if (totalPagos > 0) {
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
                    const textoPagos = `Pagos aplicados${pagosDescripcion}:`;
                    const anchoDisponible = (RIGHT - 12) - M;
                    const textoWidth = doc.getTextWidth(textoPagos);
                    
                    if (textoWidth > anchoDisponible) {
                        // Texto largo: separar descripción del valor
                        doc.text('Pagos aplicados:', M, y);
                        doc.text(`-$${totalPagos.toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                        y += 4;
                        // Detalle de pagos en la siguiente línea
                        doc.setFontSize(8);
                        const detallePagos = pagosAplicados.map(pg => {
                            const fechaPg = pg.fecha_pago ? new Date(pg.fecha_pago).toLocaleDateString() : '';
                            return `${pg.comprobante || ''} ${fechaPg}`;
                        }).join(', ');
                        doc.text(`(${detallePagos})`, M, y);
                        y += 5;
                    } else {
                        doc.text(textoPagos, M, y);
                        doc.text(`-$${totalPagos.toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                        y += 5;
                    }
                }

                // ESTADO DE CUENTA
                const estadoCuenta = totalCuotas - totalPagos;
                doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.4);
                doc.line(M, y, RIGHT, y);
                y += 5;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0, 150, 150);
                doc.text('ESTADO DE CUENTA:', M, y);
                doc.text(`$${estadoCuenta.toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                doc.setTextColor(0, 0, 0);
                y += 6;
            } else {
                // No hay cuotas: mostrar TOTAL A PAGAR normal
                doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
                doc.line(M, y, RIGHT, y);
                y += 4;
                const totalDeuda = total <= 0 ? 0 : total;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
                doc.text('TOTAL A PAGAR:', M, y);
                doc.text(`$${totalDeuda.toLocaleString()}`, RIGHT - 12, y, { align: 'right' });
                y += 6;
            }

            // Cuota de administración del mes actual
            doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.4);
            doc.line(M, y, RIGHT, y);
            y += 5;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            doc.text('Cuota de administración mensual:', M, y);
            y += 5;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
            const mesActualLabel = mesNames[new Date().getMonth() + 1] || '';
            doc.text(`Cuota ${mesActualLabel} ${new Date().getFullYear()}:`, M, y);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
            doc.text('SALDO A PAGAR', RIGHT - 12, y, { align: 'right' });
            y += 5;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
            doc.text(`$${Number(t.cuota_mes_actual || t.cuota_admon || 0).toLocaleString()}`, RIGHT - 12, y, { align: 'right' });

            // ── Pie de copia: CONSIGNACIÓN (2 renglones) ─────────────────────────
            const yf = Math.max(b + 100, y + 10);
            doc.setDrawColor(0, 150, 150); doc.setLineWidth(0.6); doc.line(M, yf, RIGHT, yf);
            
            // Renglón 1: Datos bancarios
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0, 0, 0);
            const tipoCuenta = urb.banco_tipo_cuenta || 'ahorros';
            const numCuenta = urb.banco_numero_cuenta || '3002272559';
            const nombreBanco = urb.banco_nombre || '';
            const titular = urb.banco_titular || 'SONEIDA OSSA QUINTERO';
            const textoBanco = nombreBanco ? `${nombreBanco} - ` : '';
            doc.text(`${textoBanco}CONSIGNACIÓN: ${tipoCuenta.toUpperCase()} No. ${numCuenta}`, W / 2, yf + 4, { align: 'center' });
            doc.setFont('helvetica', 'bold');
            doc.text(titular.toUpperCase(), W / 2, yf + 8, { align: 'center' });
            
            // Renglón 2: Contacto
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
            const celular = urb.banco_celular || urb.telefono || '300 227 25 58';
            const email = urb.email || 'admonednassau@gmail.com';
            doc.text(`Cel: ${celular} | Email: ${email}`, W / 2, yf + 12, { align: 'center' });
            
            doc.setTextColor(150, 150, 150); doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
            doc.text('DOCUMENTO PROVISIONAL', W / 2, yf + 16, { align: 'center' }); doc.setTextColor(0, 0, 0);
        };

        // ── Primera copia: ORIGINAL ─────────────────────────────────────────
        drawCopy(8, 'ORIGINAL');

        // ── Segunda copia: COPIA (solo si está habilitada) ─────────────────
        if (detalle?.mostrar_copia !== false) {
            drawCopy(141, 'COPIA');
        }

        doc.save(`${data.codigo || data.codigo_doc || 'documento'}.pdf`);
    }
};