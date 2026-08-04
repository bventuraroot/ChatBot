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

  // Initial Knowledge Items (FAQs)
  const faqCount = await dbAsync.get('SELECT COUNT(*) as count FROM knowledge_items');
  if (faqCount.count === 0) {
    const defaultFaqs = [
      {
        category: 'Horarios',
        question: '¿Cuáles son sus horarios de atención?',
        answer: 'Nuestro horario de atención es de Lunes a Viernes de 8:00 AM a 5:00 PM y Sábados de 8:00 AM a 12:00 PM.',
        keywords: 'horario,horarios,abierto,cerrado,atención,hora,horas'
      },
      {
        category: 'Ubicación',
        question: '¿Dónde están ubicados?',
        answer: 'Estamos ubicados en la dirección principal de nuestra empresa. Puedes visitarnos en horario laboral o escribirnos por este medio.',
        keywords: 'ubicación,direccion,dirección,donde,ubicados,mapa,local'
      },
      {
        category: 'Servicios',
        question: '¿Qué servicios ofrecen?',
        answer: 'Ofrecemos soluciones integrales para tu negocio, atención al cliente personalizada, soporte técnico y asesoría.',
        keywords: 'servicios,productos,servicio,ofrecen,catalogo,catálogo'
      },
      {
        category: 'Soporte',
        question: 'Deseo hablar con un asesor o agente humano',
        answer: 'Un momento por favor. He transferido tu consulta a uno de nuestros agentes para que te atienda personalmente.',
        keywords: 'humano,asesor,agente,persona,soporte,ayuda,hablar'
      }
    ];

    for (const faq of defaultFaqs) {
      await dbAsync.run(
        'INSERT INTO knowledge_items (category, question, answer, keywords) VALUES (?, ?, ?, ?)',
        [faq.category, faq.question, faq.answer, faq.keywords]
      );
    }
    console.log('📚 Preguntas frecuentes iniciales insertadas.');
  }

  console.log('✅ Seeding completado exitosamente.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error durante el seeding:', err);
  process.exit(1);
});
