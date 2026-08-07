window.API_BASE = window.WORKER_URL || '/api';
window.NassauAPI = {
    async request(path, options = {}) {
        const token = localStorage.getItem('nassau_token');
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const config = { ...options, headers };
        const response = await fetch(`${window.API_BASE}${path}`, config);
        if (response.status === 401) {
            window.NassauAuth?.logout();
            throw new Error('Sesión expirada. Por favor, inicie sesión nuevamente.');
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || 'API Request Failed');
        return data;
    },
    apiGet(path) { return this.request(path, { method: 'GET' }); },
    apiPost(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); },
    apiPut(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); },
    apiDelete(path) { return this.request(path, { method: 'DELETE' }); }
};