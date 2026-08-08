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
                <table class="premium-table" id="config-table">
                    <thead><tr><th>Año</th><th>Tasa Mora (%)</th><th>Día Generación</th><th>Día Vencimiento</th><th>Día Inicio Mora</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>`;
        document.getElementById('page-config').innerHTML = html;
        await this.loadConfig();
    },
    async loadConfig() {
        try {
            window.NassauApp.showLoading(true);
            const params = await window.NassauAPI.apiGet('/configuracion');
            const tbody = document.querySelector('#config-table tbody');
            if(params.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay parámetros configurados</td></tr>';
                return;
            }
            tbody.innerHTML = params.map(p => `
                <tr>
                    <td><strong>${p.anio}</strong></td><td>${p.tasa_mora_mensual}%</td><td>${p.dia_generacion_cuota}</td>
                    <td>${p.dia_vencimiento_sin_mora}</td><td>${p.dia_inicio_mora}</td>
                </tr>`).join('');
        } catch(e) { window.NassauApp.showToast('Error cargando configuración', 'error'); } 
        finally { window.NassauApp.showLoading(false); }
    },
    showConfigModal() {
        const html = `
            <form onsubmit="window.NassauConfiguracion.saveConfig(event)">
                <div class="form-row">
                    <div class="form-group"><label>Año</label><input type="number" id="conf-anio" required value="${new Date().getFullYear()}"></div>
                    <div class="form-group"><label>Tasa Mora Mensual (%)</label><input type="number" step="0.01" id="conf-tasa" required value="2.5"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Día Generación</label><input type="number" id="conf-gen" required value="1" min="1" max="28"></div>
                    <div class="form-group"><label>Día Vencimiento</label><input type="number" id="conf-venc" required value="10" min="1" max="28"></div>
                </div>
                <div class="form-group"><label>Día Inicio Mora</label><input type="number" id="conf-mora" required value="11" min="1" max="28"></div>
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
            urb_id: localStorage.getItem('nassau_urb_id'),
            anio: document.getElementById('conf-anio').value,
            tasa_mora_mensual: document.getElementById('conf-tasa').value,
            dia_generacion_cuota: document.getElementById('conf-gen').value,
            dia_vencimiento_sin_mora: document.getElementById('conf-venc').value,
            dia_inicio_mora: document.getElementById('conf-mora').value
        };
        try {
            window.NassauApp.showLoading(true);
            await window.NassauAPI.apiPost('/configuracion', data);
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
    }
};