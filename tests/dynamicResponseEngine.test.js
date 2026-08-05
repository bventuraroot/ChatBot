const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Usar base de datos SQLite en memoria para tests
process.env.DB_PATH = ':memory:';
const { dbAsync } = require('../database/database');
const DynamicResponseEngine = require('../src/services/dynamicResponseEngine');
const KnowledgeItem = require('../src/models/KnowledgeItem');

test('DynamicResponseEngine - renderTemplate reemplaza variables correctamente', () => {
  const contact = {
    name: 'Juan Pérez',
    phone: '+123456789',
    email: 'juan@example.com'
  };

  const template = '¡Hola {contact_name}! Tu correo es {contact_email} y tu teléfono es {contact_phone}.';
  const rendered = DynamicResponseEngine.renderTemplate(template, contact);

  assert.equal(rendered, '¡Hola Juan Pérez! Tu correo es juan@example.com y tu teléfono es +123456789.');
});

test('DynamicResponseEngine - búsqueda en Base de Conocimientos', async (t) => {
  await dbAsync.initDatabase();

  // Insertar FAQ de prueba
  await KnowledgeItem.create({
    category: 'Horarios',
    question: '¿Cuál es el horario de atención?',
    answer: 'Atendemos de 8am a 5pm',
    keywords: 'horario,atencion,abierto',
    match_type: 'keyword',
    priority: 10
  });

  const response = await DynamicResponseEngine.findResponse('¿Qué horario tienen?');
  assert.notEqual(response, null);
  assert.equal(response.source, 'knowledge_base');
  assert.equal(response.answer, 'Atendemos de 8am a 5pm');
});
