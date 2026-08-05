const axios = require('axios');
const Setting = require('../models/Setting');
const KnowledgeItem = require('../models/KnowledgeItem');

class AIService {
  static async generateResponse(userMessage, conversationHistory = [], clientId = null) {
    const provider = (await Setting.get('AI_PROVIDER', 'none')).toLowerCase();
    if (!provider || provider === 'none') {
      return null;
    }

    const systemPrompt = await Setting.get(
      'AI_SYSTEM_PROMPT',
      'Eres un asistente virtual amable y profesional. Respondes preguntas sobre nuestros servicios.'
    );

    // Obtener contenido de la base de conocimiento (cliente + global) para enriquecer el prompt
    const faqs = await KnowledgeItem.getAll({ activeOnly: true, clientId });
    let contextText = '';
    if (faqs.length > 0) {
      contextText = '\n\nInformación oficial y preguntas frecuentes de la empresa:\n';
      faqs.forEach((faq) => {
        contextText += `- Pregunta: ${faq.question}\n  Respuesta: ${faq.answer}\n`;
      });
    }

    const fullSystemPrompt = `${systemPrompt}${contextText}\n\nResponde de manera concisa, clara y profesional en español. Si el usuario pide hablar con un agente o persona real, responde amablemente que lo conectarás con un agente humano.`;

    if (provider === 'openai') {
      return await AIService.callOpenAI(fullSystemPrompt, userMessage, conversationHistory);
    } else if (provider === 'gemini') {
      return await AIService.callGemini(fullSystemPrompt, userMessage, conversationHistory);
    } else if (provider === 'opencode') {
      return await AIService.callOpenCode(fullSystemPrompt, userMessage, conversationHistory);
    }

    // Sin IA configurada -> Fallback
    return null;
  }

  static async callOpenAI(systemPrompt, userMessage, history = []) {
    const apiKey = await Setting.get('OPENAI_API_KEY');
    if (!apiKey) return null;

    try {
      const messages = [{ role: 'system', content: systemPrompt }];

      // Agregar últimos mensajes de contexto. El historial ya incluye el
      // mensaje actual del usuario (se guarda antes de llamar a la IA),
      // así que evitamos duplicarlo al final.
      const lastCustomerMsg = [...history].reverse().find(m => m.sender_type === 'customer');
      const historyForPrompt = (lastCustomerMsg && lastCustomerMsg.text === userMessage)
        ? history.slice(0, -1).slice(-6)
        : history.slice(-6);

      historyForPrompt.forEach((msg) => {
        messages.push({
          role: msg.sender_type === 'customer' ? 'user' : 'assistant',
          content: msg.text || ''
        });
      });

      messages.push({ role: 'user', content: userMessage });

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages,
          temperature: 0.7,
          max_tokens: 350
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('❌ Error en OpenAI API:', error.response?.data || error.message);
      return null;
    }
  }

  // OpenCode Zen/Go: gateway OpenAI-compatible con modelos gratuitos
  // https://opencode.ai/zen  →  endpoint: https://opencode.ai/zen/v1/chat/completions
  static async callOpenCode(systemPrompt, userMessage, history = []) {
    const apiKey = await Setting.get('OPENCODE_API_KEY');
    if (!apiKey) return null;

    // Modelo configurable; por defecto el gratuito de DeepSeek V4 Flash.
    // El ID se usa SIN prefijo (ej: 'deepseek-v4-flash-free'), tal como lo
    // acepta la API de Zen.
    const model = (await Setting.get('OPENCODE_MODEL', 'deepseek-v4-flash-free')).toLowerCase();
    const modelId = model.startsWith('opencode/') ? model.replace('opencode/', '') : model;

    try {
      const messages = [{ role: 'system', content: systemPrompt }];

      const lastCustomerMsg = [...history].reverse().find(m => m.sender_type === 'customer');
      const historyForPrompt = (lastCustomerMsg && lastCustomerMsg.text === userMessage)
        ? history.slice(0, -1).slice(-6)
        : history.slice(-6);

      historyForPrompt.forEach((msg) => {
        messages.push({
          role: msg.sender_type === 'customer' ? 'user' : 'assistant',
          content: msg.text || ''
        });
      });

      messages.push({ role: 'user', content: userMessage });

      const response = await axios.post(
        'https://opencode.ai/zen/v1/chat/completions',
        {
          model: modelId,
          messages,
          temperature: 0.7,
          max_tokens: 350
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('❌ Error en OpenCode Zen API:', error.response?.data || error.message);
      return null;
    }
  }

  static async callGemini(systemPrompt, userMessage, history = []) {
    const apiKey = await Setting.get('GEMINI_API_KEY');
    if (!apiKey) return null;

    try {
      const contents = [];

      // Historial (evita duplicar el mensaje actual del usuario)
      const lastCustomerMsg = [...history].reverse().find(m => m.sender_type === 'customer');
      const historyForPrompt = (lastCustomerMsg && lastCustomerMsg.text === userMessage)
        ? history.slice(0, -1).slice(-6)
        : history.slice(-6);

      historyForPrompt.forEach((msg) => {
        contents.push({
          role: msg.sender_type === 'customer' ? 'user' : 'model',
          parts: [{ text: msg.text || '' }]
        });
      });

      contents.push({
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\nMensaje del usuario: ${userMessage}` }]
      });

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        { contents },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      return response.data.candidates[0]?.content?.parts[0]?.text?.trim() || null;
    } catch (error) {
      console.error('❌ Error en Gemini API:', error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = AIService;
