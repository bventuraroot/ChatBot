const axios = require('axios');
const Setting = require('../models/Setting');
const KnowledgeItem = require('../models/KnowledgeItem');

class AIService {
  static async generateResponse(userMessage, conversationHistory = [], clientId = null, externalContext = null) {
    const provider = (await Setting.get('AI_PROVIDER', 'none')).toLowerCase();
    if (!provider || provider === 'none') {
      return null;
    }

    const systemPrompt = await Setting.get(
      'AI_SYSTEM_PROMPT',
      'Eres un asistente virtual amable y profesional. Respondes preguntas sobre nuestros servicios.'
    );

    // Límite de tokens configurable (respuestas más amplias o más cortas)
    const maxTokens = parseInt(await Setting.get('AI_MAX_TOKENS', '500'), 10) || 500;

    // Obtener contenido de la base de conocimiento (cliente + global) para enriquecer el prompt
    const faqs = await KnowledgeItem.getAll({ activeOnly: true, clientId });
    let contextText = '';
    if (faqs.length > 0) {
      contextText = '\n\nInformación oficial y preguntas frecuentes de la empresa:\n';
      faqs.forEach((faq) => {
        contextText += `- Pregunta: ${faq.question}\n  Respuesta: ${faq.answer}\n`;
      });
    }

    // Datos obtenidos de la API externa / BD del cliente (si los hay)
    // para que la IA responda con información REAL y actualizada.
    let externalText = '';
    if (externalContext) {
      externalText = `\n\nDatos actuales del sistema del cliente obtenidos en tiempo real (usa estos datos para responder con precisión):\n${externalContext}\n`;
    }

    const fullSystemPrompt = `${systemPrompt}${contextText}${externalText}\n\nResponde de manera concisa, clara, amable y profesional en español. Eres un asistente virtual que puede manejar tanto preguntas de negocio como conversación casual. No digas que eres una IA ni menciones tus limitaciones — simplemente responde lo mejor que puedas.\n\n--- REGLAS PARA ESCALAR A UN HUMANO ---\n\nNO escales de inmediato cuando el usuario pida un agente. Primero RECABA información clave (1-2 preguntas) para entender bien su caso. Ejemplos de preguntas útiles: "¿Podrías darme más detalles sobre lo que necesitas?", "¿Tienes algún número de pedido, factura o referencia?", "¿Desde cuándo tienes este problema?".\n\nDEBES escalar con [HUMANO] en estos casos:\n1. El usuario pide explícitamente un agente Y ya tienes suficiente contexto sobre su caso.\n2. La consulta requiere acciones que tú no puedes hacer (reembolsos, cancelaciones, cambios en cuenta, verificación de pagos, datos personales sensibles).\n3. El usuario está claramente frustrado o insatisfecho después de que intentaste ayudarlo.\n4. La pregunta está fuera del alcance de la información oficial (FAQ) que tienes disponible.\n\nCUANDO escales, DEBES incluir un bloque [RESUMEN]...[/RESUMEN] con:\n- Asunto: qué necesita el usuario en una frase\n- Contexto: datos clave que recabaste (nombre, pedido, monto, fechas, etc.)\n- Motivo: por qué necesita atención humana\n\nEjemplo de respuesta con escalado:\n[HUMANO]\n[RESUMEN]\nAsunto: Cliente no recibió su pedido #4521\nContexto: Pedido hecho el 3 de agosto, pagó $1,200 por transferencia, ya revisó el portal y aparece como "en proceso"\nMotivo: Requiere verificar el estado real en el sistema de logística\n[/RESUMEN]\nEntendido, ya le pasé tu caso a nuestro equipo con todos los detalles de tu pedido #4521. Te van a contactar pronto para darte una solución.`;

    const aiText = await (async () => {
      if (provider === 'openai') {
        return await AIService.callOpenAI(fullSystemPrompt, userMessage, conversationHistory, maxTokens);
      } else if (provider === 'gemini') {
        return await AIService.callGemini(fullSystemPrompt, userMessage, conversationHistory, maxTokens);
      } else if (provider === 'opencode') {
        return await AIService.callOpenCode(fullSystemPrompt, userMessage, conversationHistory, maxTokens);
      } else if (provider === 'custom') {
        return await AIService.callCustom(fullSystemPrompt, userMessage, conversationHistory, maxTokens);
      }
      return null;
    })();

    if (!aiText) return null;

    const wantsHuman = /^\s*\[HUMANO\]/i.test(aiText);

    let summary = null;
    let cleanAnswer = aiText;

    if (wantsHuman) {
      const resumenMatch = aiText.match(/\[RESUMEN\]\s*([\s\S]*?)\s*\[\/RESUMEN\]/i);
      if (resumenMatch) {
        summary = resumenMatch[1].trim();
        cleanAnswer = aiText.replace(/\[RESUMEN\]\s*[\s\S]*?\s*\[\/RESUMEN\]\s*/i, '');
      }
    }

    cleanAnswer = cleanAnswer.replace(/^\s*\[HUMANO\]\s*/i, '').trim();

    return {
      answer: cleanAnswer,
      wantsHuman,
      summary
    };
  }

  // Método genérico para cualquier API compatible con OpenAI (OpenRouter,
  // Groq, DeepSeek, Azure, Ollama, LM Studio, etc.). Reutilizado por
  // openai, opencode y custom.
  static async callOpenAICompatible({ apiUrl, apiKey, model, systemPrompt, userMessage, history = [], label = 'IA', maxTokens = 350 }) {
    if (!apiUrl || !apiKey || !model) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`⚠️ ${label}: faltan apiUrl, apiKey o model`);
      }
      return null;
    }

    try {
      const messages = [{ role: 'system', content: systemPrompt }];

      // Agregar últimos mensajes de contexto. El historial ya incluye el
      // mensaje actual del usuario, así que evitamos duplicarlo al final.
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
        apiUrl,
        {
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const msg = response.data.choices[0]?.message || {};
      // Solo usamos `content`. Los campos `reasoning`/`reasoning_content`
      // son el pensamiento interno del modelo, NO la respuesta al cliente.
      const aiText = (msg.content || '').trim();
      return aiText || null;
    } catch (error) {
      console.error(`❌ Error en ${label}:`, error.response?.data || error.message);
      return null;
    }
  }

  static async callOpenAI(systemPrompt, userMessage, history = [], maxTokens = 350) {
    return await AIService.callOpenAICompatible({
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      apiKey: await Setting.get('OPENAI_API_KEY'),
      model: await Setting.get('OPENAI_MODEL', 'gpt-3.5-turbo'),
      systemPrompt,
      userMessage,
      history,
      label: 'OpenAI API',
      maxTokens
    });
  }

  // OpenCode Zen/Go: gateway OpenAI-compatible con modelos gratuitos
  // https://opencode.ai/zen  →  endpoint: https://opencode.ai/zen/v1/chat/completions
  static async callOpenCode(systemPrompt, userMessage, history = [], maxTokens = 350) {
    const model = (await Setting.get('OPENCODE_MODEL', 'deepseek-v4-flash-free')).toLowerCase();
    const modelId = model.startsWith('opencode/') ? model.replace('opencode/', '') : model;
    return await AIService.callOpenAICompatible({
      apiUrl: 'https://opencode.ai/zen/v1/chat/completions',
      apiKey: await Setting.get('OPENCODE_API_KEY'),
      model: modelId,
      systemPrompt,
      userMessage,
      history,
      label: 'OpenCode Zen API',
      maxTokens
    });
  }

  // Proveedor CUSTOM: cualquier endpoint OpenAI-compatible
  // (OpenRouter, Groq, DeepSeek oficial, Azure, Ollama local, etc.)
  static async callCustom(systemPrompt, userMessage, history = [], maxTokens = 350) {
    return await AIService.callOpenAICompatible({
      apiUrl: await Setting.get('CUSTOM_API_URL', 'https://openrouter.ai/api/v1/chat/completions'),
      apiKey: await Setting.get('CUSTOM_API_KEY'),
      model: await Setting.get('CUSTOM_MODEL'),
      systemPrompt,
      userMessage,
      history,
      label: 'API Custom',
      maxTokens
    });
  }

  static async callGemini(systemPrompt, userMessage, history = [], maxTokens = 350) {
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
        { contents, generationConfig: { maxOutputTokens: maxTokens } },
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
