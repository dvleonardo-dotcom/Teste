'use strict';
const path = require('node:path');
const { openDatabase } = require('./db');
const { seed } = require('./seed');

const db = openDatabase(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'marina.db'));
const r = seed(db, { onlyIfEmpty: false });
console.log(r ? 'Dados de exemplo inseridos.' : 'Nada a fazer.');
