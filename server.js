'use strict';
const path = require('node:path');
const { openDatabase } = require('./server/db');
const { createApp } = require('./server/app');
const { seed } = require('./server/seed');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'marina.db');

const db = openDatabase(DB_FILE);
if (process.env.SEED !== '0') seed(db, { onlyIfEmpty: true });

createApp(db).listen(PORT, () => {
  console.log(`⚓ Marina do Léo rodando em http://localhost:${PORT}`);
});
