window.NassauEstados = {
    async renderPage(preSelectId, preSelectAnio) {
        const currentYear = new Date().getFullYear();
        const anio = preSelectAnio || currentYear;
        const html = `
            <div class="header-actions">
                <h2>Estado de Cuenta</h2>
                <div class="actions-right">
                    <select id="estado-prop-selector" class="search-input" onchange="window.NassauEstados.loadData()">
                        <option value="">Seleccione un propietario...</option>
                    </select>
                    <select id="estado-anio" class="search-input" onchange="window.NassauEstados.loadData()">
                        <option value="">Cargando años...</option>
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
                        <thead><tr><th>Mes</th><th>Cuota</th><th>Saldo Anterior</th><th>Días Mora</th><th>Intereses</th><th>Pagado</th><th>Total Deuda</th><th>Estado</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>`;
        document.getElementById('page-estados').innerHTML = html;
        await this.loadPropietariosSelector();
        await this.loadAnios(anio);
        if(preSelectId) {
            document.getElementById('estado-prop-selector').value = preSelectId;
            if(preSelectAnio) document.getElementById('estado-anio').value = preSelectAnio;
            await this.loadData();
        }
    },
    async loadAnios(preSelectAnio) {
        const select = document.getElementById('estado-anio');
        if (!select) return;
        try {
            const params = await window.NassauAPI.apiGet('/parametros');
            const anios = params.map(p => p.anio).sort((a, b) => b - a);
            const currentYear = new Date().getFullYear();
            const lista = anios.length ? [...new Set(anios)] : [currentYear];
            select.innerHTML = lista.map(a =>
                `<option value="${a}" ${a == (preSelectAnio || lista[0]) ? 'selected' : ''}>${a}</option>`).join('');
        } catch(e) {
            const currentYear = new Date().getFullYear();
            select.innerHTML = `<option value="${currentYear}" selected>${currentYear}</option>`;
        }
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
            const data = await window.NassauAPI.apiGet(`/estados?propietario_id=${propId}&anio=${anio}`);
            let totalDeuda = 0, saldoFavor = 0, mesesPendientes = 0;
            const tbody = document.querySelector('#estados-table tbody');
            if(!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">No hay registros para este a\u00f1o</td></tr>';
            } else {
                const mesNames = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
                tbody.innerHTML = data.map(e => {
                    const deudaMes = Number(e.total_deuda || 0);
                    if(!e.cerrado && deudaMes > 0) { totalDeuda += deudaMes; mesesPendientes++; }
                    if(Number(e.saldo_favor) > 0) saldoFavor += Number(e.saldo_favor);
                    const badge = e.cerrado ? 'activo' : (deudaMes > 0 ? 'moroso' : 'inactivo');
                    const estadoLabel = e.cerrado ? 'Cerrado' : (deudaMes > 0 ? 'Pendiente' : 'Al d\u00eda');
                    return `
                    <tr>
                        <td>${mesNames[e.mes] || e.mes}</td>
                        <td>$${Number(e.pago_actual).toLocaleString()}</td>
                        <td>$${Number(e.saldo_anterior).toLocaleString()}</td>
                        <td>${e.dias_mora || 0}</td>
                        <td>$${Number(e.intereses).toLocaleString()}</td>
                        <td>$${Number(e.saldo_favor).toLocaleString()}</td>
                        <td><strong>$${deudaMes.toLocaleString()}</strong></td>
                        <td><span class="badge badge-${badge}">${estadoLabel}</span></td>
                    </tr>`;
                }).join('');
            }
            document.getElementById('estado-summary').innerHTML = `
                <div class="stat-card"><div class="stat-icon" style="color:var(--error)">$</div><div class="stat-value">$${totalDeuda.toLocaleString()}</div><div class="stat-label">Total Deuda Actual</div></div>
                <div class="stat-card"><div class="stat-icon" style="color:var(--success)">+</div><div class="stat-value">$${saldoFavor.toLocaleString()}</div><div class="stat-label">Total Pagado Aplicado</div></div>
                <div class="stat-card"><div class="stat-icon">#</div><div class="stat-value">${mesesPendientes}</div><div class="stat-label">Meses Pendientes</div></div>`;
        } catch(e) { window.NassauApp.showToast('Error cargando estado de cuenta: ' + e.message, 'error'); } 
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
