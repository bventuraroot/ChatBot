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
  const clientId   = scriptTag.getAttribute('data-client-id')  || null;

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
          <div style="display: flex; gap: 6px;">
            <button class="cb-header-close" id="cb-new-session-btn" title="Iniciar nueva conversación">↺</button>
            <button class="cb-header-close" id="cb-close-btn" title="Minimizar">✕</button>
          </div>
        </div>
        <div class="cb-messages" id="cb-messages-box"></div>
        <div id="cb-status-bar" class="cb-status-bar" style="display:none"></div>
        <div class="cb-input-area" id="cb-input-area">
          <input type="file" id="cb-file-input" accept="image/*" style="display:none;">
          <button class="cb-attach-btn" id="cb-attach-btn" title="Adjuntar imagen (Ctrl+V)">📎</button>
          <input type="text" class="cb-input" id="cb-input-field" placeholder="Escribe un mensaje... o pega una imagen">
          <button class="cb-send-btn" id="cb-send-btn" title="Enviar">➔</button>
        </div>
      </div>
      <button id="cb-widget-button" title="Abrir chat de soporte">💬</button>
    `;

    document.body.appendChild(container);

    // ── Socket.IO ──────────────────────────────────────────────────
    const socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 15000
    });
    let isClosed = false;
    let myConversationId = null;

    socket.on('connect', () => {
      socket.emit('join_webchat', {
        visitor_id: visitorId,
        name:   userName,
        email:  userEmail,
        role:   userRole,
        system: systemName,
        client_id: clientId
      });
    });

    // Historial de mensajes previos
    socket.on('conversation_history', (data) => {
      const box = document.getElementById('cb-messages-box');
      box.innerHTML = '';

      // Guardar el id de la conversación de ESTE visitante para filtrar
      // los mensajes nuevos y no mezclar conversaciones de otros clientes.
      myConversationId = data.conversation_id || null;

      if (!data.messages || data.messages.length === 0) {
        // Primera vez: mensaje de bienvenida
        const namePart = userName ? ' <strong>' + escapeHtml(userName) + '</strong>' : '';
        appendMsg(`¡Hola${namePart}! 👋 ¿En qué podemos ayudarte?`, 'bot');
        return;
      }

      // Mostrar historial con separador visual
      appendSystemMsg('— Historial de conversación —');
      data.messages.forEach(msg => {
        appendMsg(msg.text || '', msg.sender_type, msg.created_at, msg);
      });

      // Si la conversación estaba cerrada, mostrar aviso
      if (data.status === 'closed') {
        markClosed('La conversación anterior está cerrada. Escribe para reabrir.');
      }
    });

    // El servidor confirma cuál es la conversación de ESTE visitante
    socket.on('my_conversation', (data) => {
      if (data && data.conversation_id) {
        myConversationId = data.conversation_id;
      }
    });

    // Nuevo mensaje del bot/agente llegando
    // IMPORTANTE: solo se muestra si pertenece a la conversación de ESTE
    // visitante. Evita mezclar chats entre distintos usuarios.
    socket.on('new_message', (data) => {
      if (!data || !data.message || data.message.sender_type === 'customer') return;
      if (myConversationId && data.conversation_id !== myConversationId) return;
      appendMsg(data.message.text, data.message.sender_type, data.message.created_at, data.message);
      openWidget();
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
    const newSessionBtn = document.getElementById('cb-new-session-btn');

    toggleBtn.addEventListener('click', () => {
      document.getElementById('cb-widget-box').classList.toggle('cb-open');
      scrollChat();
    });
    closeBtn.addEventListener('click', () => {
      document.getElementById('cb-widget-box').classList.remove('cb-open');
    });

    // Iniciar una NUEVA conversación: limpia la sesión local, genera un
    // nuevo visitor_id y recarga el widget como un visitante nuevo.
    newSessionBtn.addEventListener('click', () => {
      if (!confirm('¿Iniciar una nueva conversación? Se borrará el historial de esta sesión.')) return;
      startNewSession();
    });

    document.getElementById('cb-send-btn').addEventListener('click', sendMessage);
    document.getElementById('cb-input-field').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    // Adjuntar imagen: botón 📎 o pegar (Ctrl+V)
    document.getElementById('cb-attach-btn').addEventListener('click', () => {
      document.getElementById('cb-file-input').click();
    });
    document.getElementById('cb-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) sendImage(file);
    });
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) sendImage(file);
          return;
        }
      }
    });

    // Sube la imagen y la envía como mensaje del cliente
    function sendImage(file) {
      const formData = new FormData();
      formData.append('file', file);

      // Mostrar la imagen al instante en el chat del cliente
      const reader = new FileReader();
      reader.onload = (ev) => {
        const box = document.getElementById('cb-messages-box');
        const div = document.createElement('div');
        div.className = 'cb-msg cb-msg-customer';
        const img = document.createElement('img');
        img.className = 'cb-msg-image';
        img.src = ev.target.result;
        div.appendChild(img);
        box.appendChild(div);
        scrollChat();
      };
      reader.readAsDataURL(file);

      fetch(`${serverUrl}/chat/upload`, {
        method: 'POST',
        body: formData
      })
        .then(r => r.json())
        .then(data => {
          if (!data.url) throw new Error(data.error || 'Error al subir');
          socket.emit('webchat_message', {
            visitor_id: visitorId,
            name: userName,
            email: userEmail,
            role: userRole,
            system: systemName,
            client_id: clientId,
            text: '',
            media_url: data.url,
            media_type: 'image'
          });
        })
        .catch(err => {
          console.error('Error subiendo imagen:', err);
          appendMsg('⚠️ No se pudo enviar la imagen. Intenta de nuevo.', 'bot');
        });
    }

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
        client_id: clientId,
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

  // Cierra la sesión local y arranca una conversación nueva como visitante nuevo.
  function startNewSession() {
    // Borrar datos de sesión local del widget
    localStorage.removeItem('cb_visitor_id');
    localStorage.removeItem('cb_user');

    // Nuevo visitor_id anónimo
    visitorId = 'web_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('cb_visitor_id', visitorId);

    // Reiniciar estado del widget
    myConversationId = null;
    isClosed = false;
    markOpen();

    // Limpiar mensajes mostrados y mostrar bienvenida
    const box = document.getElementById('cb-messages-box');
    box.innerHTML = '';
    const namePart = userName ? ' <strong>' + escapeHtml(userName) + '</strong>' : '';
    appendMsg(`¡Hola${namePart}! 👋 ¿En qué podemos ayudarte?`, 'bot');

    // Re-registrar el visitante en el servidor con el nuevo id
    socket.emit('join_webchat', {
      visitor_id: visitorId,
      name:   userName,
      email:  userEmail,
      role:   userRole,
      system: systemName,
      client_id: clientId
    });
  }

  function appendMsg(text, senderType, timestamp, extra) {
    const box = document.getElementById('cb-messages-box');
    if (!box) return;
    const div = document.createElement('div');
    const type = senderType === 'customer' ? 'customer' : 'bot';
    div.className = `cb-msg cb-msg-${type}`;

    // Avatar del agente (si el mensaje lo incluye)
    if (extra && extra.agent_avatar && senderType !== 'customer') {
      const avatar = document.createElement('img');
      avatar.className = 'cb-msg-avatar';
      avatar.src = extra.agent_avatar;
      avatar.alt = 'Agente';
      avatar.onerror = function () { this.style.display = 'none'; };
      div.appendChild(avatar);
      const bubble = document.createElement('div');
      bubble.className = 'cb-msg-bubble-inner';
      // Contenido: imagen o texto
      if (extra.media_url && extra.media_type === 'image') {
        const img = document.createElement('img');
        img.className = 'cb-msg-image';
        img.src = extra.media_url;
        img.alt = 'Captura';
        img.onclick = function () { window.open(extra.media_url, '_blank'); };
        bubble.appendChild(img);
      }
      if (text) {
        const p = document.createElement('div');
        p.textContent = text;
        bubble.appendChild(p);
      }
      if (timestamp) {
        const ts = document.createElement('div');
        ts.className = 'cb-msg-time';
        ts.textContent = formatTime(timestamp);
        bubble.appendChild(ts);
      }
      div.appendChild(bubble);
    } else {
      // Mensaje normal (texto y/o imagen)
      if (extra && extra.media_url && extra.media_type === 'image') {
        const img = document.createElement('img');
        img.className = 'cb-msg-image';
        img.src = extra.media_url;
        img.alt = 'Captura';
        img.onclick = function () { window.open(extra.media_url, '_blank'); };
        div.appendChild(img);
      }
      if (text) {
        const p = document.createElement('div');
        p.textContent = text;
        div.appendChild(p);
      }
      if (timestamp) {
        const ts = document.createElement('div');
        ts.className = 'cb-msg-time';
        ts.textContent = formatTime(timestamp);
        div.appendChild(ts);
      }
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
