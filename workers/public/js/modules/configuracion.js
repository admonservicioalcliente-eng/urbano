window.NassauConfiguracion = {
    async renderPage() {
        const html = `
            <div class="header-actions">
                <h2>Configuración Anual</h2>
                <button class="btn-primary" onclick="window.NassauConfiguracion.showConfigModal()">+ Nuevo Año</button>
            </div>
            <div class="card" style="margin-bottom: 20px;">
                <h3>Acciones de Sistema</h3>
                <p style="color: var(--text-secondary); margin-bottom: 15px;">Generar cuotas mensuales para todos los propietarios activos.</p>
                <button class="btn-secondary" onclick="window.NassauConfiguracion.generarCuotas()">Generar Cuotas Manualmente</button>
            </div>
            <div class="card table-container">
                <table class="premium-table config-table" id="config-table">
                    <thead><tr><th>Año</th><th>Cuota</th><th>Prefijo</th><th>Consecutivo</th><th>Próx.</th><th>Tasa Mora (%)</th><th>Día Gen.</th><th>Día Venc.</th><th>Día Mora</th><th>Copia PDF</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;
        document.getElementById('page-config').innerHTML = html;
        await this.loadConfig();
    },
    async loadConfig() {
        try {
            window.NassauApp.showLoading(true);
            const params = await window.NassauAPI.apiGet('/parametros');
            const tbody = document.querySelector('#config-table tbody');
            if(params.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="text-center">No hay parámetros configurados</td></tr>';
                return;
            }
            tbody.innerHTML = params.map(p => {
                const nextConsec = (p.consecutivo_comprobante || 0) + 1;
                const proximo = `${p.prefijo_comprobante || 'NAS'}-${String(nextConsec).padStart(4, '0')}`;
                return `
                <tr>
                    <td><strong>${p.anio}</strong></td>
                    <td>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div class="config-dias-control">
                                <span style="margin-right:4px;">$</span>
                                <input type="number" step="1000" min="0" class="config-field config-cuota" id="cuota-${p.id}" value="${p.cuota_admon || 0}">
                            </div>
                            <button class="btn-primary btn-sm" onclick="window.NassauConfiguracion.modificarCuota('${p.id}')">Modificar</button>
                        </div>
                    </td>
                    <td><span class="badge badge-activo">${p.prefijo_comprobante || 'NAS'}</span></td>
                    <td>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div class="config-consec-control">
                                <button class="btn-secondary btn-sm" onclick="window.NassauConfiguracion.ajustarConsecutivo('${p.id}', -1)">−</button>
                                <input type="number" min="0" class="config-consec-input" id="consec-${p.id}" value="${p.consecutivo_comprobante || 0}">
                                <button class="btn-secondary btn-sm" onclick="window.NassauConfiguracion.ajustarConsecutivo('${p.id}', 1)">+</button>
                            </div>
                            <button class="btn-primary btn-sm" onclick="window.NassauConfiguracion.generarConsecutivo('${p.id}', '${p.prefijo_comprobante || 'NAS'}')">Generar</button>
                        </div>
                    </td>
                    <td><span class="badge badge-activo" id="proximo-${p.id}">${proximo}</span></td>
                    <td>
                        <div class="config-dias-control">
                            <input type="number" step="0.01" min="0" class="config-field config-tasa" id="tasa-${p.id}" value="${p.tasa_mora_mensual}">
                            <span class="config-suffix">%</span>
                        </div>
                    </td>
                    <td><input type="number" min="1" max="28" class="config-field config-gen" id="gen-${p.id}" value="${p.dia_generacion_cuota}"></td>
                    <td><input type="number" min="1" max="28" class="config-field config-venc" id="venc-${p.id}" value="${p.dia_vencimiento_sin_mora}"></td>
                    <td>
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            <input type="number" min="1" max="28" class="config-field config-mora" id="mora-${p.id}" value="${p.dia_inicio_mora}">
                            <button class="btn-primary btn-sm config-update" data-id="${p.id}" style="display:none;">Actualizar</button>
                        </div>
                    </td>
                    <td>
                        <label class="toggle-switch">
                            <input type="checkbox" ${p.mostrar_copia !== false ? 'checked' : ''} onchange="window.NassauConfiguracion.toggleCopia('${p.id}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </td>
                </tr>`;
            }).join('');
            tbody.querySelectorAll('.config-field').forEach(field => {
                field.addEventListener('input', () => {
                    const tr = field.closest('tr');
                    const btn = tr.querySelector('.config-update');
                    btn.style.display = 'inline-block';
                });
            });
            tbody.querySelectorAll('.config-update').forEach(btn => {
                btn.addEventListener('click', () => this.actualizarConfig(btn.dataset.id, btn));
            });
        } catch(e) { window.NassauApp.showToast('Error cargando configuración', 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    showConfigModal() {
        const html = `
            <form onsubmit="window.NassauConfiguracion.saveConfig(event)">
                <div class="form-row">
                    <div class="form-group"><label>Año</label><input type="number" id="conf-anio" required value="${new Date().getFullYear()}"></div>
                    <div class="form-group"><label>Prefijo Comprobante</label><input type="text" id="conf-prefijo" required value="NAS" maxlength="10" placeholder="Ej: NAS, ABN, PGO"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Cuota Admín. Mensual ($)</label><input type="number" step="0.01" id="conf-cuota" required value="234000" placeholder="Ej: 234000"></div>
                    <div class="form-group"><label>Tasa Mora Mensual (%)</label><input type="number" step="0.01" id="conf-tasa" required value="1.5"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Día Generación</label><input type="number" id="conf-gen" required value="1" min="1" max="28"></div>
                    <div class="form-group"><label>Día Vencimiento</label><input type="number" id="conf-venc" required value="5" min="1" max="28"></div>
                </div>
                <div class="form-group"><label>Día Inicio Mora</label><input type="number" id="conf-mora" required value="6" min="1" max="28"></div>
                <div class="form-group">
                    <label>Mostrar COPIA en PDF</label>
                    <select id="conf-copia">
                        <option value="true" selected>Sí (Original + Copia)</option>
                        <option value="false">No (Solo Original)</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="window.NassauApp.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Guardar</button>
                </div>
            </form>`;
        window.NassauApp.showModal('Configurar Parámetros', html);
    },
    async saveConfig(e) {
        e.preventDefault();
        const data = {
            anio: document.getElementById('conf-anio').value,
            prefijo_comprobante: document.getElementById('conf-prefijo').value.trim().toUpperCase() || 'NAS',
            cuota_admon: document.getElementById('conf-cuota').value,
            tasa_mora_mensual: document.getElementById('conf-tasa').value,
            dia_generacion_cuota: document.getElementById('conf-gen').value,
            dia_vencimiento_sin_mora: document.getElementById('conf-venc').value,
            dia_inicio_mora: document.getElementById('conf-mora').value,
            mostrar_copia: document.getElementById('conf-copia').value === 'true'
        };
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPost('/parametros', data);
            window.NassauApp.showToast('Configuración guardada', 'success');
            window.NassauApp.closeModal();
            this.loadConfig();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    async generarCuotas() {
        if(!confirm('¿Generar cuotas para el mes actual? Esto afectará los estados de cuenta.')) return;
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPost('/cuotas/generar', {});
            window.NassauApp.showToast('Cuotas generadas correctamente', 'success');
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    ajustarConsecutivo(id, delta) {
        const input = document.getElementById(`consec-${id}`);
        if (!input) return;
        let val = parseInt(input.value) || 0;
        const nuevo = Math.max(0, val + delta);
        input.value = nuevo;
    },
    async actualizarConfig(id, btn) {
        const data = {
            tasa_mora_mensual: parseFloat(document.getElementById(`tasa-${id}`).value) || 0,
            dia_generacion_cuota: parseInt(document.getElementById(`gen-${id}`).value) || 1,
            dia_vencimiento_sin_mora: parseInt(document.getElementById(`venc-${id}`).value) || 1,
            dia_inicio_mora: parseInt(document.getElementById(`mora-${id}`).value) || 1
        };
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/parametros/${id}`, data);
            window.NassauApp.showToast('Configuración actualizada', 'success');
            btn.style.display = 'none';
            this.loadConfig();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    async generarConsecutivo(id, prefijo) {
        const input = document.getElementById(`consec-${id}`);
        if (!input) return;
        const valor = parseInt(input.value);
        if (isNaN(valor) || valor < 0) {
            window.NassauApp.showToast('Ingrese un consecutivo válido', 'error');
            return;
        }
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/parametros/${id}`, { consecutivo_comprobante: valor });
            const next = valor + 1;
            const proximoEl = document.getElementById(`proximo-${id}`);
            if (proximoEl) proximoEl.textContent = `${prefijo || 'NAS'}-${String(next).padStart(4, '0')}`;
            window.NassauApp.showToast(`Consecutivo actualizado a ${valor}`, 'success');
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async toggleCopia(id, checked) {
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPut(`/parametros/${id}`, { mostrar_copia: checked });
            window.NassauApp.showToast(checked ? 'COPIA activada en PDF' : 'COPIA desactivada en PDF', 'success');
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    },
    async modificarCuota(id) {
        const input = document.getElementById(`cuota-${id}`);
        if (!input) return;
        const nuevaCuota = parseFloat(input.value);
        if (isNaN(nuevaCuota) || nuevaCuota < 0) {
            window.NassauApp.showToast('Ingrese un valor válido', 'error');
            return;
        }
        if (!confirm(`¿Modificar cuota a $${nuevaCuota.toLocaleString()}?\n\nSi el valor es mayor al anterior, se generará un cobro retroactivo (Ley 675) por la diferencia en los meses ya cerrados.`)) return;
        try {
            window.NassauApp.showLoading(true);
            const result = await window.NassauAPI.apiPut(`/parametros/${id}`, { cuota_admon: nuevaCuota });
            window.NassauApp.showToast('Cuota modificada exitosamente', 'success');
            this.loadConfig();
        } catch(e) { window.NassauApp.showToast('Error: ' + e.message, 'error'); }
        finally { window.NassauApp.showLoading(false); }
    }
};

window.NassauConfiguracion.generarConsecutivo = window.NassauConfiguracion.generarConsecutivo.bind(window.NassauConfiguracion);
