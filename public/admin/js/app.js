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

    if (avatarEl) {
      if (user.avatar) {
        avatarEl.innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="">`;
        avatarEl.style.background = 'transparent';
      } else {
        avatarEl.textContent = user.name ? user.name[0].toUpperCase() : 'U';
      }
    }
    if (nameEl) nameEl.textContent = user.name || user.email;
    if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Administrador' : 'Agente';
  }
}

// Abre el modal de perfil del agente (foto + nombre)
function openProfileModal() {
  const userStr = localStorage.getItem('cb_user');
  let user = null;
  try { user = userStr ? JSON.parse(userStr) : null; } catch (e) {}

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width: 420px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
        <h3 style="margin:0;">Mi Perfil de Agente</h3>
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div style="text-align:center;margin-bottom:15px;">
        <div class="user-avatar" id="profile-avatar-preview" style="width:72px;height:72px;font-size:2rem;margin:0 auto 10px;">
          ${user && user.avatar ? `<img src="${user.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="">` : (user ? user.name[0].toUpperCase() : 'U')}
        </div>
        <button class="btn btn-secondary" onclick="document.getElementById('profile-avatar-input').click()">📷 Cambiar foto</button>
        <input type="file" id="profile-avatar-input" accept="image/*" style="display:none;" onchange="uploadProfileAvatar(event)">
      </div>
      <div class="form-group">
        <label class="form-label">Nombre de agente</label>
        <input type="text" id="profile-name-input" class="form-control" value="${user ? (user.name || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input type="text" class="form-control" value="${user ? (user.email || '') : ''}" disabled>
      </div>
      <button class="btn btn-accent" style="width:100%;" onclick="saveProfile()">💾 Guardar Perfil</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function uploadProfileAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const token = localStorage.getItem('cb_token');
  const formData = new FormData();
  formData.append('avatar', file);
  try {
    const resp = await fetch('/admin/api/me/avatar', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    const preview = document.getElementById('profile-avatar-preview');
    if (preview) {
      preview.innerHTML = `<img src="${data.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="">`;
      preview.style.background = 'transparent';
    }
    localStorage.setItem('cb_user', JSON.stringify(data.user));
    initUserHeader();
  } catch (err) {
    alert('Error subiendo foto: ' + err.message);
  }
}

async function saveProfile() {
  const nameInput = document.getElementById('profile-name-input');
  if (!nameInput) return;
  try {
    const data = await apiFetch('/me', {
      method: 'PUT',
      body: JSON.stringify({ name: nameInput.value.trim() })
    });
    localStorage.setItem('cb_user', JSON.stringify(data.user));
    initUserHeader();
    document.querySelector('.modal-overlay')?.remove();
    alert('✅ Perfil guardado');
  } catch (err) {
    alert('Error guardando perfil: ' + err.message);
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
    initMobileMenu();
    initAdminSocket();
  }
});

// ── Socket.IO para admin (compartido en todas las páginas) ────────
function initAdminSocket() {
  if (typeof io === 'undefined') {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = () => connectAdminSocket();
    document.head.appendChild(script);
  } else {
    connectAdminSocket();
  }
}

function connectAdminSocket() {
  if (window._adminSocket) return;
  const socket = io({ transports: ['websocket'] });
  window._adminSocket = socket;
  window.socket = socket;

  socket.on('connect', () => {
    console.log('🔌 Admin socket conectado:', socket.id);
    initNotifications();
  });

  socket.on('disconnect', () => {
    console.log('🔌 Admin socket desconectado');
  });

  // Notificaciones globales para todas las páginas admin
  socket.on('admin_new_message', (data) => {
    if (data && data.message && data.message.sender_type === 'customer') {
      playNotificationSound();
      showDesktopNotification(data);
      incrementTitleBadge();
    }
  });

  // Alerta de bug o atención humana
  socket.on('admin_alert', (data) => {
    if (data) {
      playAlertSound();
      if (data.conversation_id) incrementTitleBadge();
    }
  });
}

// ── Sistema de notificaciones ──────────────────────────────────────
let _titleBadge = 0;
let _originalTitle = document.title;

function initNotifications() {
  _originalTitle = document.title;
  // Solicitar permiso para notificaciones de escritorio
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      Notification.requestPermission();
    }, 5000); // Esperar 5s para no molestar al cargar
  }
}

function incrementTitleBadge() {
  if (document.hidden) {
    _titleBadge++;
    document.title = `(${_titleBadge}) ${_originalTitle}`;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    _titleBadge = 0;
    document.title = _originalTitle;
  }
});

function showDesktopNotification(data) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // Solo si la pestaña está en segundo plano

  const name = data.contact?.name || 'Visitante';
  const text = (data.message?.text || '').substring(0, 100);
  try {
    new Notification('💬 Nuevo mensaje', {
      body: `${name}: ${text}`,
      icon: '/admin/favicon.ico',
      tag: 'chatbot-new-msg'
    });
  } catch (e) { /* ignorar */ }
}

// Sonido de notificación (tono suave)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* silencio */ }
}

// Sonido de alerta (más agudo, para bugs / atención humana)
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.start();
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) { /* silencio */ }
}

// ── Menú móvil con hamburguesa ────────────────────────────────────
function initMobileMenu() {
  // Ya existe?
  if (document.getElementById('mobile-menu-btn')) return;

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  // Botón hamburguesa
  const menuBtn = document.createElement('button');
  menuBtn.id = 'mobile-menu-btn';
  menuBtn.className = 'mobile-menu-btn';
  menuBtn.innerHTML = '☰';
  menuBtn.title = 'Menú';
  document.body.appendChild(menuBtn);

  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebar-overlay';
  document.body.appendChild(overlay);

  function openMenu() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    menuBtn.innerHTML = '✕';
  }

  function closeMenu() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    menuBtn.innerHTML = '☰';
  }

  menuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  overlay.addEventListener('click', closeMenu);

  // Cerrar al hacer clic en un link del menú
  sidebar.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      setTimeout(closeMenu, 150);
    });
  });
}
