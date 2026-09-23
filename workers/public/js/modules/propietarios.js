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
                    <thead><tr><th>Apartamento</th><th>Prefijo Doc</th><th>Celda</th><th>Nombre</th><th>Valor Cuota Admon</th><th>Valor Total Cuota</th><th>Modo Pago</th><th>Estado</th><th>Último Comprobante</th><th>Acciones</th></tr></thead>
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
        tbody.innerHTML = data.map(p => {
            const manual = p.cuota_admon != null && p.cuota_admon !== '' ? Number(p.cuota_admon) : 0;
            const total = p.cuota_total != null && p.cuota_total !== '' ? Number(p.cuota_total) : manual;
            return `<tr><td>${p.apartamento}</td><td>${p.prefijo || '-'}</td><td>${p.no_celda || '-'}</td><td>${p.nombre_propietario}</td><td>$${manual.toLocaleString()}</td><td><b>$${total.toLocaleString()}</b></td><td>${p.modo_pago}</td><td><select data-id="${p.id}" data-orig="${p.estado}" class="search-input prop-estado-select" style="padding:0.2rem 0.4rem;"><option value="activo" ${p.estado === 'activo' ? 'selected' : ''}>Activo</option><option value="moroso" ${p.estado === 'moroso' ? 'selected' : ''}>Moroso</option><option value="abono_inicial" ${p.estado === 'abono_inicial' ? 'selected' : ''}>Abono Inicial</option><option value="inactivo" ${p.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option></select><button class="btn-primary btn-sm prop-estado-update" data-id="${p.id}" style="display:none;">Actualizar</button></td><td>${p.ultimo_comprobante || '-'}</td><td><button class="btn-secondary btn-sm" data-id="${p.id}" onclick="window.NassauPropietarios.showEditModal(this.dataset.id)">Editar</button><button class="btn-danger btn-sm" data-id="${p.id}" onclick="window.NassauPropietarios.deletePropietario(this.dataset.id)">Eliminar</button></td></tr>`;
        }).join('');
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
        setTimeout(() => this.calcCuotaPreview(), 100);
    },
    showEditModal(id) {
        const p = this.propietarios.find(x => x.id === id);
        if (!p) return;
        this.currentEditId = id;
        window.NassauApp.showModal('Editar Propietario', this.getFormHtml(p));
        if (p.estado === 'moroso' || p.estado === 'abono_inicial') this.filtrarMesesInicio();
        setTimeout(() => this.calcCuotaPreview(), 100);
    },
    toggleInmueble(tipo) {
        if (tipo === 'apto') {
            const chk = document.getElementById('prop-has-apto');
            document.getElementById('prop-apto-fields').style.display = chk.checked ? 'flex' : 'none';
        } else if (tipo === 'celda') {
            const chk = document.getElementById('prop-has-celda');
            document.getElementById('prop-celda-fields').style.display = chk.checked ? 'flex' : 'none';
        } else {
            const chk = document.getElementById('prop-has-cuarto');
            document.getElementById('prop-cuarto-fields').style.display = chk.checked ? 'flex' : 'none';
        }
        this.calcCuotaPreview();
    },
    async calcCuotaPreview() {
        const preview = document.getElementById('prop-cuota-preview');
        const hidden = document.getElementById('prop-cuota');
        const totalInput = document.getElementById('prop-cuota-total');
        const manualInput = document.getElementById('prop-cuota-admon');
        if (!preview) return;
        let presupuesto = 0;
        try {
            const params = await window.NassauAPI.apiGet('/parametros');
            const anio = new Date().getFullYear();
            const actual = params.find(p => Number(p.anio) === anio) || params[0];
            presupuesto = parseFloat(actual?.cuota_admon) || 0;
        } catch {}
        const hasApto = document.getElementById('prop-has-apto')?.checked;
        const coefAptoRaw = hasApto ? (parseFloat(document.getElementById('prop-coef-apto')?.value) || 0) : 0;
        const hasCelda = document.getElementById('prop-has-celda')?.checked;
        const valCeldaRaw = hasCelda ? (parseFloat(document.getElementById('prop-valor-celda')?.value) || 0) : 0;
        const coefCeldaRaw = hasCelda && valCeldaRaw === 0 ? (parseFloat(document.getElementById('prop-coef-celda')?.value) || 0) : 0;
        const hasCuarto = document.getElementById('prop-has-cuarto')?.checked;
        const valCuartoRaw = hasCuarto ? (parseFloat(document.getElementById('prop-valor-cuarto')?.value) || 0) : 0;
        const coefCuartoRaw = hasCuarto && valCuartoRaw === 0 ? (parseFloat(document.getElementById('prop-coef-cuarto')?.value) || 0) : 0;
        // desactivar coef si hay valor
        const coefCeldaInput = document.getElementById('prop-coef-celda');
        const coefCuartoInput = document.getElementById('prop-coef-cuarto');
        if (coefCeldaInput) { coefCeldaInput.disabled = valCeldaRaw > 0; coefCeldaInput.style.opacity = valCeldaRaw > 0 ? '0.5' : '1'; if (valCeldaRaw > 0) coefCeldaInput.value = ''; }
        if (coefCuartoInput) { coefCuartoInput.disabled = valCuartoRaw > 0; coefCuartoInput.style.opacity = valCuartoRaw > 0 ? '0.5' : '1'; if (valCuartoRaw > 0) coefCuartoInput.value = ''; }
        const coefApto = coefAptoRaw, coefCelda = coefCeldaRaw, coefCuarto = coefCuartoRaw;
        const valCelda = valCeldaRaw, valCuarto = valCuartoRaw;
        const suma = coefApto + coefCelda + coefCuarto;
        const cuotaManual = parseFloat(manualInput?.value) || 0;
        let vApto=0, vCelda=0, vCuarto=0, total=0;
        const tieneCoef = hasApto || (hasCelda && (coefCelda>0 || valCelda>0)) || (hasCuarto && (coefCuarto>0 || valCuarto>0));
        if (tieneCoef) {
            if (valCelda>0 || valCuarto>0 || suma>0) {
                vApto = hasApto && presupuesto>0 ? presupuesto * coefApto / 100 : 0;
                vCelda = hasCelda ? (valCelda>0 ? valCelda : (presupuesto>0 ? presupuesto * coefCelda /100 : 0)) : 0;
                vCuarto = hasCuarto ? (valCuarto>0 ? valCuarto : (presupuesto>0 ? presupuesto * coefCuarto /100 : 0)) : 0;
                total = vApto + vCelda + vCuarto;
                if (total===0) total = cuotaManual || 0;
            } else {
                total = cuotaManual || 0; vApto = total;
            }
        } else {
            total = cuotaManual || parseFloat(hidden?.value) || 0;
            vApto = total;
        }
        if (hidden) hidden.value = Math.round(total);
        if (totalInput) totalInput.value = Math.round(total);
        // validación: si no hay manual ni coef, avisar
        if (!tieneCoef && !cuotaManual) {
            preview.innerHTML = `<span style="color:#ff6b6b;">Ingrese Valor Cuota Admon o marque al menos un inmueble con coeficiente</span><br><b>Total: $0</b>`;
        } else {
            preview.innerHTML = (tieneCoef && presupuesto) ? `Presupuesto $${presupuesto.toLocaleString()} × (${coefApto}+${coefCelda}+${coefCuarto})%/100 + $${valCelda.toLocaleString()} + $${valCuarto.toLocaleString()}<br>
            <b>Apto:</b> $${Math.round(vApto).toLocaleString()} ${hasCelda ? `| <b>Celda:</b> $${Math.round(vCelda).toLocaleString()}` : ''} ${hasCuarto ? `| <b>Cuarto:</b> $${Math.round(vCuarto).toLocaleString()}` : ''}<br>
            <b>Valor Total Cuota: $${Math.round(total).toLocaleString()}</b> ${!tieneCoef ? `(= Cuota Admon manual)` : ''}` : `Valor Total Cuota: $${Math.round(total).toLocaleString()}${tieneCoef ? ' (sin presupuesto año actual)' : ' (manual)'}`;
        }
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
        const hasCelda = !!(p.has_celda || p.no_celda);
        const hasCuarto = !!(p.has_cuarto_util || p.no_cuarto_util);
        const hasApto = !!(parseFloat(p.coef_apto) > 0);
        const coefApto = p.coef_apto ?? '';
        const coefCelda = p.coef_celda ?? '';
        const coefCuarto = p.coef_cuarto_util ?? '';
        const valCelda = p.valor_celda ?? '';
        const valCuarto = p.valor_cuarto_util ?? '';
        const noCuarto = p.no_cuarto_util ?? '';
        const cuotaManual = p.cuota_admon != null && p.cuota_admon !== '' ? p.cuota_admon : '';
        const cuotaTotal = p.cuota_total != null && p.cuota_total !== '' ? p.cuota_total : '';
        return `
            <style>#prop-form{scrollbar-width:thin; scrollbar-color: orange #111;} #prop-form::-webkit-scrollbar{width:8px} #prop-form::-webkit-scrollbar-thumb{background:orange; border-radius:4px} #prop-form::-webkit-scrollbar-track{background:#111}</style>
            <form id="prop-form" onsubmit="window.NassauPropietarios.savePropietario(event)" style="max-height:70vh; overflow-y:auto; padding-right:6px;">
                <div class="form-group"><label>Nombre Completo</label><input type="text" id="prop-nombre" value="${p.nombre_propietario || ''}" required></div>
                <div class="form-row">
                    <div class="form-group"><label>Apartamento</label><input type="text" id="prop-apto" value="${p.apartamento || ''}" required></div>
                    <div class="form-group"><label>Prefijo Documento Pago</label><input type="text" id="prop-prefijo" value="${p.prefijo || ''}" maxlength="10" placeholder="Ej: NAS"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Valor Cuota Admon $</label><input type="number" step="1000" min="0" id="prop-cuota-admon" value="${cuotaManual}" placeholder="Ej: 250000" oninput="window.NassauPropietarios.calcCuotaPreview()"></div>
                    <div class="form-group"><label>Valor Total Cuota Admon $</label><input type="number" id="prop-cuota-total" value="${cuotaTotal}" readonly style="background:#222; color:#fff; font-weight:bold;"></div>
                </div>
                <div style="border:1px solid #333; padding:12px; border-radius:8px; margin:12px 0; background:#111; color:#fff;">
                    <p style="font-weight:bold; margin:0 0 10px 0; text-align:left;">Inmuebles - coeficientes</p>
                    <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-start;">
                        <label style="display:flex; align-items:center; gap:8px; justify-content:flex-start;"><input type="checkbox" id="prop-has-apto" ${hasApto ? 'checked' : ''} onchange="window.NassauPropietarios.toggleInmueble('apto')"> Apto</label>
                        <div id="prop-apto-fields" style="display:${hasApto ? 'flex' : 'none'}; gap:10px; flex-wrap:wrap; margin-left:22px; align-items:end;">
                            <div class="form-group" style="margin:0; width:220px;"><label style="color:#fff; text-align:left; display:block;">Coef. Apto %</label><input type="number" step="0.0001" min="0" max="100" id="prop-coef-apto" value="${coefApto}" placeholder="Ej: 0.85" oninput="window.NassauPropietarios.calcCuotaPreview()" style="background:#000; color:#fff; border:1px solid #444;"></div>
                        </div>
                    </div>
                    <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px; align-items:flex-start;">
                        <label style="display:flex; align-items:center; gap:8px; justify-content:flex-start; width:100%;"><input type="checkbox" id="prop-has-celda" ${hasCelda ? 'checked' : ''} onchange="window.NassauPropietarios.toggleInmueble('celda')"> Celda</label>
                        <div id="prop-celda-fields" style="display:${hasCelda ? 'flex' : 'none'}; gap:10px; flex-wrap:wrap; margin-left:22px; align-items:end;">
                            <div class="form-group" style="margin:0;"><label style="color:#fff; text-align:left; display:block;">No. Celda</label><input type="text" id="prop-celda" value="${p.no_celda || ''}" placeholder="Ej: 12" style="background:#000; color:#fff; border:1px solid #444;"></div>
                            <div class="form-group" style="margin:0;"><label style="color:#fff; text-align:left; display:block;">Coef. Celda %</label><input type="number" step="0.0001" min="0" max="100" id="prop-coef-celda" value="${coefCelda}" placeholder="0" oninput="window.NassauPropietarios.calcCuotaPreview()" style="background:#000; color:#fff; border:1px solid #444;"></div>
                            <div class="form-group" style="margin:0;"><label style="color:#fff; text-align:left; display:block;">Valor Celda $</label><input type="number" step="1000" min="0" id="prop-valor-celda" value="${valCelda}" placeholder="0" oninput="window.NassauPropietarios.calcCuotaPreview()" style="background:#000; color:#fff; border:1px solid #444;"></div>
                        </div>
                    </div>
                    <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px; align-items:flex-start;">
                        <label style="display:flex; align-items:center; gap:8px; justify-content:flex-start; width:100%;"><input type="checkbox" id="prop-has-cuarto" ${hasCuarto ? 'checked' : ''} onchange="window.NassauPropietarios.toggleInmueble('cuarto')"> Cuarto Útil</label>
                        <div id="prop-cuarto-fields" style="display:${hasCuarto ? 'flex' : 'none'}; gap:10px; flex-wrap:wrap; margin-left:22px; align-items:end;">
                            <div class="form-group" style="margin:0;"><label style="color:#fff; text-align:left; display:block;">No. Cuarto Útil</label><input type="text" id="prop-cuarto-num" value="${noCuarto}" placeholder="Ej: 5" style="background:#000; color:#fff; border:1px solid #444;"></div>
                            <div class="form-group" style="margin:0;"><label style="color:#fff; text-align:left; display:block;">Coef. Cuarto %</label><input type="number" step="0.0001" min="0" max="100" id="prop-coef-cuarto" value="${coefCuarto}" placeholder="0" oninput="window.NassauPropietarios.calcCuotaPreview()" style="background:#000; color:#fff; border:1px solid #444;"></div>
                            <div class="form-group" style="margin:0;"><label style="color:#fff; text-align:left; display:block;">Valor Cuarto $</label><input type="number" step="1000" min="0" id="prop-valor-cuarto" value="${valCuarto}" placeholder="0" oninput="window.NassauPropietarios.calcCuotaPreview()" style="background:#000; color:#fff; border:1px solid #444;"></div>
                        </div>
                    </div>
                    <div id="prop-cuota-preview" style="margin-top:12px; padding:8px; background:#000; border:1px dashed #555; border-radius:6px; font-size:0.9rem; color:#fff; text-align:left;">Calculando cuota...</div>
                    <input type="hidden" id="prop-cuota" value="${cuotaTotal || cuotaManual || ''}">
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
        await this.calcCuotaPreview();
        const hasApto = document.getElementById('prop-has-apto')?.checked || false;
        const hasCelda = document.getElementById('prop-has-celda')?.checked || false;
        const hasCuarto = document.getElementById('prop-has-cuarto')?.checked || false;
        const cuotaManual = parseFloat(document.getElementById('prop-cuota-admon')?.value) || 0;
        const cuotaTotal = parseFloat(document.getElementById('prop-cuota-total')?.value) || parseFloat(document.getElementById('prop-cuota')?.value) || 0;
        if (!cuotaManual && !hasApto && !hasCelda && !hasCuarto) {
            window.NassauApp.showToast('Debe ingresar Valor Cuota Admon o marcar al menos un inmueble con coeficiente', 'error');
            return;
        }
        if (hasApto && !(parseFloat(document.getElementById('prop-coef-apto')?.value) > 0)) {
            window.NassauApp.showToast('Coef. Apto requerido si marca Apto', 'error');
            return;
        }
        const data = {
            nombre_propietario: document.getElementById('prop-nombre').value.trim(),
            apartamento: document.getElementById('prop-apto').value.trim(),
            no_celda: hasCelda ? (document.getElementById('prop-celda')?.value.trim() || null) : null,
            no_cuarto_util: hasCuarto ? (document.getElementById('prop-cuarto-num')?.value.trim() || null) : null,
            cuota_admon: cuotaManual,
            cuota_total: cuotaTotal,
            coef_apto: hasApto ? (parseFloat(document.getElementById('prop-coef-apto')?.value) || 0) : 0,
            coef_celda: hasCelda ? (parseFloat(document.getElementById('prop-coef-celda')?.value) || 0) : 0,
            coef_cuarto_util: hasCuarto ? (parseFloat(document.getElementById('prop-coef-cuarto')?.value) || 0) : 0,
            valor_celda: hasCelda ? (parseFloat(document.getElementById('prop-valor-celda')?.value) || 0) : 0,
            valor_cuarto_util: hasCuarto ? (parseFloat(document.getElementById('prop-valor-cuarto')?.value) || 0) : 0,
            has_celda: hasCelda,
            has_cuarto_util: hasCuarto,
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