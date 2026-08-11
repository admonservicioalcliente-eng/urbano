window.NassauAuth = {
    initAuth() {
        if (this.isLoggedIn()) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-shell').style.display = 'flex';
            this.updateUserInfo();
            window.NassauApp?.showPage('dashboard');
        } else {
            this.renderLoginPage();
        }
    },
    async renderLoginPage() {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-shell').style.display = 'none';
        const select = document.getElementById('login-urb');
        try {
            const urbs = await window.NassauAPI.apiGet('/urbanizaciones');
            if(select && Array.isArray(urbs) && urbs.length) {
                select.innerHTML = urbs.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
                if (urbs.length === 1) select.value = urbs[0].id;
            } else throw new Error('empty');
        } catch (e) {
            if(select) select.innerHTML = '<option value="a1b2c3d4-0001-0001-0001-000000000001">Edificio Nassau P.H.</option>';
        }
    },
    async login(email, password, urb_id, cf_token) {
        try {
            window.NassauApp?.showLoading(true);
            const data = await window.NassauAPI.apiPost('/auth/login', { email, password, urb_id, cf_token });
            localStorage.setItem('nassau_token', data.token);
            localStorage.setItem('nassau_urb_id', urb_id);
            this.initAuth();
            window.NassauApp?.showToast('Login exitoso', 'success');
        } catch (error) { window.NassauApp?.showToast(error.message, 'error'); } 
        finally { window.NassauApp?.showLoading(false); }
    },
    logout() {
        localStorage.removeItem('nassau_token');
        localStorage.removeItem('nassau_urb_id');
        this.renderLoginPage();
    },    isLoggedIn() {
        const token = localStorage.getItem('nassau_token');
        if (!token) return false;
        try {
            const payload = this.getUser();
            if (payload.exp * 1000 < Date.now()) { this.logout(); return false; }
            return true;
        } catch (e) { return false; }
    },
    getUser() {
        const token = localStorage.getItem('nassau_token');
        if (!token) return null;
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(jsonPayload);
    },
    updateUserInfo() {
        const user = this.getUser();
        if (user) {
            const el = document.getElementById('user-info-name');
            if (el) el.textContent = user.email || user.name || 'Usuario';
            const saLink = document.querySelector('a[data-page="superadmin"]');
            if (saLink) saLink.style.display = user.rol === 'superadmin' ? 'flex' : 'none';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const urb_id = document.getElementById('login-urb').value;
        const cf_token = document.querySelector('[name="cf-turnstile-response"]')?.value || 'dummy_token';
        window.NassauAuth.login(email, password, urb_id, cf_token);
    });

    const regToggle = document.getElementById('btn-registro-toggle');
    const regForm = document.getElementById('registro-form');
    if (regToggle && regForm) {
        regToggle.addEventListener('click', () => {
            const hidden = regForm.style.display === 'none';
            regForm.style.display = hidden ? 'block' : 'none';
            regToggle.textContent = hidden ? 'Ocultar formulario de registro' : 'Registrar nueva urbanización';
        });
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                window.NassauApp?.showLoading(true);
                await window.NassauAPI.apiPost('/registro-urbanizacion', {
                    nombre: document.getElementById('reg-nombre').value,
                    direccion: document.getElementById('reg-direccion').value,
                    telefono: document.getElementById('reg-telefono').value,
                    email: document.getElementById('reg-email').value,
                    prefijo_doc: document.getElementById('reg-prefijo').value,
                    admin_nombre: document.getElementById('reg-admin-nombre').value,
                    admin_email: document.getElementById('reg-admin-email').value,
                    admin_password: document.getElementById('reg-admin-password').value
                });
                window.NassauApp?.showToast('Registro solicitado. El SUPERADMIN aprobará su urbanización y podrá iniciar sesión.', 'success');
                regForm.reset();
                regForm.style.display = 'none';
                regToggle.textContent = 'Registrar nueva urbanización';
            } catch (error) {
                window.NassauApp?.showToast(error.message, 'error');
            } finally {
                window.NassauApp?.showLoading(false);
            }
        });
    }
});