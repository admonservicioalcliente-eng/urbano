window.NassauPropietarios = {
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Propietarios</h2>
                <div class="actions-right">
                    <input type="text" id="prop-search" placeholder="Buscar propietario o apto..." class="search-input">
                    <button class="btn-primary" onclick="window.NassauPropietarios.showCreateModal()">+ Nuevo Propietario</button>
                </div>
            </div>
            <div class="card table-container">
                <table class="premium-table" id="props-table">
                    <thead><tr><th>Apartamento</th><th>Celda</th><th>Nombre</th><th>Cuota Admon</th><th>Modo Pago</th><th>Estado</th><th>Acciones</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;
        document.getElementById('page-propietarios').innerHTML = html;
        await this.loadPropietarios();
        document.getElementById('prop-search')?.addEventListener('input', (e) => this.filterTable(e.target.value));
    },
    async loadPropietarios() {
        try {
            window.NassauApp.showLoading(true);
            this.propietarios = await window.NassauAPI.apiGet('/propietarios');
            this.renderTable(this.propietarios);
        } catch (e) { window.NassauApp.showToast('Error cargando propietarios: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    renderTable(data) {
        const tbody = document.querySelector('#props-table tbody');
        if (!tbody) return;
        tbody.innerHTML = data.map(p => `
            <tr>
                <td>${p.apartamento}</td><td>${p.no_celda || '-'}</td><td>${p.nombre_propietario}</td>
                <td>$${Number(p.cuota_admon).toLocaleString()}</td><td>${p.modo_pago}</td>
                <td><span class="badge badge-${p.estado}">${p.estado}</span></td>
                <td>
                    <button class="btn-secondary btn-sm" onclick="window.NassauPropietarios.showEditModal(${p.id})">Editar</button>
                    <button class="btn-danger btn-sm" onclick="window.NassauPropietarios.deletePropietario(${p.id})">Eliminar</button>
                </td>
            </tr>`).join('');
    },
    filterTable(term) {
        if (!this.propietarios) return;
        const lower = term.toLowerCase();
        const filtered = this.propietarios.filter(p => p.nombre_propietario.toLowerCase().includes(lower) || p.apartamento.toLowerCase().includes(lower));
        this.renderTable(filtered);
    },
    showCreateModal() { this.currentEditId = null; window.NassauApp.showModal('Nuevo Propietario', this.getFormHtml()); },
    showEditModal(id) {
        const p = this.propietarios.find(x => x.id === id);
        if (!p) return;
        this.currentEditId = id;
        window.NassauApp.showModal('Editar Propietario', this.getFormHtml(p));
    },
    getFormHtml(p = {}) {
        return `
            <form id="prop-form" onsubmit="window.NassauPropietarios.savePropietario(event)">
                <div class="form-group"><label>Nombre Completo</label><input type="text" id="prop-nombre" value="${p.nombre_propietario || ''}" required></div>
                <div class="form-row">
                    <div class="form-group"><label>Apartamento</label><input type="text" id="prop-apto" value="${p.apartamento || ''}" required></div>
                    <div class="form-group"><label>Celda</label><input type="text" id="prop-celda" value="${p.no_celda || ''}"></div>
                </div>
                <div class="form-group"><label>Cuota de Administración</label><input type="number" id="prop-cuota" value="${p.cuota_admon || ''}" required></div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Estado</label>
                        <select id="prop-estado">
                            <option value="activo" ${p.estado === 'activo' ? 'selected' : ''}>Activo</option>
                            <option value="moroso" ${p.estado === 'moroso' ? 'selected' : ''}>Moroso</option>
                            <option value="inactivo" ${p.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Modo Pago</label>
                        <select id="prop-modo">
                            <option value="transferencia" ${p.modo_pago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
                            <option value="efectivo" ${p.modo_pago === 'efectivo' ? 'selected' : ''}>Efectivo</option>
                        </select>
                    </div>
                </div>
                <div class="form-group"><label>Teléfono</label><input type="text" id="prop-tel" value="${p.telefono || ''}"></div>
                <div class="form-group"><label>Email</label><input type="email" id="prop-email" value="${p.email || ''}"></div>
                <div class="form-group"><label>Notas</label><textarea id="prop-notas">${p.notas || ''}</textarea></div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Guardar</button>
                </div>
            </form>`;
    },
    async savePropietario(e) {
        e.preventDefault();
        const data = {
            nombre_propietario: document.getElementById('prop-nombre').value,
            apartamento: document.getElementById('prop-apto').value,
            no_celda: document.getElementById('prop-celda').value,
            cuota_admon: document.getElementById('prop-cuota').value,
            estado: document.getElementById('prop-estado').value,
            modo_pago: document.getElementById('prop-modo').value,
            telefono: document.getElementById('prop-tel').value,
            email: document.getElementById('prop-email').value,
            notas: document.getElementById('prop-notas').value,
            urb_id: localStorage.getItem('nassau_urb_id')
        };
        try {
            window.NassauApp.showLoading(true);
            if (this.currentEditId) {
                await window.NassauAPI.apiPut(`/propietarios/${this.currentEditId}`, data);
                window.NassauApp.showToast('Propietario actualizado', 'success');
            } else {
                await window.NassauAPI.apiPost('/propietarios', data);
                window.NassauApp.showToast('Propietario creado', 'success');
            }
            window.NassauApp.closeModal();
            this.loadPropietarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    async deletePropietario(id) {
        if(!confirm('¿Está seguro de eliminar este propietario?')) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiDelete(`/propietarios/${id}`);
            window.NassauApp.showToast('Propietario eliminado', 'success');
            this.loadPropietarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    }
};