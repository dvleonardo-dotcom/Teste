'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { seed } = require('../server/seed');

let server, base, token;

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  const db = openDatabase(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('rejeita acesso sem login e login inválido', async () => {
  assert.equal((await call('/api/barcos', { auth: false })).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { email: 'admin@marinadoleo.com.br', senha: 'errada' }, auth: false })).status, 401);
});

test('login do administrador padrão', async () => {
  const r = await call('/api/login', { method: 'POST', body: { email: 'admin@marinadoleo.com.br', senha: 'admin123' }, auth: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.perfil, 'admin');
  token = r.body.token;
});

test('painel retorna indicadores', async () => {
  const r = await call('/api/dashboard');
  assert.equal(r.status, 200);
  assert.equal(r.body.vagas.total, 24);
  assert.ok(r.body.vagas.ocupadas >= 9);
  assert.equal(r.body.historico.length, 6);
  assert.ok(r.body.financeiro.vencido > 0, 'seed tem cobrança vencida');
});

test('contrato ocupa vaga e impede dupla ocupação; encerrar libera', async () => {
  const cli = (await call('/api/clientes', { method: 'POST', body: { nome: 'Teste Silva' } })).body;
  const barco = (await call('/api/barcos', { method: 'POST', body: { nome: 'Gaivota', tipo: 'Lancha', comprimento_pes: 28, cliente_id: cli.id } })).body;
  const vaga = (await call('/api/vagas', { method: 'POST', body: { codigo: 'Z-01', tipo: 'Molhada', comprimento_max: 30, tarifa_mensal: 2000 } })).body;
  assert.equal(vaga.status, 'Livre');

  const c = await call('/api/contratos', { method: 'POST', body: { cliente_id: cli.id, barco_id: barco.id, vaga_id: vaga.id, data_inicio: '2026-01-01', valor_mensal: 2000 } });
  assert.equal(c.status, 201);
  assert.equal((await call(`/api/vagas/${vaga.id}`)).body.status, 'Ocupada');

  const barco2 = (await call('/api/barcos', { method: 'POST', body: { nome: 'Outro', tipo: 'Lancha', comprimento_pes: 20 } })).body;
  const dup = await call('/api/contratos', { method: 'POST', body: { cliente_id: cli.id, barco_id: barco2.id, vaga_id: vaga.id, data_inicio: '2026-01-01', valor_mensal: 2000 } });
  assert.equal(dup.status, 409);

  await call(`/api/contratos/${c.body.id}`, { method: 'PUT', body: { status: 'Encerrado' } });
  assert.equal((await call(`/api/vagas/${vaga.id}`)).body.status, 'Livre');
});

test('barco maior que a vaga é recusado', async () => {
  const cli = (await call('/api/clientes', { method: 'POST', body: { nome: 'Grande' } })).body;
  const barco = (await call('/api/barcos', { method: 'POST', body: { nome: 'Navio', tipo: 'Iate', comprimento_pes: 80 } })).body;
  const vaga = (await call('/api/vagas', { method: 'POST', body: { codigo: 'Z-02', tipo: 'Molhada', comprimento_max: 40 } })).body;
  const r = await call('/api/contratos', { method: 'POST', body: { cliente_id: cli.id, barco_id: barco.id, vaga_id: vaga.id, data_inicio: '2026-01-01', valor_mensal: 1 } });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /maior/);
});

test('reservas: conflito de agenda, só frota própria e lançamento automático', async () => {
  const barcos = (await call('/api/barcos')).body;
  const frota = barcos.find((b) => b.nome === 'Raio');
  const cliente = barcos.find((b) => !b.frota_propria);
  const cli = (await call('/api/clientes')).body[0];

  const naoFrota = await call('/api/reservas', { method: 'POST', body: { barco_id: cliente.id, cliente_id: cli.id, data_inicio: '2030-01-10', data_fim: '2030-01-10' } });
  assert.equal(naoFrota.status, 409);

  const r1 = await call('/api/reservas', { method: 'POST', body: { barco_id: frota.id, cliente_id: cli.id, data_inicio: '2030-01-10', data_fim: '2030-01-12', valor: 2700, status: 'Confirmada' } });
  assert.equal(r1.status, 201);
  const conflito = await call('/api/reservas', { method: 'POST', body: { barco_id: frota.id, cliente_id: cli.id, data_inicio: '2030-01-12', data_fim: '2030-01-13' } });
  assert.equal(conflito.status, 409);

  const lanc = (await call('/api/lancamentos')).body.find((l) => l.referencia === `RESERVA-${r1.body.id}`);
  assert.ok(lanc);
  assert.equal(lanc.valor, 2700);

  await call(`/api/reservas/${r1.body.id}`, { method: 'PUT', body: { status: 'Cancelada' } });
  const l2 = (await call('/api/lancamentos')).body.find((l) => l.referencia === `RESERVA-${r1.body.id}`);
  assert.equal(l2.status, 'Cancelado');
});

test('manutenção altera status do barco e gera despesa ao concluir', async () => {
  const barco = (await call('/api/barcos', { method: 'POST', body: { nome: 'Frota X', tipo: 'Lancha', frota_propria: true } })).body;
  const os = (await call('/api/manutencoes', { method: 'POST', body: { barco_id: barco.id, descricao: 'Troca de hélice', data_abertura: '2026-11-01' } })).body;
  assert.equal((await call(`/api/barcos/${barco.id}`)).body.status, 'Em manutenção');
  await call(`/api/manutencoes/${os.id}`, { method: 'PUT', body: { status: 'Concluída', custo: 750 } });
  assert.equal((await call(`/api/barcos/${barco.id}`)).body.status, 'Ativo');
  const l = (await call('/api/lancamentos')).body.find((x) => x.referencia === `OS-${os.id}`);
  assert.equal(l.tipo, 'Despesa');
  assert.equal(l.valor, 750);
});

test('movimentação de saída marca barco em uso; retorno devolve', async () => {
  const barco = (await call('/api/barcos', { method: 'POST', body: { nome: 'Navegante', tipo: 'Lancha' } })).body;
  await call('/api/movimentacoes', { method: 'POST', body: { barco_id: barco.id, tipo: 'Saída', data_hora: '2026-11-17T08:00' } });
  assert.equal((await call(`/api/barcos/${barco.id}`)).body.status, 'Em uso');
  await call('/api/movimentacoes', { method: 'POST', body: { barco_id: barco.id, tipo: 'Retorno', data_hora: '2026-11-17T17:00' } });
  assert.equal((await call(`/api/barcos/${barco.id}`)).body.status, 'Ativo');
});

test('gerar mensalidades é idempotente e baixa registra pagamento', async () => {
  const g1 = await call('/api/financeiro/gerar-mensalidades', { method: 'POST', body: { competencia: '2031-03' } });
  assert.equal(g1.status, 200);
  assert.ok(g1.body.criados >= 5);
  const g2 = await call('/api/financeiro/gerar-mensalidades', { method: 'POST', body: { competencia: '2031-03' } });
  assert.equal(g2.body.criados, 0);
  const l = (await call('/api/lancamentos')).body.find((x) => x.referencia?.endsWith('-2031-03'));
  const b = await call(`/api/lancamentos/${l.id}/baixar`, { method: 'POST', body: { forma_pagamento: 'PIX' } });
  assert.equal(b.body.status, 'Pago');
  assert.equal((await call(`/api/lancamentos/${l.id}/baixar`, { method: 'POST' })).status, 409);
});

test('operador não acessa usuários nem exclui lançamentos', async () => {
  await call('/api/usuarios', { method: 'POST', body: { nome: 'Op', email: 'op@marina.com', senha: 'senha123', perfil: 'operador' } });
  const adminToken = token;
  token = (await call('/api/login', { method: 'POST', body: { email: 'op@marina.com', senha: 'senha123' }, auth: false })).body.token;
  assert.equal((await call('/api/usuarios')).status, 403);
  const l = (await call('/api/lancamentos')).body[0];
  assert.equal((await call(`/api/lancamentos/${l.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await call('/api/barcos')).status, 200);
  token = adminToken;
});

test('validações de campos e campos não permitidos são ignorados', async () => {
  assert.equal((await call('/api/clientes', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call('/api/barcos', { method: 'POST', body: { nome: 'X', tipo: 'Lancha', status: 'Voando' } })).status, 400);
  const r = await call('/api/clientes', { method: 'POST', body: { nome: 'Seguro', 'id) VALUES (1); --': 'x', criado_em: '1900-01-01' } });
  assert.equal(r.status, 201);
  assert.notEqual(r.body.criado_em, '1900-01-01');
});
