const axios = require('axios');
const { dbAsync } = require('../../database/database');
const AIService = require('./aiService');

class DynamicResponseEngine {

  static async findResponse(text, clientId = null, contact = null, history = []) {
    const normalizedText = text.toLowerCase().trim();

    // 1. Buscar en la base de conocimiento (FAQs del cliente + globales)
    const faqMatch = await DynamicResponseEngine.searchKnowledgeBase(normalizedText, clientId);
    if (faqMatch) {
      return {
        source: 'knowledge_base',
        answer: DynamicResponseEngine.renderTemplate(faqMatch.answer, contact),
        matchedItem: faqMatch
      };
    }

    // 2. Llamar a la API externa / BD del cliente (si está configurada).
    //    Si devuelve una respuesta directa se usa tal cual; si devuelve
    //    datos (context), se pasan a la IA para que responda con info real.
    let externalContext = null;
    if (clientId) {
      const apiResult = await DynamicResponseEngine.callExternalAPI(
        clientId, text, contact, history
      );
      if (apiResult) {
        // Si la API devolvió un texto de respuesta listo (reply/message),
        // lo usamos directamente. Si devolvió datos en 'data', lo pasamos
        // como contexto para que la IA redacte la respuesta.
        if (apiResult.reply || apiResult.message) {
          return {
            source: 'external_api',
            answer: DynamicResponseEngine.renderTemplate(apiResult.reply || apiResult.message, contact)
          };
        }
        if (apiResult.data || apiResult.context) {
          const raw = apiResult.data || apiResult.context;
          externalContext = typeof raw === 'string'
            ? raw
            : JSON.stringify(raw, null, 2).slice(0, 4000);
        }
      }
    }

    // 3. IA (OpenAI / Gemini / OpenCode Zen si está configurado)
    if (process.env.DEBUG_LOGS === 'true') {
      console.log(`🤖 Buscando respuesta IA para: "${text}"`);
    }
    const aiResult = await AIService.generateResponse(text, history, clientId, externalContext);
    if (aiResult && aiResult.answer) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🤖 IA respondió (source=ai): "${aiResult.answer.slice(0, 80)}" wantsHuman=${!!aiResult.wantsHuman}`);
      }
      return {
        source: 'ai',
        answer: DynamicResponseEngine.renderTemplate(aiResult.answer, contact),
        wantsHuman: !!aiResult.wantsHuman
      };
    }
    if (process.env.DEBUG_LOGS === 'true') {
      console.log('🤖 IA no devolvió respuesta (null)');
    }

    return null; // Sin respuesta encontrada
  }

  // Búsqueda mejorada en la base de conocimiento
  static async searchKnowledgeBase(text, clientId = null) {
    // Obtener FAQs del cliente Y globales (client_id IS NULL), ordenados por prioridad
    let sql, params;
    if (clientId) {
      sql = `SELECT * FROM knowledge_items
             WHERE is_active = 1 AND (client_id = ? OR client_id IS NULL)
             ORDER BY priority DESC, id ASC`;
      params = [clientId];
    } else {
      sql = `SELECT * FROM knowledge_items
             WHERE is_active = 1 AND client_id IS NULL
             ORDER BY priority DESC, id ASC`;
      params = [];
    }

    const allFaqs = await dbAsync.all(sql, params);

    // Buscar coincidencia por cada tipo de match
    for (const faq of allFaqs) {
      const matchType = faq.match_type || 'keyword';

      if (matchType === 'exact') {
        if (text === faq.question.toLowerCase().trim()) {
          return faq;
        }
      } else if (matchType === 'regex') {
        try {
          const pattern = new RegExp(faq.keywords || faq.question, 'i');
          if (pattern.test(text)) {
            return faq;
          }
        } catch (e) {
          // Regex inválido, ignorar
        }
      } else if (matchType === 'any') {
        // Coincidencia por CUALQUIERA de las keywords (OR)
        const keywords = (faq.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        for (const kw of keywords) {
          if (kw && text.includes(kw)) {
            return faq;
          }
        }
      } else {
        // keyword (default): coincide si el texto contiene ALGUNA keyword
        // o la pregunta completa
        const keywords = (faq.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        for (const kw of keywords) {
          if (kw && text.includes(kw)) {
            return faq;
          }
        }
        // También revisar si el texto contiene la pregunta
        if (faq.question && text.includes(faq.question.toLowerCase())) {
          return faq;
        }
      }
    }

    return null;
  }

  // Llamar a la API externa configurada para el cliente
  static async callExternalAPI(clientId, userMessage, contact = null, history = []) {
    const client = await dbAsync.get('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (!client || !client.external_api_url) return null;

    try {
      const payload = {
        message: userMessage,
        contact: contact ? {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email
        } : null,
        conversation_history: history.slice(-6).map(m => ({
          role: m.sender_type,
          text: m.text
        })),
        timestamp: new Date().toISOString()
      };

      const headers = {
        'Content-Type': 'application/json'
      };

      if (client.external_api_key) {
        headers['Authorization'] = `Bearer ${client.external_api_key}`;
        headers['X-API-Key'] = client.external_api_key;
      }

      const response = await axios.post(client.external_api_url, payload, {
        headers,
        timeout: client.external_api_timeout || 5000
      });

      // El endpoint externo puede responder de varias formas:
      // 1) { "reply": "texto" } o { "message": "texto" } → respuesta lista
      // 2) { "data": {...} } o { "context": "..." } → datos para que la IA responda
      // 3) un string → respuesta lista
      const body = response.data;
      if (typeof body === 'string') {
        return { reply: body };
      }
      if (body) {
        if (body.reply || body.message) {
          return { reply: body.reply || body.message };
        }
        if (body.data || body.context) {
          return { data: body.data || body.context };
        }
      }

      return null;
    } catch (error) {
      console.error(`❌ Error llamando API externa del cliente ${clientId}:`, error.message);
      return null;
    }
  }

  // Renderizar plantillas con variables: {contact_name}, {client_name}, {date}, etc.
  static renderTemplate(template, contact = null) {
    if (!template) return '';
    let result = template;
    const now = new Date();

    if (contact) {
      result = result.replace(/\{contact_name\}/gi, contact.name || 'Cliente');
      result = result.replace(/\{contact_phone\}/gi, contact.phone || '');
      result = result.replace(/\{contact_email\}/gi, contact.email || '');
    }
    result = result.replace(/\{date\}/gi, now.toLocaleDateString('es'));
    result = result.replace(/\{time\}/gi, now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
    result = result.replace(/\{day\}/gi, ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][now.getDay()]);

    return result;
  }
}

module.exports = DynamicResponseEngine;
