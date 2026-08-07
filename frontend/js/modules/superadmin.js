window.NassauSuperAdmin = {
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Panel SuperAdmin</h2>
                <button class="btn-primary" onclick="window.NassauSuperAdmin.showCreateModal()">+ Nueva Urbanización</button>
            </div>
            <div class="card table-container">
                <table class="premium-table" id="sa-table">
                    <thead><tr><th>ID</th><th>Nombre</th><th>Dirección</th><th>Estado</th><th>Acciones</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;
        document.getElementById('page-superadmin').innerHTML = html;
        await this.loadUrbanizaciones();
    },
    async loadUrbanizaciones() {
        try {
            window.NassauApp.showLoading(true);
            const urbs = await window.NassauAPI.apiGet('/urbanizaciones/admin');
            const tbody = document.querySelector('#sa-table tbody');
            tbody.innerHTML = urbs.map(u => `
                <tr>
                    <td>${u.id}</td><td>${u.nombre}</td><td>${u.direccion || '-'}</td>
                    <td><span class="badge badge-${u.estado_licencia === 'activa' ? 'activo' : (u.estado_licencia === 'suspendida' ? 'moroso' : 'inactivo')}">${u.estado_licencia}</span></td>
                    <td>
                        <button class="btn-secondary btn-sm" onclick="window.NassauSuperAdmin.updateEstado(${u.id}, 'activa')">Activar</button>
                        <button class="btn-danger btn-sm" onclick="window.NassauSuperAdmin.updateEstado(${u.id}, 'suspendida')">Suspender</button>
                    </td>
                </tr>`).join('');
        } catch(e) { window.NassauApp.showToast('Error cargando urbanizaciones', 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    showCreateModal() {
        const html = `
            <form onsubmit="window.NassauSuperAdmin.createUrb(event)">
                <div class="form-group"><label>Nombre</label><input type="text" id="sa-nombre" required></div>
                <div class="form-group"><label>Dirección</label><input type="text" id="sa-dir"></div>
                <div class="form-group"><label>Teléfono</label><input type="text" id="sa-tel"></div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Crear</button>
                </div>
            </form>`;
        window.NassauApp.showModal('Nueva Urbanización', html);
    },
    async createUrb(e) {
        e.preventDefault();
        const data = {
            nombre: document.getElementById('sa-nombre').value,
            direccion: document.getElementById('sa-dir').value,
            telefono_contacto: document.getElementById('sa-tel').value
        };
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPost('/urbanizaciones', data);
            window.NassauApp.showToast('Urbanización creada', 'success');
            window.NassauApp.closeModal();
            this.loadUrbanizaciones();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    async updateEstado(id, estado) {
        if(!confirm(`¿Cambiar estado a ${estado}?`)) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/urbanizaciones/${id}/estado`, { estado_licencia: estado });
            window.NassauApp.showToast('Estado actualizado', 'success');
            this.loadUrbanizaciones();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    }
};