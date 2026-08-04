const axios = require('axios');
const Setting = require('../models/Setting');
const KnowledgeItem = require('../models/KnowledgeItem');

class AIService {
  static async generateResponse(userMessage, conversationHistory = []) {
    const provider = (await Setting.get('AI_PROVIDER', 'none')).toLowerCase();
    const systemPrompt = await Setting.get(
      'AI_SYSTEM_PROMPT',
      'Eres un asistente virtual amable y profesional. Respondes preguntas sobre nuestros servicios.'
    );

    // Obtener contenido de la base de conocimiento para enriquecer el prompt
    const faqs = await KnowledgeItem.getAll({ activeOnly: true });
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
    }

    // Sin IA configurada -> Fallback
    return null;
  }

  static async callOpenAI(systemPrompt, userMessage, history = []) {
    const apiKey = await Setting.get('OPENAI_API_KEY');
    if (!apiKey) return null;

    try {
      const messages = [{ role: 'system', content: systemPrompt }];

      // Agregar últimos mensajes de contexto
      history.slice(-6).forEach((msg) => {
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
          }
        }
      );

      return response.data.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('❌ Error en OpenAI API:', error.response?.data || error.message);
      return null;
    }
  }

  static async callGemini(systemPrompt, userMessage, history = []) {
    const apiKey = await Setting.get('GEMINI_API_KEY');
    if (!apiKey) return null;

    try {
      const contents = [];

      // Historial
      history.slice(-6).forEach((msg) => {
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
        { headers: { 'Content-Type': 'application/json' } }
      );

      return response.data.candidates[0]?.content?.parts[0]?.text?.trim() || null;
    } catch (error) {
      console.error('❌ Error en Gemini API:', error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = AIService;
