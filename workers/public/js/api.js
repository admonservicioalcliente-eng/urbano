window.API_BASE = 'https://nassau-api.policomputo.workers.dev/api';
window.NassauAPI = {
    async request(path, options = {}) {
        const token = localStorage.getItem('nassau_token');
        const headers = { ...(options.headers || {}) };
        if (options.body && typeof options.body === 'string') {
            headers['Content-Type'] = 'application/json';
        }
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const config = { ...options, headers };
        const response = await fetch(`${window.API_BASE}${path}`, config);
        const json = await response.json();
        if (response.status === 401) {
            const msg = json.message || json.error || '';
            if (msg.includes('Credenciales') || msg.includes('incorrecta')) {
                throw new Error(msg);
            }
            window.NassauAuth?.logout();
            throw new Error('Sesión expirada. Por favor, inicie sesión nuevamente.');
        }
        if (!response.ok) throw new Error(json.message || json.error || 'API Request Failed');
        return json.ok !== undefined ? json.data : json;
    },
    apiGet(path) { return this.request(path, { method: 'GET' }); },
    apiPost(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); },
    apiPut(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); },
    apiDelete(path) { return this.request(path, { method: 'DELETE' }); }
};