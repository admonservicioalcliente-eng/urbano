window.NassauEstados = {
    async renderPage() {
        const currentYear = new Date().getFullYear();
        const html = `
            <div class="header-actions">
                <h2>Estado de Cuenta</h2>
                <div class="actions-right">
                    <select id="estado-prop-selector" class="search-input" onchange="window.NassauEstados.loadData()">
                        <option value="">Seleccione un propietario...</option>
                    </select>
                    <select id="estado-anio" class="search-input" onchange="window.NassauEstados.loadData()">
                        <option value="${currentYear}">${currentYear}</option>
                        <option value="${currentYear - 1}">${currentYear - 1}</option>
                    </select>
                </div>
            </div>
            <div id="estados-content" style="display:none;">
                <div class="dashboard-stats" id="estado-summary"></div>
                <div class="card table-container" style="margin-top: 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                        <h3>Detalle Mensual</h3>
                        <button class="btn-primary" onclick="window.NassauEstados.generarCuentaCobro()">Generar Cuenta de Cobro</button>
                    </div>
                    <table class="premium-table" id="estados-table">
                        <thead><tr><th>Mes</th><th>Cuota</th><th>Saldo Anterior</th><th>Intereses</th><th>Saldo a Favor</th><th>Total Deuda</th><th>Estado</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>`;
        document.getElementById('page-estados').innerHTML = html;
        await this.loadPropietariosSelector();
    },
    async loadPropietariosSelector() {
        try {
            const props = await window.NassauAPI.apiGet('/propietarios');
            const select = document.getElementById('estado-prop-selector');
            select.innerHTML += props.map(p => `<option value="${p.id}">${p.apartamento} - ${p.nombre_propietario}</option>`).join('');
        } catch(e) { console.error(e); }
    },
    async loadData() {
        const propId = document.getElementById('estado-prop-selector').value;
        const anio = document.getElementById('estado-anio').value;
        const contentDiv = document.getElementById('estados-content');
        if(!propId) { contentDiv.style.display = 'none'; return; }
        contentDiv.style.display = 'block';
        try {
            window.NassauApp.showLoading(true);
            const estados = await window.NassauAPI.apiGet(`/estados?propietario_id=${propId}&anio=${anio}`);
            let totalDeuda = 0, saldoFavor = 0, mesesPendientes = 0;
            const tbody = document.querySelector('#estados-table tbody');
            if(estados.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay registros para este año</td></tr>';
            } else {
                tbody.innerHTML = estados.map(e => {
                    const deudames = Number(e.total_deuda);
                    if(e.estado === 'pendiente' || e.estado === 'vencido') { totalDeuda += deudames; mesesPendientes++; }
                    if(Number(e.saldo_favor) > 0) saldoFavor = Number(e.saldo_favor);
                    let badge = e.estado === 'pagado' ? 'activo' : (e.estado === 'vencido' ? 'moroso' : 'inactivo');
                    return `
                    <tr>
                        <td>${e.mes}</td><td>$${Number(e.cuota_mensual).toLocaleString()}</td><td>$${Number(e.saldo_anterior).toLocaleString()}</td>
                        <td>$${Number(e.intereses).toLocaleString()}</td><td>$${Number(e.saldo_favor).toLocaleString()}</td>
                        <td><strong>$${deudames.toLocaleString()}</strong></td><td><span class="badge badge-${badge}">${e.estado}</span></td>
                    </tr>`;
                }).join('');
            }
            document.getElementById('estado-summary').innerHTML = `
                <div class="stat-card"><div class="stat-icon" style="color:var(--error)">$</div><div class="stat-value">$${totalDeuda.toLocaleString()}</div><div class="stat-label">Total Deuda Actual</div></div>
                <div class="stat-card"><div class="stat-icon" style="color:var(--success)">+</div><div class="stat-value">$${saldoFavor.toLocaleString()}</div><div class="stat-label">Saldo a Favor</div></div>
                <div class="stat-card"><div class="stat-icon">#</div><div class="stat-value">${mesesPendientes}</div><div class="stat-label">Meses Pendientes</div></div>`;
        } catch(e) { window.NassauApp.showToast('Error cargando estado de cuenta', 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    async generarCuentaCobro() {
        const propId = document.getElementById('estado-prop-selector').value;
        if(!propId) return;
        try {
            window.NassauApp.showLoading(true);
            const doc = await window.NassauAPI.apiPost('/cuentas-cobro', { propietario_id: propId });
            window.NassauApp.showToast('Cuenta de cobro generada!', 'success');
            if(window.NassauDocumentos) window.NassauDocumentos.generatePDF(doc);
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    }
};