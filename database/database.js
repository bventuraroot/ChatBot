const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// La ruta del SQLite es configurable vía DB_PATH (usado en Docker para
// separar los datos persistentes del código de la imagen).
const dbPath = process.env.DB_PATH || path.join(__dirname, 'chatbot.sqlite');
const db = new sqlite3.Database(dbPath);

// Configuración de concurrencia para evitar errores SQLITE_BUSY cuando
// llegan varios mensajes al mismo tiempo (webhooks + panel admin)
db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA busy_timeout = 5000');

// Promisificar las funciones de la base de datos
const dbAsync = {
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  exec: (sql) => {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  initDatabase: async () => {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await dbAsync.exec(schemaSql);
    console.log('✅ Base de datos SQLite inicializada correctamente.');
  }
};

module.exports = { db, dbAsync };
