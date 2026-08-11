window.NassauPropietarios = {
    renderPage() {
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
                    <thead><tr><th>Apartamento</th><th>Prefijo</th><th>Celda</th><th>Nombre</th><th>Cuota Admon</th><th>Modo Pago</th><th>Estado</th><th>Acciones</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;
        document.getElementById('page-propietarios').innerHTML = html;
        document.getElementById('prop-search')?.addEventListener('input', (e) => this.filterTable(e.target.value));
        return this.loadPropietarios();
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
                <td>${p.apartamento}</td><td>${p.prefijo || '-'}</td><td>${p.no_celda || '-'}</td><td>${p.nombre_propietario}</td>
                <td>$${Number(p.cuota_admon).toLocaleString()}</td><td>${p.modo_pago}</td>
                <td>
                    <select data-id="${p.id}" data-orig="${p.estado}" class="search-input prop-estado-select" style="padding:0.2rem 0.4rem;">
                        <option value="activo" ${p.estado === 'activo' ? 'selected' : ''}>Activo</option>
                        <option value="moroso" ${p.estado === 'moroso' ? 'selected' : ''}>Moroso</option>
                        <option value="abono_inicial" ${p.estado === 'abono_inicial' ? 'selected' : ''}>Abono Inicial</option>
                        <option value="inactivo" ${p.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
                    </select>
                    <button class="btn-primary btn-sm prop-estado-update" data-id="${p.id}" style="display:none;">Actualizar</button>
                </td>
                <td>
                    <button class="btn-secondary btn-sm" data-id="${p.id}" onclick="window.NassauPropietarios.showEditModal(this.dataset.id)">Editar</button>
                    <button class="btn-danger btn-sm" data-id="${p.id}" onclick="window.NassauPropietarios.deletePropietario(this.dataset.id)">Eliminar</button>
                </td>
            </tr>`).join('');
        tbody.querySelectorAll('.prop-estado-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const btn = sel.closest('tr').querySelector('.prop-estado-update');
                btn.style.display = (sel.value !== sel.dataset.orig) ? 'inline-block' : 'none';
            });
        });
        tbody.querySelectorAll('.prop-estado-update').forEach(btn => {
            btn.addEventListener('click', () => {
                const sel = btn.closest('tr').querySelector('.prop-estado-select');
                this.updateEstado(btn.dataset.id, sel.value, btn);
            });
        });
    },
    async updateEstado(id, estado, btn) {
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/propietarios/${id}`, { estado });
            window.NassauApp.showToast('Estado actualizado', 'success');
            this.loadPropietarios();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    filterTable(term) {
        if (!this.propietarios) return;
        const lower = term.toLowerCase();
        const filtered = this.propietarios.filter(p => p.nombre_propietario.toLowerCase().includes(lower) || p.apartamento.toLowerCase().includes(lower));
        this.renderTable(filtered);
    },
    showCreateModal() {
        this.currentEditId = null;
        window.NassauApp.showModal('Nuevo Propietario', this.getFormHtml());
        this.autofillPrefijo();
    },
    showEditModal(id) {
        const p = this.propietarios.find(x => x.id === id);
        if (!p) return;
        this.currentEditId = id;
        window.NassauApp.showModal('Editar Propietario', this.getFormHtml(p));
        if (p.estado === 'moroso' || p.estado === 'abono_inicial') this.filtrarMesesInicio();
    },
    async autofillPrefijo() {
        try {
            const params = await window.NassauAPI.apiGet('/parametros');
            const anio = new Date().getFullYear();
            const actual = params.find(p => p.anio === anio) || params[0];
            const input = document.getElementById('prop-prefijo');
            if (input && !input.value && actual?.prefijo_comprobante) {
                input.value = actual.prefijo_comprobante;
            }
        } catch(e) { /* silencioso */ }
    },
    getFormHtml(p = {}) {
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();
        const mesNames = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const mostrarInicio = (p.estado === 'moroso' || p.estado === 'abono_inicial');
        const mostrarAbono = p.estado === 'abono_inicial';
        return `
            <form id="prop-form" onsubmit="window.NassauPropietarios.savePropietario(event)">
                <div class="form-group"><label>Nombre Completo</label><input type="text" id="prop-nombre" value="${p.nombre_propietario || ''}" required></div>
                <div class="form-row">
                    <div class="form-group"><label>Apartamento</label><input type="text" id="prop-apto" value="${p.apartamento || ''}" required></div>
                    <div class="form-group"><label>Celda</label><input type="text" id="prop-celda" value="${p.no_celda || ''}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Prefijo Documento</label><input type="text" id="prop-prefijo" value="${p.prefijo || ''}" maxlength="10" placeholder="Ej: NAS"></div>
                    <div class="form-group"><label>Cuota de Administración</label><input type="number" id="prop-cuota" value="${p.cuota_admon || ''}" required></div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Estado</label>
                        <select id="prop-estado" onchange="window.NassauPropietarios.toggleInicio()">
                            <option value="activo" ${p.estado === 'activo' ? 'selected' : ''}>Activo</option>
                            <option value="moroso" ${p.estado === 'moroso' ? 'selected' : ''}>Moroso</option>
                            <option value="abono_inicial" ${p.estado === 'abono_inicial' ? 'selected' : ''}>Abono Inicial</option>
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
                <div id="prop-inicio-wrap" style="display:${mostrarInicio ? 'block' : 'none'};">
                    <p style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:0.8rem;">
                        Datos de inicio del estado de cuenta: se generan las cuotas desde este mes/año hasta el mes actual.
                    </p>
                    <div class="form-row">
                        <div class="form-group"><label>Mes de inicio *</label>
                            <select id="prop-mes-inicio" ${mostrarInicio ? 'required' : ''}>
                                <option value="">— Seleccione —</option>
                                ${mesNames.slice(1).map((n, i) => `<option value="${i + 1}" ${p.mes_inicio == (i + 1) ? 'selected' : ''}>${n}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group"><label>Año de inicio *</label>
                            <select id="prop-anio-inicio" ${mostrarInicio ? 'required' : ''} onchange="window.NassauPropietarios.filtrarMesesInicio()">
                                <option value="">— Seleccione —</option>
                                ${[anioActual, anioActual - 1, anioActual - 2, anioActual - 3].map(a =>
                                    `<option value="${a}" ${p.anio_inicio == a ? 'selected' : ''}>${a}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-group" id="prop-abono-wrap" style="display:${mostrarAbono ? 'block' : 'none'};">
                        <label>Abono inicial ($)</label>
                        <input type="number" step="0.01" id="prop-abono" value="${p.abono_inicial || ''}" placeholder="Ej: 100000">
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
    toggleInicio() {
        const estado = document.getElementById('prop-estado').value;
        const wrap = document.getElementById('prop-inicio-wrap');
        const abonoWrap = document.getElementById('prop-abono-wrap');
        const abonoInput = document.getElementById('prop-abono');
        const mesSel = document.getElementById('prop-mes-inicio');
        const anioSel = document.getElementById('prop-anio-inicio');
        const visible = (estado === 'moroso' || estado === 'abono_inicial');
        if (wrap) wrap.style.display = visible ? 'block' : 'none';
        if (abonoWrap) abonoWrap.style.display = estado === 'abono_inicial' ? 'block' : 'none';
        if (mesSel) mesSel.required = visible;
        if (anioSel) anioSel.required = visible;
        if (visible) this.filtrarMesesInicio();
    },
    filtrarMesesInicio() {
        const anioSel = parseInt(document.getElementById('prop-anio-inicio').value);
        const mesSel = document.getElementById('prop-mes-inicio');
        const mesActual = new Date().getMonth() + 1;
        if (!mesSel) return;
        Array.from(mesSel.options).forEach(op => {
            if (!op.value) return;
            const m = parseInt(op.value);
            // Si el año seleccionado es el actual, solo se permiten meses anteriores al actual
            if (anioSel === new Date().getFullYear() && m >= mesActual) {
                op.disabled = true;
            } else {
                op.disabled = false;
            }
        });
        const val = parseInt(mesSel.value);
        const hoy = new Date();
        if (anioSel === hoy.getFullYear() && val >= mesActual) mesSel.value = '';
    },
    async savePropietario(e) {
        e.preventDefault();
        const data = {
            nombre_propietario: document.getElementById('prop-nombre').value.trim(),
            apartamento: document.getElementById('prop-apto').value.trim(),
            no_celda: document.getElementById('prop-celda').value.trim() || null,
            cuota_admon: parseFloat(document.getElementById('prop-cuota').value) || 0,
            estado: document.getElementById('prop-estado').value,
            modo_pago: document.getElementById('prop-modo').value,
            telefono: document.getElementById('prop-tel').value.trim() || null,
            email: document.getElementById('prop-email').value.trim() || null,
            notas: document.getElementById('prop-notas').value.trim() || null,
            prefijo: (document.getElementById('prop-prefijo').value || '').trim().toUpperCase() || null,
            mes_inicio: document.getElementById('prop-mes-inicio')?.value || null,
            anio_inicio: document.getElementById('prop-anio-inicio')?.value || null,
            abono_inicial: document.getElementById('prop-abono')?.value ? parseFloat(document.getElementById('prop-abono').value) : 0
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