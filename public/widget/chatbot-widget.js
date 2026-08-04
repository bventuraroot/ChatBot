(function () {
  const scriptTag = document.currentScript;
  const serverUrl  = scriptTag.getAttribute('data-server') || window.location.origin;
  const widgetTitle = scriptTag.getAttribute('data-title') || 'Atención al Cliente';
  const mainColor   = scriptTag.getAttribute('data-color') || '#10b981';

  // Datos del usuario autenticado
  const userName   = scriptTag.getAttribute('data-user-name')  || null;
  const userEmail  = scriptTag.getAttribute('data-user-email') || null;
  const userRole   = scriptTag.getAttribute('data-user-role')  || null;
  const systemName = scriptTag.getAttribute('data-system')     || null;

  // Visitor ID estable: email-based si está autenticado, localStorage si es anónimo
  let visitorId = userEmail
    ? 'user_' + userEmail.replace(/[^a-zA-Z0-9]/g, '_')
    : localStorage.getItem('cb_visitor_id');
  if (!visitorId) {
    visitorId = 'web_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('cb_visitor_id', visitorId);
  }

  // Cargar CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${serverUrl}/widget/chatbot-widget.css`;
  document.head.appendChild(link);

  // Cargar Socket.IO
  if (typeof io === 'undefined') {
    const s = document.createElement('script');
    s.src = `${serverUrl}/socket.io/socket.io.js`;
    s.onload = initWidget;
    document.head.appendChild(s);
  } else {
    initWidget();
  }

  function initWidget() {
    // Subtítulo en header del widget
    let subtitleHtml = '';
    if (userName && systemName) {
      subtitleHtml = `<div class="cb-header-subtitle">${escapeHtml(userName)} &bull; ${escapeHtml(systemName)}</div>`;
    } else if (systemName) {
      subtitleHtml = `<div class="cb-header-subtitle">${escapeHtml(systemName)}</div>`;
    }

    const container = document.createElement('div');
    container.id = 'cb-widget-container';
    container.style.setProperty('--cb-main-color', mainColor);

    container.innerHTML = `
      <div id="cb-widget-box">
        <div class="cb-header">
          <div>
            <div class="cb-header-title">💬 ${escapeHtml(widgetTitle)}</div>
            ${subtitleHtml}
          </div>
          <button class="cb-header-close" id="cb-close-btn" title="Minimizar">✕</button>
        </div>
        <div class="cb-messages" id="cb-messages-box"></div>
        <div id="cb-status-bar" class="cb-status-bar" style="display:none"></div>
        <div class="cb-input-area" id="cb-input-area">
          <input type="text" class="cb-input" id="cb-input-field" placeholder="Escribe un mensaje...">
          <button class="cb-send-btn" id="cb-send-btn" title="Enviar">➔</button>
        </div>
      </div>
      <button id="cb-widget-button" title="Abrir chat de soporte">💬</button>
    `;

    document.body.appendChild(container);

    // ── Socket.IO ──────────────────────────────────────────────────
    const socket = io(serverUrl);
    let isClosed = false;

    socket.on('connect', () => {
      socket.emit('join_webchat', {
        visitor_id: visitorId,
        name:   userName,
        email:  userEmail,
        role:   userRole,
        system: systemName
      });
    });

    // Historial de mensajes previos
    socket.on('conversation_history', (data) => {
      const box = document.getElementById('cb-messages-box');
      box.innerHTML = '';

      if (!data.messages || data.messages.length === 0) {
        // Primera vez: mensaje de bienvenida
        appendMsg(`¡Hola${userName ? ', <strong>' + escapeHtml(userName) + '</strong>' : ''}! 👋 ¿En qué podemos ayudarte?`, 'bot');
        return;
      }

      // Mostrar historial con separador visual
      appendSystemMsg('— Historial de conversación —');
      data.messages.forEach(msg => {
        appendMsg(msg.text || '', msg.sender_type, msg.created_at);
      });

      // Si la conversación estaba cerrada, mostrar aviso
      if (data.status === 'closed') {
        markClosed('La conversación anterior está cerrada. Escribe para reabrir.');
      }
    });

    // Nuevo mensaje del bot/agente llegando
    socket.on('new_message', (data) => {
      if (data.message.sender_type !== 'customer') {
        appendMsg(data.message.text, data.message.sender_type);
        openWidget();
      }
    });

    // El agente cerró la conversación
    socket.on('conversation_closed', (data) => {
      isClosed = true;
      markClosed('Conversación finalizada por el agente. Escribe para volver a contactarnos.');
    });

    // El agente reabrió la conversación
    socket.on('conversation_reopened', () => {
      isClosed = false;
      markOpen();
    });

    // ── UI Events ──────────────────────────────────────────────────
    const toggleBtn = document.getElementById('cb-widget-button');
    const closeBtn  = document.getElementById('cb-close-btn');

    toggleBtn.addEventListener('click', () => {
      document.getElementById('cb-widget-box').classList.toggle('cb-open');
      scrollChat();
    });
    closeBtn.addEventListener('click', () => {
      document.getElementById('cb-widget-box').classList.remove('cb-open');
    });

    document.getElementById('cb-send-btn').addEventListener('click', sendMessage);
    document.getElementById('cb-input-field').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    function sendMessage() {
      const input = document.getElementById('cb-input-field');
      const text = input.value.trim();
      if (!text) return;

      appendMsg(text, 'customer');
      input.value = '';

      socket.emit('webchat_message', {
        visitor_id: visitorId,
        name:   userName,
        email:  userEmail,
        role:   userRole,
        system: systemName,
        text
      });

      // Si estaba cerrada, limpiar aviso al enviar nuevo mensaje
      if (isClosed) {
        isClosed = false;
        markOpen();
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function appendMsg(text, senderType, timestamp) {
    const box = document.getElementById('cb-messages-box');
    if (!box) return;
    const div = document.createElement('div');
    const type = senderType === 'customer' ? 'customer' : 'bot';
    div.className = `cb-msg cb-msg-${type}`;
    div.innerHTML = text;
    if (timestamp) {
      const ts = document.createElement('div');
      ts.className = 'cb-msg-time';
      ts.textContent = formatTime(timestamp);
      div.appendChild(ts);
    }
    box.appendChild(div);
    scrollChat();
  }

  function appendSystemMsg(text) {
    const box = document.getElementById('cb-messages-box');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'cb-msg cb-msg-system';
    div.textContent = text;
    box.appendChild(div);
    scrollChat();
  }

  function markClosed(msg) {
    const bar = document.getElementById('cb-status-bar');
    if (bar) { bar.textContent = msg; bar.style.display = 'block'; }
  }

  function markOpen() {
    const bar = document.getElementById('cb-status-bar');
    if (bar) { bar.style.display = 'none'; }
  }

  function openWidget() {
    const box = document.getElementById('cb-widget-box');
    if (box && !box.classList.contains('cb-open')) {
      box.classList.add('cb-open');
      scrollChat();
    }
  }

  function scrollChat() {
    const box = document.getElementById('cb-messages-box');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts.replace(' ', 'T') + 'Z');
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }
})();
