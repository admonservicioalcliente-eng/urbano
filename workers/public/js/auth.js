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
        try {
            const urbs = await window.NassauAPI.apiGet('/urbanizaciones');
            const select = document.getElementById('login-urb');
            if(select) select.innerHTML = urbs.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
        } catch (e) { console.error('Failed to load urbanizaciones', e); }
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
    },
    isLoggedIn() {
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
});