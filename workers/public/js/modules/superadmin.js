window.NassauSuperAdmin = {
    currentTab: 'usuarios',
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Panel SuperAdmin</h2>
                <button class="btn-primary" id="sa-new-btn" onclick="window.NassauSuperAdmin.showCreateModal()">+ Nueva Cuenta</button>
            </div>
            <div class="sa-tabs">
                <button class="sa-tab ${this.currentTab === 'usuarios' ? 'active' : ''}" data-tab="usuarios" onclick="window.NassauSuperAdmin.switchTab('usuarios')">Cuentas Autorizadas</button>
                <button class="sa-tab ${this.currentTab === 'urb' ? 'active' : ''}" data-tab="urb" onclick="window.NassauSuperAdmin.switchTab('urb')">Urbanizaciones</button>
            </div>
            <div class="card table-container" id="sa-content"></div>`;
        document.getElementById('page-superadmin').innerHTML = html;
        await this.loadCurrentTab();
    },
    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.sa-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.getElementById('sa-new-btn').textContent = tab === 'usuarios' ? '+ Nueva Cuenta' : '+ Nueva Urbanización';
        document.getElementById('sa-new-btn').setAttribute('onclick', tab === 'usuarios'
            ? 'window.NassauSuperAdmin.showCreateModal()'
            : 'window.NassauSuperAdmin.showCreateUrbModal()');
        this.loadCurrentTab();
    },
    async loadCurrentTab() {
        if (this.currentTab === 'usuarios') await this.loadUsuarios();
        else await this.loadUrbanizaciones();
    },
    async loadUsuarios() {
        try {
            window.NassauApp.showLoading(true);
            const users = await window.NassauAPI.apiGet('/usuarios');
            const now = new Date();
            const tbody = users.map(u => {
                const expirado = u.fecha_expiracion && new Date(u.fecha_expiracion) < now;
                const badge = !u.activo ? 'inactivo' : (expirado ? 'moroso' : 'activo');
                const badgeTxt = !u.activo ? 'REVOCADA' : (expirado ? 'VENCIDA' : 'ACTIVA');
                return `
                <tr>
                    <td><strong>${u.nombre}</strong></td>
                    <td>${u.email}</td>
                    <td><span class="badge badge-${u.rol === 'superadmin' ? 'activo' : 'moroso'}">${u.rol}</span></td>
                    <td>${u.urbanizacion_nombre || '-'}</td>
                    <td><span class="badge badge-${badge}">${badgeTxt}</span></td>
                    <td>${u.fecha_expiracion ? new Date(u.fecha_expiracion).toLocaleDateString() : '-'}</td>
                    <td>
                        ${u.rol !== 'superadmin' ? (u.activo && !expirado
                            ? `<button class="btn-danger btn-sm" onclick="window.NassauSuperAdmin.revoke('${u.id}')">Revocar</button>`
                            : `<button class="btn-secondary btn-sm" onclick="window.NassauSuperAdmin.reinstate('${u.id}')">Reactivar</button>`)
                            : '<span style="color:var(--text-secondary);font-size:0.8rem;">—</span>'}
                        <button class="btn-secondary btn-sm" onclick="window.NassauSuperAdmin.showEditModal('${u.id}')">Editar</button>
                        <button class="btn-danger btn-sm" onclick="window.NassauSuperAdmin.del('${u.id}', '${u.nombre}')">Eliminar</button>
                    </td>
                </tr>`;
            }).join('');
            document.getElementById('sa-content').innerHTML = `
                <table class="premium-table">
                    <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Urbanización</th><th>Estado</th><th>Expiración</th><th>Acciones</th></tr></thead>
                    <tbody>${tbody}</tbody>
                </table>`;
        } catch(e) { window.NassauApp.showToast(e.message || 'Error cargando usuarios', 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async loadUrbanizaciones() {
        try {
            window.NassauApp.showLoading(true);
            const urbs = await window.NassauAPI.apiGet('/urbanizaciones');
            const tbody = urbs.map(u => `
                <tr>
                    <td><strong>${u.nombre}</strong></td>
                    <td>${u.direccion || '-'}</td>
                    <td>${u.email || '-'}</td>
                    <td><span class="badge badge-${u.estado === 'admitida' ? 'activo' : (u.estado === 'rechazada' ? 'moroso' : 'inactivo')}">${u.estado.toUpperCase()}</span></td>
                    <td>
                        <button class="btn-secondary btn-sm" onclick="window.NassauSuperAdmin.showEditUrbModal('${u.id}', '${encodeURIComponent(JSON.stringify({nombre: u.nombre, direccion: u.direccion || '', email: u.email || '', telefono: u.telefono || '', banco_numero_cuenta: u.banco_numero_cuenta || '', banco_tipo_cuenta: u.banco_tipo_cuenta || 'ahorros', banco_titular: u.banco_titular || '', banco_celular: u.banco_celular || ''}))}')">Editar</button>
                        <button class="btn-secondary btn-sm" onclick="window.NassauSuperAdmin.updateEstado('${u.id}', 'admitida')">Admitir</button>
                        <button class="btn-danger btn-sm" onclick="window.NassauSuperAdmin.updateEstado('${u.id}', 'rechazada')">Rechazar</button>
                    </td>
                </tr>`).join('');
            document.getElementById('sa-content').innerHTML = `
                <table class="premium-table">
                    <thead><tr><th>Nombre</th><th>Dirección</th><th>Email</th><th>Estado</th><th>Acciones</th></tr></thead>
                    <tbody>${tbody}</tbody>
                </table>`;
        } catch(e) { window.NassauApp.showToast(e.message || 'Error cargando urbanizaciones', 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async loadUrbanizacionesSelect(selectId) {
        const sel = document.getElementById(selectId);
        const urbs = await window.NassauAPI.apiGet('/urbanizaciones');
        sel.innerHTML = `<option value="">— Sin urbanización —</option>` +
            urbs.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
    },
    showCreateModal() {
        const html = `
            <form onsubmit="window.NassauSuperAdmin.create(event)">
                <div class="form-group"><label>Nombre Completo</label><input type="text" id="us-nombre" required></div>
                <div class="form-group"><label>Email (login)</label><input type="email" id="us-email" required></div>
                <div class="form-group"><label>Contraseña (mín. 8 caracteres)</label><input type="text" id="us-password" required minlength="8"></div>
                <div class="form-row">
                    <div class="form-group"><label>Rol</label>
                        <select id="us-rol" onchange="document.getElementById('us-urb-wrap').style.display = this.value === 'superadmin' ? 'none' : 'block'">
                            <option value="admin_urb">Administrador</option>
                            <option value="propietario">Propietario</option>
                            <option value="superadmin">SuperAdmin</option>
                        </select>
                    </div>
                    <div class="form-group" id="us-urb-wrap"><label>Urbanización</label><select id="us-urb"></select></div>
                </div>
                <div class="form-group"><label>Expiración de registro</label><input type="date" id="us-exp"></div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Crear</button>
                </div>
            </form>`;
        window.NassauApp.showModal('Nueva Cuenta Autorizada', html);
        this.loadUrbanizacionesSelect('us-urb');
    },
    async create(e) {
        e.preventDefault();
        const data = {
            nombre: document.getElementById('us-nombre').value,
            email: document.getElementById('us-email').value,
            password: document.getElementById('us-password').value,
            rol: document.getElementById('us-rol').value,
            urbanizacion_id: document.getElementById('us-urb').value || null,
            fecha_expiracion: document.getElementById('us-exp').value || null
        };
        this.save(data, true);
    },
    async showEditModal(id) {
        const users = await window.NassauAPI.apiGet('/usuarios');
        const u = users.find(x => x.id === id);
        if (!u) return window.NassauApp.showToast('Usuario no encontrado', 'error');
        const exp = u.fecha_expiracion ? u.fecha_expiracion.slice(0, 10) : '';
        const html = `
            <form onsubmit="window.NassauSuperAdmin.saveEdit('${id}', event)">
                <div class="form-group"><label>Nombre Completo</label><input type="text" id="us-nombre" value="${u.nombre}" required></div>
                <div class="form-group"><label>Email (login)</label><input type="email" id="us-email" value="${u.email}" required></div>
                <div class="form-group"><label>Nueva Contraseña (dejar vacío para no cambiar)</label><input type="text" id="us-password" minlength="8" placeholder="••••••••"></div>
                <div class="form-row">
                    <div class="form-group"><label>Rol</label>
                        <select id="us-rol">
                            <option value="admin_urb" ${u.rol === 'admin_urb' ? 'selected' : ''}>Administrador</option>
                            <option value="propietario" ${u.rol === 'propietario' ? 'selected' : ''}>Propietario</option>
                            <option value="superadmin" ${u.rol === 'superadmin' ? 'selected' : ''}>SuperAdmin</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Urbanización</label><select id="us-urb"></select></div>
                </div>
                <div class="form-group"><label>Expiración de registro</label><input type="date" id="us-exp" value="${exp}"></div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Guardar</button>
                </div>
            </form>`;
        window.NassauApp.showModal('Editar Cuenta', html);
        const sel = document.getElementById('us-urb');
        const urbs = await window.NassauAPI.apiGet('/urbanizaciones');
        sel.innerHTML = `<option value="">— Sin urbanización —</option>` +
            urbs.map(x => `<option value="${x.id}">${x.nombre}</option>`).join('');
        sel.value = u.urbanizacion_id || '';
    },
    async saveEdit(id, e) {
        e.preventDefault();
        const data = {
            nombre: document.getElementById('us-nombre').value,
            email: document.getElementById('us-email').value,
            rol: document.getElementById('us-rol').value,
            urbanizacion_id: document.getElementById('us-urb').value || null,
            fecha_expiracion: document.getElementById('us-exp').value || null
        };
        const pw = document.getElementById('us-password').value;
        if (pw) data.password = pw;
        await this.save(data, false, id);
    },
    async save(data, isCreate, id) {
        try {
            window.NassauApp.showLoading(true);
            if (isCreate) await window.NassauAPI.apiPost('/usuarios', data);
            else await window.NassauAPI.apiPut(`/usuarios/${id}`, data);
            window.NassauApp.showToast(isCreate ? 'Cuenta creada' : 'Cuenta actualizada', 'success');
            window.NassauApp.closeModal();
            this.loadUsuarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async revoke(id) {
        if(!confirm('¿Revocar (bloquear) esta cuenta? El usuario no podrá iniciar sesión.')) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/usuarios/${id}/revoke`, {});
            window.NassauApp.showToast('Cuenta revocada', 'success');
            this.loadUsuarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async reinstate(id) {
        if(!confirm('¿Reactivar esta cuenta?')) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/usuarios/${id}/reinstate`, {});
            window.NassauApp.showToast('Cuenta reactivada', 'success');
            this.loadUsuarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async del(id, nombre) {
        if(!confirm(`¿Eliminar definitivamente a "${nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiDelete(`/usuarios/${id}`);
            window.NassauApp.showToast('Cuenta eliminada', 'success');
            this.loadUsuarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    showCreateUrbModal() {
        const html = `
            <form onsubmit="window.NassauSuperAdmin.createUrb(event)">
                <div class="form-group"><label>Nombre</label><input type="text" id="sa-nombre" required></div>
                <div class="form-group"><label>Dirección</label><input type="text" id="sa-dir"></div>
                <div class="form-group"><label>Email</label><input type="email" id="sa-email"></div>
                <div class="form-group"><label>Teléfono</label><input type="text" id="sa-tel"></div>
                <div class="form-group"><label>Prefijo Documento</label><input type="text" id="sa-prefijo" value="NAS" maxlength="10"></div>
                <hr style="margin: 10px 0; border-color: #ddd;">
                <p style="font-weight: bold; margin-bottom: 10px;">Datos Bancarios (para PDF)</p>
                <div class="form-group"><label>Número de Cuenta</label><input type="text" id="sa-cuenta"></div>
                <div class="form-group"><label>Tipo de Cuenta</label>
                    <select id="sa-tipo-cuenta">
                        <option value="ahorros">Ahorros</option>
                        <option value="corriente">Corriente</option>
                    </select>
                </div>
                <div class="form-group"><label>Titular de la Cuenta</label><input type="text" id="sa-titular"></div>
                <div class="form-group"><label>Celular de Contacto</label><input type="text" id="sa-celular"></div>
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
            email: document.getElementById('sa-email').value,
            telefono: document.getElementById('sa-tel').value,
            prefijo_doc: document.getElementById('sa-prefijo').value.trim().toUpperCase() || 'NAS',
            banco_numero_cuenta: document.getElementById('sa-cuenta').value,
            banco_tipo_cuenta: document.getElementById('sa-tipo-cuenta').value,
            banco_titular: document.getElementById('sa-titular').value,
            banco_celular: document.getElementById('sa-celular').value
        };
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPost('/urbanizaciones', data);
            window.NassauApp.showToast('Urbanización creada (pendiente de aprobación)', 'success');
            window.NassauApp.closeModal();
            this.loadUrbanizaciones();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    showEditUrbModal(id, encodedData) {
        const data = JSON.parse(decodeURIComponent(encodedData));
        const html = `
            <form onsubmit="window.NassauSuperAdmin.updateUrb(event, '${id}')">
                <div class="form-group"><label>Nombre</label><input type="text" id="sa-edit-nombre" value="${data.nombre}" required></div>
                <div class="form-group"><label>Dirección</label><input type="text" id="sa-edit-dir" value="${data.direccion}"></div>
                <div class="form-group"><label>Email</label><input type="email" id="sa-edit-email" value="${data.email}"></div>
                <div class="form-group"><label>Teléfono</label><input type="text" id="sa-edit-tel" value="${data.telefono}"></div>
                <hr style="margin: 10px 0; border-color: #ddd;">
                <p style="font-weight: bold; margin-bottom: 10px;">Datos Bancarios (para PDF)</p>
                <div class="form-group"><label>Número de Cuenta</label><input type="text" id="sa-edit-cuenta" value="${data.banco_numero_cuenta}"></div>
                <div class="form-group"><label>Tipo de Cuenta</label>
                    <select id="sa-edit-tipo-cuenta">
                        <option value="ahorros" ${data.banco_tipo_cuenta === 'ahorros' ? 'selected' : ''}>Ahorros</option>
                        <option value="corriente" ${data.banco_tipo_cuenta === 'corriente' ? 'selected' : ''}>Corriente</option>
                    </select>
                </div>
                <div class="form-group"><label>Titular de la Cuenta</label><input type="text" id="sa-edit-titular" value="${data.banco_titular}"></div>
                <div class="form-group"><label>Celular de Contacto</label><input type="text" id="sa-edit-celular" value="${data.banco_celular}"></div>
                <div class="form-group">
                    <label>Logo del edificio (mín. 200x200 px, JPG/PNG, máx. 700 KB)</label>
                    <div id="sa-edit-logo-preview" style="margin:8px 0;"></div>
                    <input type="file" id="sa-edit-logo" accept="image/jpeg,image/png" class="search-input" onchange="window.NassauSuperAdmin.previewLogo(this, 'sa-edit-logo-preview')">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Guardar</button>
                </div>
            </form>`;
        window.NassauApp.showModal('Editar Urbanización', html);
        fetch(`https://nassau-api.policomputo.workers.dev/api/urbanizaciones/${id}/logo`)
            .then(r => r.json()).then(d => {
                if (d.logo) document.getElementById('sa-edit-logo-preview').innerHTML = `<img src="${d.logo}" style="max-height:80px;border-radius:8px;">`;
            }).catch(() => {});
    },
    previewLogo(input, previewId) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            document.getElementById(previewId).innerHTML = `<img src="${e.target.result}" style="max-height:80px;border-radius:8px;">`;
        };
        reader.readAsDataURL(file);
    },
    async updateUrb(e, id) {
        e.preventDefault();
        try {
            window.NassauApp.showLoading(true);
            
            // Actualizar datos bancarios
            const data = {
                nombre: document.getElementById('sa-edit-nombre').value,
                direccion: document.getElementById('sa-edit-dir').value,
                email: document.getElementById('sa-edit-email').value,
                telefono: document.getElementById('sa-edit-tel').value,
                banco_numero_cuenta: document.getElementById('sa-edit-cuenta').value,
                banco_tipo_cuenta: document.getElementById('sa-edit-tipo-cuenta').value,
                banco_titular: document.getElementById('sa-edit-titular').value,
                banco_celular: document.getElementById('sa-edit-celular').value
            };
            await window.NassauAPI.apiPut(`/urbanizaciones/${id}`, data);
            
            // Actualizar logo si se seleccionó
            const fileInput = document.getElementById('sa-edit-logo');
            if (fileInput.files[0]) {
                const file = fileInput.files[0];
                if (file.size > 700 * 1024) {
                    window.NassauApp.showToast('El logo no debe exceder 700 KB', 'error');
                    return;
                }
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                await window.NassauAPI.apiPut(`/urbanizaciones/${id}/logo`, { logo_base64: base64 });
            }
            
            window.NassauApp.showToast('Urbanización actualizada', 'success');
            window.NassauApp.closeModal();
            this.loadUrbanizaciones();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async updateEstado(id, estado) {
        if(!confirm(`¿Cambiar estado a ${estado.toUpperCase()}?`)) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/urbanizaciones/${id}/estado`, { estado });
            window.NassauApp.showToast('Estado actualizado', 'success');
            this.loadUrbanizaciones();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    }
};