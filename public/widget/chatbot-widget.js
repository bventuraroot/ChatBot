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

  // Origen: dominio y página donde está incrustado el widget
  const pageUrl   = window.location.hostname || 'unknown';
  const pageTitle = document.title || '';
  const pageLoadTime = Date.now();

  // Settings del servidor (se cargan al iniciar)
  let serverSettings = {
    BUG_REPORT_MESSAGE: '🐛 Reporte de bug enviado. ¡Gracias! Un agente lo revisará pronto.'
  };

  fetch(`${serverUrl}/chat/settings`)
    .then(r => r.json())
    .then(data => {
      if (data) Object.assign(serverSettings, data);
    })
    .catch(() => {});

  // Captura de errores de la página host para reportes de bugs
  const pageErrors = [];
  const MAX_PAGE_ERRORS = 10;
  window.addEventListener('error', (e) => {
    if (pageErrors.length < MAX_PAGE_ERRORS) {
      pageErrors.push({
        message: e.message || 'Error desconocido',
        source: e.filename || pageUrl,
        line: e.lineno || '?',
        col: e.colno || '?',
        time: new Date().toISOString()
      });
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (pageErrors.length < MAX_PAGE_ERRORS) {
      pageErrors.push({
        message: 'Promise: ' + (e.reason?.message || String(e.reason)),
        source: pageUrl,
        line: '?',
        col: '?',
        time: new Date().toISOString()
      });
    }
  });

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
  link.href = `${serverUrl}/widget/chatbot-widget.css?v=4`;
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
          <div class="cb-mobile-handle"></div>
          <div>
            <div class="cb-header-title">💬 ${escapeHtml(widgetTitle)}</div>
            ${subtitleHtml}
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="cb-header-close" id="cb-bug-btn" title="Reportar bug">🐛</button>
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

    // Modal de reporte de bug (fuera del container del widget)
    const bugModal = document.createElement('div');
    bugModal.id = 'cb-bug-modal';
    bugModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;';
    bugModal.innerHTML = `
      <div id="cb-bug-dialog" style="background:#1e293b;color:#f8fafc;border-radius:16px;padding:24px;max-width:420px;width:90%;max-height:85vh;overflow-y:auto;border:1px solid #334155;">
        <h3 style="margin:0 0 8px;font-size:1.1rem;">🐛 Reportar Bug</h3>
        <p style="font-size:0.8rem;color:#94a3b8;margin:0 0 16px;">
          Describe el problema. Se enviará automáticamente la URL de la página y los errores detectados.
        </p>
        <div id="cb-bug-info" style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:14px;font-size:0.78rem;color:#94a3b8;max-height:150px;overflow-y:auto;"></div>
        <textarea id="cb-bug-description" placeholder="Describe qué pasó, qué esperabas y cómo reproducirlo..." style="width:100%;height:100px;background:#0f172a;color:white;border:1px solid #334155;border-radius:8px;padding:10px;font-size:0.85rem;resize:vertical;box-sizing:border-box;"></textarea>
        <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;">
          <button id="cb-bug-cancel" style="background:#334155;color:white;border:none;border-radius:8px;padding:10px 18px;font-size:0.85rem;cursor:pointer;">Cancelar</button>
          <button id="cb-bug-send" style="background:var(--cb-main-color,#10b981);color:white;border:none;border-radius:8px;padding:10px 18px;font-size:0.85rem;font-weight:600;cursor:pointer;">Enviar Reporte</button>
        </div>
      </div>
    `;
    document.body.appendChild(bugModal);

    // ── Heartbeat y visibilidad (para monitor de actividad) ─────────
    setInterval(() => {
      socket.emit('visitor_activity', {
        type: 'heartbeat',
        page_url: pageUrl,
        page_title: pageTitle,
        time_on_page: Math.floor((Date.now() - pageLoadTime) / 1000)
      });
    }, 30000);

    document.addEventListener('visibilitychange', () => {
      socket.emit('visitor_activity', {
        type: document.hidden ? 'page_blur' : 'page_focus',
        page_url: pageUrl,
        page_title: pageTitle
      });
    });

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
        client_id: clientId,
        page_url: pageUrl,
        page_title: pageTitle
      });

      // Actividad: visitante se conectó
      socket.emit('visitor_activity', {
        type: 'connected',
        page_url: pageUrl,
        page_title: pageTitle
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
        // Mostrar selector de tipo de solicitud
        showRequestTypeSelector();
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

    // ── Reporte de Bugs ────────────────────────────────────────────
    const bugHeaderBtn = document.getElementById('cb-bug-btn');
    const bugModalEl = document.getElementById('cb-bug-modal');
    const bugDesc = document.getElementById('cb-bug-description');
    const bugInfo = document.getElementById('cb-bug-info');
    const bugCancel = document.getElementById('cb-bug-cancel');
    const bugSend = document.getElementById('cb-bug-send');

    function openBugModal() {
      const infoLines = [
        `<strong>📍 URL:</strong> ${window.location.href}`,
        `<strong>📄 Página:</strong> ${pageTitle || 'Sin título'}`,
        `<strong>🕐 Hora:</strong> ${new Date().toLocaleString()}`,
        `<strong>👤 Usuario:</strong> ${userName || visitorId}`,
        `<strong>📏 Pantalla:</strong> ${window.innerWidth}x${window.innerHeight}`,
        `<strong>🌐 Navegador:</strong> ${navigator.userAgent.split(' ').slice(-1)[0] || navigator.userAgent.substring(0,60)}`
      ];

      if (pageErrors.length > 0) {
        infoLines.push('');
        infoLines.push('<strong>⚠️ Errores detectados en la página:</strong>');
        pageErrors.forEach((err, i) => {
          infoLines.push(`${i+1}. ${err.message} (${err.source}:${err.line})`);
        });
      }

      bugInfo.innerHTML = infoLines.join('<br>');
      bugDesc.value = '';
      bugModalEl.style.display = 'flex';
    }

    function closeBugModal() {
      bugModalEl.style.display = 'none';
    }

    bugHeaderBtn.addEventListener('click', openBugModal);
    bugCancel.addEventListener('click', closeBugModal);

    bugSend.addEventListener('click', () => {
      try {
        const description = bugDesc.value.trim();
        if (!description) {
          bugDesc.style.borderColor = '#ef4444';
          setTimeout(() => bugDesc.style.borderColor = '#334155', 2000);
          return;
        }

        const bugReport = [
          '🐛 *REPORTE DE BUG*',
          '',
          `📍 *URL:* ${window.location.href}`,
          `📄 *Página:* ${pageTitle || 'Sin título'}`,
          `📏 *Pantalla:* ${window.innerWidth}x${window.innerHeight}`,
          `🌐 *Navegador:* ${navigator.userAgent.substring(0, 80)}`,
          `📅 *Fecha:* ${new Date().toLocaleString()}`,
          '',
          `📝 *Descripción:* ${description}`,
        ];

        if (pageErrors.length > 0) {
          bugReport.push('');
          bugReport.push('⚠️ *Errores JS detectados:*');
          pageErrors.forEach((err, i) => {
            bugReport.push(`  ${i+1}. ${err.message}`);
            bugReport.push(`     → ${err.source}:${err.line}:${err.col}`);
          });
        }

        const bugText = bugReport.join('\n');

        // Enviar por WebSocket
        socket.emit('webchat_message', {
          visitor_id: visitorId,
          name: userName,
          email: userEmail,
          role: userRole,
          system: systemName,
          client_id: clientId,
          text: bugText,
          page_url: pageUrl,
          page_title: pageTitle,
          metadata: {
            type: 'bug_report',
            page_url: window.location.href,
            page_title: pageTitle,
            errors: pageErrors,
            user_agent: navigator.userAgent,
            screen_size: `${window.innerWidth}x${window.innerHeight}`
          }
        });

        // Mostrar confirmación en el chat
        appendMsg(serverSettings.BUG_REPORT_MESSAGE || '🐛 Reporte de bug enviado. ¡Gracias!', 'bot');

        // Actividad: bug reportado
        socket.emit('visitor_activity', {
          type: 'bug_reported',
          page_url: pageUrl,
          page_title: pageTitle,
          description_length: description.length
        });

        // Abrir el widget para que vea el historial
        openWidget();
      } catch (e) {
        console.error('Error al enviar reporte:', e);
      }

      // Siempre cerrar el modal
      closeBugModal();
    });

    bugModalEl.addEventListener('click', (e) => {
      if (e.target === bugModalEl) closeBugModal();
    });

    // ── UI Events ──────────────────────────────────────────────────
    const toggleBtn = document.getElementById('cb-widget-button');
    const closeBtn  = document.getElementById('cb-close-btn');
    const newSessionBtn = document.getElementById('cb-new-session-btn');
    const widgetBox = document.getElementById('cb-widget-box');

    function isMobile() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function lockBodyScroll() {
      if (isMobile()) {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
      }
    }

    function unlockBodyScroll() {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
    }

    toggleBtn.addEventListener('click', () => {
      const isOpen = widgetBox.classList.toggle('cb-open');
      if (isOpen) {
        lockBodyScroll();
        socket.emit('visitor_activity', { type: 'chat_opened', page_url: pageUrl, page_title: pageTitle });
      } else {
        unlockBodyScroll();
      }
      scrollChat();
    });
    closeBtn.addEventListener('click', () => {
      widgetBox.classList.remove('cb-open');
      unlockBodyScroll();
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
            media_url: data.url.startsWith('/') ? serverUrl + data.url : data.url,
            media_type: 'image',
            page_url: pageUrl,
            page_title: pageTitle
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

      socket.emit('visitor_activity', {
        type: 'message_sent',
        page_url: pageUrl,
        page_title: pageTitle,
        text_length: text.length
      });

      socket.emit('webchat_message', {
        visitor_id: visitorId,
        name:   userName,
        email:  userEmail,
        role:   userRole,
        system: systemName,
        client_id: clientId,
        text,
        page_url: pageUrl,
        page_title: pageTitle
      });

      // Si estaba cerrada, limpiar aviso al enviar nuevo mensaje
      if (isClosed) {
        isClosed = false;
        markOpen();
      }
    }

    // ── Selector de tipo de solicitud ──────────────────────────────
    function showRequestTypeSelector() {
      const box = document.getElementById('cb-messages-box');
      const div = document.createElement('div');
      div.className = 'cb-type-selector';
      div.innerHTML = `
        <div class="cb-type-title">¿En qué podemos ayudarte?</div>
        <div class="cb-type-options">
          <button class="cb-type-btn cb-type-support" id="cb-type-support">
            <span class="cb-type-icon">💬</span>
            <span class="cb-type-label">Consulta / Soporte</span>
            <span class="cb-type-desc">Hacer una pregunta o solicitar ayuda</span>
          </button>
          <button class="cb-type-btn cb-type-bug" id="cb-type-bug">
            <span class="cb-type-icon">🐛</span>
            <span class="cb-type-label">Reportar un Bug</span>
            <span class="cb-type-desc">Informar un error o problema técnico</span>
          </button>
        </div>
      `;
      box.appendChild(div);
      scrollChat();

      document.getElementById('cb-type-support').addEventListener('click', () => {
        div.remove();
        const namePart = userName ? ' <strong>' + escapeHtml(userName) + '</strong>' : '';
        appendMsg(`¡Hola${namePart}! 👋 ¿En qué podemos ayudarte?`, 'bot');
        document.getElementById('cb-input-field').focus();
        socket.emit('visitor_activity', { type: 'type_selected', choice: 'support', page_url: pageUrl, page_title: pageTitle });
      });

      document.getElementById('cb-type-bug').addEventListener('click', () => {
        div.remove();
        openBugModal();
        socket.emit('visitor_activity', { type: 'type_selected', choice: 'bug', page_url: pageUrl, page_title: pageTitle });
      });
    }

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

      // Limpiar mensajes mostrados y mostrar selector
      const box = document.getElementById('cb-messages-box');
      box.innerHTML = '';
      showRequestTypeSelector();

      // Re-registrar el visitante en el servidor con el nuevo id
      socket.emit('join_webchat', {
        visitor_id: visitorId,
        name:   userName,
        email:  userEmail,
        role:   userRole,
        system: systemName,
        client_id: clientId,
        page_url: pageUrl,
        page_title: pageTitle
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function appendMsg(text, senderType, timestamp, extra) {
    const box = document.getElementById('cb-messages-box');
    if (!box) return;
    const div = document.createElement('div');
    const type = senderType === 'customer' ? 'customer' : (senderType === 'agent' ? 'agent' : 'bot');
    div.className = `cb-msg cb-msg-${type}`;

    // Avatar y nombre del agente (si el mensaje lo incluye)
    if (extra && extra.agent_avatar && senderType !== 'customer') {
      // Fila de avatar + nombre
      const avatarRow = document.createElement('div');
      avatarRow.className = 'cb-msg-sender-row';

      const avatar = document.createElement('img');
      avatar.className = 'cb-msg-avatar';
      avatar.src = extra.agent_avatar;
      avatar.alt = '';
      avatar.onerror = function () { this.style.display = 'none'; };
      avatarRow.appendChild(avatar);

      const nameLabel = document.createElement('span');
      nameLabel.className = 'cb-msg-sender-name';
      nameLabel.textContent = senderType === 'agent' ? (extra.agent_name || 'Agente') : 'Bot IA';
      avatarRow.appendChild(nameLabel);

      div.appendChild(avatarRow);
      const bubble = document.createElement('div');
      bubble.className = 'cb-msg-bubble-inner';
      // Contenido: imagen o texto
      if (extra.media_url && extra.media_type === 'image') {
        const img = document.createElement('img');
        img.className = 'cb-msg-image';
        img.src = (extra.media_url || '').startsWith('/') ? serverUrl + extra.media_url : extra.media_url;
        img.alt = 'Captura';
        img.onclick = function () { window.open(img.src, '_blank'); };
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
        img.src = (extra.media_url || '').startsWith('/') ? serverUrl + extra.media_url : extra.media_url;
        img.alt = 'Captura';
        img.onclick = function () { window.open(img.src, '_blank'); };
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
      if (isMobile()) lockBodyScroll();
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
