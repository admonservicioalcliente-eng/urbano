window.NassauPagos = {
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Pagos</h2>
                <div class="actions-right">
                    <select id="pago-prop-selector" class="search-input" onchange="window.NassauPagos.onPropietarioSelect()">
                        <option value="">Seleccione un propietario...</option>
                    </select>
                    <button class="btn-primary" onclick="window.NassauPagos.showRegistrarPagoModal()" id="btn-registrar-pago" disabled>+ Registrar Pago</button>
                </div>
            </div>
            <div class="card table-container">
                <table class="premium-table" id="pagos-table">
                    <thead><tr><th>Fecha</th><th>Monto</th><th>Tipo</th><th>Comprobante</th><th>Descripción</th></tr></thead>
                    <tbody><tr><td colspan="5" class="text-center">Seleccione un propietario para ver sus pagos</td></tr></tbody>
                </table>
            </div>`;
        document.getElementById('page-pagos').innerHTML = html;
        await this.loadPropietariosSelector();
    },
    async loadPropietariosSelector() {
        try {
            const props = await window.NassauAPI.apiGet('/propietarios');
            this.propietariosList = props;
            const select = document.getElementById('pago-prop-selector');
            select.innerHTML += props.map(p => `<option value="${p.id}">${p.apartamento} - ${p.nombre_propietario}</option>`).join('');
        } catch(e) { console.error('Error cargando propietarios para pagos', e); }
    },
    async onPropietarioSelect() {
        const propId = document.getElementById('pago-prop-selector').value;
        const btn = document.getElementById('btn-registrar-pago');
        if(propId) {
            btn.disabled = false;
            await this.loadPagos(propId);
        } else {
            btn.disabled = true;
            document.querySelector('#pagos-table tbody').innerHTML = '<tr><td colspan="5" class="text-center">Seleccione un propietario para ver sus pagos</td></tr>';
        }
    },
    async loadPagos(propietarioId) {
        try {
            window.NassauApp.showLoading(true);
            const currentYear = new Date().getFullYear();
            const pagos = await window.NassauAPI.apiGet(`/pagos?propietario_id=${propietarioId}&anio=${currentYear}`);
            const tbody = document.querySelector('#pagos-table tbody');
            if(pagos.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay pagos registrados para este propietario en ${currentYear}</td></tr>`;
                return;
            }
            tbody.innerHTML = pagos.map(p => `
                <tr>
                    <td>${new Date(p.fecha_pago).toLocaleDateString()}</td>
                    <td>$${Number(p.monto).toLocaleString()}</td>
                    <td><span class="badge badge-activo">${p.tipo_pago.replace('_', ' ')}</span></td>
                    <td>${p.comprobante || '-'}</td>
                    <td>${p.descripcion || '-'}</td>
                </tr>`).join('');
        } catch(e) { window.NassauApp.showToast('Error cargando pagos', 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    showRegistrarPagoModal() {
        const propId = document.getElementById('pago-prop-selector').value;
        if(!propId) return;
        const prop = this.propietariosList.find(p => p.id == propId);
        const html = `
            <form id="pago-form" onsubmit="window.NassauPagos.registrarPago(event, '${propId}')">
                <p>Registrando pago para: <strong>${prop.apartamento} - ${prop.nombre_propietario}</strong></p>
                <div class="form-row">
                    <div class="form-group"><label>Monto</label><input type="number" id="pago-monto" required></div>
                    <div class="form-group"><label>Fecha de Pago</label><input type="date" id="pago-fecha" required value="${new Date().toISOString().split('T')[0]}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Tipo de Pago</label>
                        <select id="pago-tipo">
                            <option value="cuota_regular">Cuota Regular</option>
                            <option value="cuota_extra">Cuota Extra</option>
                            <option value="interes">Intereses</option>
                            <option value="abono">Abono</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Comprobante</label><input type="text" id="pago-comprobante"></div>
                </div>
                <div class="form-group"><label>Descripción</label><input type="text" id="pago-desc"></div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Registrar Pago</button>
                </div>
            </form>`;
        window.NassauApp.showModal('Registrar Pago', html);
    },
    async registrarPago(e, propietarioId) {
        e.preventDefault();
        const data = {
            propietario_id: propietarioId,
            monto: document.getElementById('pago-monto').value,
            fecha_pago: document.getElementById('pago-fecha').value,
            tipo_pago: document.getElementById('pago-tipo').value,
            comprobante: document.getElementById('pago-comprobante').value,
            descripcion: document.getElementById('pago-desc').value
        };
        try {
            window.NassauApp.showLoading(true);
            const nuevoPago = await window.NassauAPI.apiPost('/pagos', data);
            window.NassauApp.showToast('Pago registrado', 'success');
            const prop = this.propietariosList.find(p => p.id == propietarioId);
            if (window.NassauDocumentos && prop) window.NassauDocumentos.generarReciboPago(nuevoPago, prop);
            window.NassauApp.closeModal();
            this.loadPagos(propietarioId);
        } catch(err) { window.NassauApp.showToast('Error: ' + err.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    }
};