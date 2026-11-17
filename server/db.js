'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'operador' CHECK (perfil IN ('admin','operador')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  documento TEXT,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  habilitacao TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS barcos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Lancha',
  fabricante TEXT,
  modelo TEXT,
  ano INTEGER,
  comprimento_pes REAL,
  inscricao TEXT,
  motor TEXT,
  capacidade INTEGER,
  frota_propria INTEGER NOT NULL DEFAULT 0,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  valor_diaria REAL,
  status TEXT NOT NULL DEFAULT 'Ativo',
  seguro_validade TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vagas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'Molhada',
  comprimento_max REAL,
  tarifa_mensal REAL,
  status TEXT NOT NULL DEFAULT 'Livre',
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  barco_id INTEGER NOT NULL REFERENCES barcos(id),
  vaga_id INTEGER NOT NULL REFERENCES vagas(id),
  data_inicio TEXT NOT NULL,
  data_fim TEXT,
  valor_mensal REAL NOT NULL,
  dia_vencimento INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'Ativo',
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barco_id INTEGER NOT NULL REFERENCES barcos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  data_hora TEXT NOT NULL,
  responsavel TEXT,
  destino TEXT,
  passageiros INTEGER,
  combustivel TEXT,
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS manutencoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barco_id INTEGER NOT NULL REFERENCES barcos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'Preventiva',
  descricao TEXT NOT NULL,
  prioridade TEXT NOT NULL DEFAULT 'Média',
  data_abertura TEXT NOT NULL,
  data_prevista TEXT,
  data_conclusao TEXT,
  responsavel TEXT,
  custo REAL,
  status TEXT NOT NULL DEFAULT 'Aberta',
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barco_id INTEGER NOT NULL REFERENCES barcos(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  com_marinheiro INTEGER NOT NULL DEFAULT 0,
  passageiros INTEGER,
  valor REAL,
  status TEXT NOT NULL DEFAULT 'Pendente',
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('Receita','Despesa')),
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  vencimento TEXT NOT NULL,
  data_pagamento TEXT,
  forma_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  referencia TEXT UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contratos_vaga ON contratos(vaga_id, status);
CREATE INDEX IF NOT EXISTS idx_mov_barco ON movimentacoes(barco_id, data_hora);
CREATE INDEX IF NOT EXISTS idx_manut_barco ON manutencoes(barco_id, status);
CREATE INDEX IF NOT EXISTS idx_res_barco ON reservas(barco_id, data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_lanc_venc ON lancamentos(vencimento, status);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  ensureAdmin(db);
  return db;
}

function ensureAdmin(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get();
  if (n === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@marinadoleo.com.br';
    const senha = process.env.ADMIN_SENHA || 'admin123';
    db.prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?,?,?,?)')
      .run('Administrador', email, hashPassword(senha), 'admin');
  }
}

module.exports = { openDatabase };
