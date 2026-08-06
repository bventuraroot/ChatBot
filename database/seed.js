require('dotenv').config();
const { dbAsync } = require('./database');
const bcrypt = require('bcryptjs');

async function seed() {
  await dbAsync.initDatabase();

  // Admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@chatbot.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

  const existingAdmin = await dbAsync.get('SELECT * FROM users WHERE email = ?', [adminEmail]);
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await dbAsync.run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['Administrador', adminEmail, hashedPassword, 'admin']
    );
    console.log(`👤 Usuario Administrador creado: ${adminEmail}`);
  } else {
    console.log(`👤 Usuario Administrador ya existe: ${adminEmail}`);
  }

  // Clientes de ejemplo
  const clientCount = await dbAsync.get('SELECT COUNT(*) as count FROM clients');
  if (clientCount.count === 0) {
    await dbAsync.run(
      `INSERT INTO clients (name, description, webchat_identifier, welcome_message, out_of_hours_message)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'Mi Negocio',
        'Cliente de demostración general',
        'mi-negocio',
        '¡Hola {contact_name}! 👋 Bienvenido a Mi Negocio. ¿En qué puedo ayudarte hoy?',
        'Gracias por escribirnos. Nuestro horario es de Lunes a Viernes 8AM-5PM. Te responderemos pronto.'
      ]
    );

    await dbAsync.run(
      `INSERT INTO clients (name, description, webchat_identifier, welcome_message, bot_enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'Tienda Online',
        'Demo tienda con respuestas de catálogo',
        'tienda-online',
        '¡Hola {contact_name}! 🛒 Bienvenido a nuestra tienda. ¿Buscas algún producto en particular?',
        1
      ]
    );
    console.log('🏢 Clientes de ejemplo creados.');
  }

  // Knowledge Items (FAQs globales)
  const faqCount = await dbAsync.get('SELECT COUNT(*) as count FROM knowledge_items');
  if (faqCount.count === 0) {
    const defaultFaqs = [
      // FAQs globales (client_id = NULL, aplican a todos)
      {
        category: 'Horarios',
        question: '¿Cuáles son sus horarios de atención?',
        answer: 'Nuestro horario de atención es de Lunes a Viernes de 8:00 AM a 5:00 PM y Sábados de 8:00 AM a 12:00 PM.',
        keywords: 'horario,horarios,abierto,cerrado,atención,hora,horas',
        match_type: 'keyword',
        priority: 0
      },
      {
        category: 'Ubicación',
        question: '¿Dónde están ubicados?',
        answer: 'Estamos ubicados en la dirección principal de nuestra empresa. Puedes visitarnos en horario laboral o escribirnos por este medio.',
        keywords: 'ubicación,direccion,dirección,donde,ubicados,mapa,local',
        match_type: 'keyword',
        priority: 0
      },
      {
        category: 'Servicios',
        question: '¿Qué servicios ofrecen?',
        answer: 'Ofrecemos soluciones integrales para tu negocio, atención al cliente personalizada, soporte técnico y asesoría.',
        keywords: 'servicios,productos,servicio,ofrecen,catalogo,catálogo',
        match_type: 'keyword',
        priority: 0
      },
      {
        category: 'Soporte',
        question: 'Deseo hablar con un asesor o agente humano',
        answer: 'Un momento por favor. He transferido tu consulta a uno de nuestros agentes para que te atienda personalmente.',
        keywords: 'humano,asesor,agente,persona,soporte,ayuda,hablar',
        match_type: 'keyword',
        priority: 10 // Mayor prioridad: siempre revisar primero
      },
      {
        category: 'Saludos',
        question: 'Saludo general',
        answer: '¡Hola! ¿En qué puedo ayudarte? Puedes preguntar por nuestros horarios, servicios, ubicación o solicitar ayuda de un agente.',
        keywords: 'hola,buenos,buenas,saludos,hey,hello',
        match_type: 'any',
        priority: 5
      },
      {
        category: 'Precios',
        question: 'Información de precios',
        answer: 'Para información de precios personalizada, por favor indícanos qué servicio o producto te interesa y te atenderemos con gusto.',
        keywords: 'precio,precios,cuánto,costo,cuestan,valor,tarifa',
        match_type: 'any',
        priority: 0
      }
    ];

    for (const faq of defaultFaqs) {
      await dbAsync.run(
        'INSERT INTO knowledge_items (client_id, category, question, answer, keywords, match_type, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [null, faq.category, faq.question, faq.answer, faq.keywords, faq.match_type, faq.priority]
      );
    }

    // FAQs específicas del cliente "Tienda Online" (ID 2)
    const tiendaFaqs = [
      {
        category: 'Envíos',
        question: '¿Hacen envíos?',
        answer: '¡Sí! Hacemos envíos a todo el país. El tiempo de entrega es de 3-5 días hábiles. Envío gratis en compras mayores a $500.',
        keywords: 'envío,envíos,enviar,entrega,entregar,paquetería',
        match_type: 'keyword',
        priority: 5
      },
      {
        category: 'Devoluciones',
        question: '¿Puedo devolver un producto?',
        answer: 'Sí, aceptamos devoluciones dentro de los primeros 15 días después de la compra. El producto debe estar en su empaque original.',
        keywords: 'devolver,devolución,devoluciones,regresar,reembolso,cambio',
        match_type: 'keyword',
        priority: 5
      },
      {
        category: 'Pagos',
        question: '¿Qué métodos de pago aceptan?',
        answer: 'Aceptamos tarjetas de crédito/débito (Visa, Mastercard, AMEX), transferencia bancaria, PayPal y pago en efectivo en tienda.',
        keywords: 'pago,pagos,tarjeta,tarjetas,transferencia,paypal,efectivo,método',
        match_type: 'any',
        priority: 5
      },
      {
        category: 'Estado de Pedido',
        question: '¿Cómo consulto mi pedido?',
        answer: 'Para consultar el estado de tu pedido, por favor indícanos tu número de orden y te daremos la información actualizada.',
        keywords: 'pedido,orden,seguimiento,tracking,estado,dónde está',
        match_type: 'any',
        priority: 10
      }
    ];

    for (const faq of tiendaFaqs) {
      await dbAsync.run(
        'INSERT INTO knowledge_items (client_id, category, question, answer, keywords, match_type, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [2, faq.category, faq.question, faq.answer, faq.keywords, faq.match_type, faq.priority]
      );
    }

    console.log('📚 Preguntas frecuentes iniciales insertadas (6 globales + 4 de Tienda Online).');
  }

  // Settings por defecto (solo si la tabla está vacía)
  const settingsCount = await dbAsync.get('SELECT COUNT(*) as count FROM settings');
  if (settingsCount.count === 0) {
    const defaultSettings = [
      ['TIMEZONE', process.env.TIMEZONE || 'America/Mexico_City'],
      ['BOT_ENABLED', 'true'],
      ['BUSINESS_HOURS_START', '08:00'],
      ['BUSINESS_HOURS_END', '17:00'],
      ['BUSINESS_HOURS_DAYS', '1,2,3,4,5'],
      ['CHANNEL_WEB_ENABLED', 'true'],
      ['CHANNEL_WHATSAPP_CLOUD_ENABLED', 'true'],
      ['CHANNEL_WHATSAPP_EVOLUTION_ENABLED', 'true']
    ];
    for (const [key, value] of defaultSettings) {
      await dbAsync.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
    console.log('⚙️  Settings por defecto insertados.');
  }

  console.log('✅ Seeding completado exitosamente.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error durante el seeding:', err);
  process.exit(1);
});
