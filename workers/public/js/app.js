window.NassauApp = {
    init() {
        this.setupNavigation();
        this.setupModals();
        window.NassauAuth.initAuth();
        this.loadSidebarLogo();
    },
    async loadSidebarLogo() {
        const img = document.getElementById('sidebar-logo-img');
        if (!img) return;
        const urbId = localStorage.getItem('nassau_urb_id');
        if (!urbId) return;
        try {
            const data = await window.NassauAPI.apiGet(`/urbanizaciones/${urbId}/logo`);
            if (data.logo) {
                img.src = data.logo;
                img.onerror = () => { img.src = '/assets/logo.jpg'; };
            }
        } catch(e) {}
    },
    setupNavigation() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                if(page === 'logout') window.NassauAuth.logout();
                else this.showPage(page);
            });
        });
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('active');
        });
    },
    async showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const targetPage = document.getElementById(`page-${pageId}`);
        if(targetPage) {
            targetPage.style.display = 'block';
            document.querySelector(`.nav-link[data-page="${pageId}"]`)?.classList.add('active');
            if(pageId === 'dashboard') await this.loadDashboard();
            else if(pageId === 'propietarios') await window.NassauPropietarios.renderPage();
            else if(pageId === 'pagos') await window.NassauPagos.renderPage();
            else if(pageId === 'estados') await window.NassauEstados.renderPage();
            else if(pageId === 'cobros') await window.NassauDocumentos.renderPage();
            else if(pageId === 'config') await window.NassauConfiguracion.renderPage();
            else if(pageId === 'superadmin') await window.NassauSuperAdmin.renderPage();
        }
        document.querySelector('.sidebar').classList.remove('active');
    },
    async loadDashboard() {
        try {
            this.showLoading(true);
            const data = await window.NassauAPI.apiGet('/dashboard');
            document.getElementById('page-dashboard').innerHTML = `
                <h2>Panel Principal</h2>
                <div class="dashboard-stats">
                    <div class="stat-card"><div class="stat-icon" style="color:var(--text-primary)">👤</div><div class="stat-value">${data.total_propietarios || 0}</div><div class="stat-label">Total Propietarios</div></div>
                    <div class="stat-card"><div class="stat-icon" style="color:var(--success)">$</div><div class="stat-value">$${Number(data.recaudado_mes || 0).toLocaleString()}</div><div class="stat-label">Recaudado este mes</div></div>
                    <div class="stat-card"><div class="stat-icon" style="color:var(--error)">$</div><div class="stat-value">$${Number(data.deuda_total || 0).toLocaleString()}</div><div class="stat-label">Deuda Total</div></div>
                    <div class="stat-card"><div class="stat-icon" style="color:var(--warning)">!</div><div class="stat-value">${data.morosos || 0}</div><div class="stat-label">Propietarios Morosos</div></div>
                </div>`;
        } catch(e) { console.error(e); } finally { this.showLoading(false); }
    },
    setupModals() {
        const overlay = document.getElementById('modal-overlay');
        overlay.addEventListener('click', (e) => { if(e.target === overlay) this.closeModal(); });
    },
    showModal(title, htmlContent) {
        const overlay = document.getElementById('modal-overlay');
        const container = document.getElementById('modal-container');
        container.innerHTML = `
            <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="window.NassauApp.closeModal()">&times;</button></div>
            <div class="modal-body">${htmlContent}</div>`;
        overlay.style.display = 'flex';
    },
    closeModal() { document.getElementById('modal-overlay').style.display = 'none'; },
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message; toast.className = `toast toast-${type} show`;
        setTimeout(() => toast.classList.remove('show'), 3000);
    },
    showLoading(show) { document.getElementById('app-loading').style.display = show ? 'flex' : 'none'; }
};
document.addEventListener('DOMContentLoaded', () => window.NassauApp.init());