// Shared Admin Application Logic

const API_BASE = '/admin/api';

function checkAuth() {
  const token = localStorage.getItem('cb_token');
  if (!token && !window.location.pathname.includes('login.html')) {
    window.location.href = '/admin/login.html';
  }
  return token;
}

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('cb_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('cb_token');
    window.location.href = '/admin/login.html';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Error en la solicitud');
  }

  return data;
}

function initUserHeader() {
  const userStr = localStorage.getItem('cb_user');
  if (userStr) {
    const user = JSON.parse(userStr);
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');

    if (avatarEl) avatarEl.textContent = user.name ? user.name[0].toUpperCase() : 'U';
    if (nameEl) nameEl.textContent = user.name || user.email;
    if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Administrador' : 'Agente';
  }
}

function logout() {
  localStorage.removeItem('cb_token');
  localStorage.removeItem('cb_user');
  window.location.href = '/admin/login.html';
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.pathname.includes('login.html')) {
    checkAuth();
    initUserHeader();
  }
});
