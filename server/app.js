'use strict';
const path = require('node:path');
const express = require('express');
const { verifyPassword, hashPassword, createSession, authMiddleware, requireAdmin } = require('./auth');
const { RESOURCES, STATUS, HttpError, upsertLancamento, today } = require('./resources');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  // ---------- Autenticação ----------
  const loginTentativas = new Map();
  app.post('/api/login', (req, res) => {
    const { email, senha } = req.body || {};
    const chave = `${req.ip}|${String(email).toLowerCase()}`;
    const t = loginTentativas.get(chave) || { n: 0, ate: 0 };
    if (t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(String(email || ''));
    if (!u || !verifyPassword(senha || '', u.senha_hash)) {
      t.n += 1;
      if (t.n >= 5) { t.ate = Date.now() + 5 * 60 * 1000; t.n = 0; }
      loginTentativas.set(chave, t);
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }
    loginTentativas.delete(chave);
    const token = createSession(db, u.id);
    res.json({ token, usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil } });
  });

  const auth = authMiddleware(db);
  app.use('/api', (req, res, next) => (req.path === '/login' || req.path === '/saude' ? next() : auth(req, res, next)));

  app.get('/api/saude', (req, res) => res.json({ ok: true, sistema: 'Marina do Léo' }));

  app.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(req.token);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json(req.user));

  app.put('/api/me/senha', (req, res) => {
    const { atual, nova } = req.body || {};
    const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.user.id);
    if (!verifyPassword(atual || '', u.senha_hash)) throw new HttpError(400, 'Senha atual incorreta.');
    if (!nova || String(nova).length < 6) throw new HttpError(400, 'A nova senha deve ter ao menos 6 caracteres.');
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashPassword(nova), req.user.id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?').run(req.user.id, req.token);
    res.json({ ok: true });
  });

  app.get('/api/meta', (req, res) => res.json({ status: STATUS }));

  // ---------- Usuários (somente admin) ----------
  app.get('/api/usuarios', requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT id, nome, email, perfil, ativo, criado_em FROM usuarios ORDER BY nome').all());
  });
  app.post('/api/usuarios', requireAdmin, (req, res) => {
    const { nome, email, senha, perfil = 'operador' } = req.body || {};
    if (!nome || !email || !senha) throw new HttpError(400, 'Nome, e-mail e senha são obrigatórios.');
    if (String(senha).length < 6) throw new HttpError(400, 'A senha deve ter ao menos 6 caracteres.');
    if (!['admin', 'operador'].includes(perfil)) throw new HttpError(400, 'Perfil inválido.');
    const r = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?,?,?,?)')
      .run(nome, email, hashPassword(senha), perfil);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/usuarios/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    const b = req.body || {};
    const perfil = b.perfil ?? u.perfil;
    const ativo = b.ativo == null ? u.ativo : (b.ativo ? 1 : 0);
    if (!['admin', 'operador'].includes(perfil)) throw new HttpError(400, 'Perfil inválido.');
    if (id === req.user.id && (perfil !== 'admin' || !ativo)) throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador.');
    db.prepare('UPDATE usuarios SET nome = ?, email = ?, perfil = ?, ativo = ? WHERE id = ?')
      .run(b.nome ?? u.nome, b.email ?? u.email, perfil, ativo, id);
    if (b.senha) {
      if (String(b.senha).length < 6) throw new HttpError(400, 'A senha deve ter ao menos 6 caracteres.');
      db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashPassword(b.senha), id);
    }
    if (!ativo || b.senha) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    res.json({ ok: true });
  });
  app.delete('/api/usuarios/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Você não pode excluir seu próprio usuário.');
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- CRUD genérico ----------
  const pick = (cfg, body) => {
    const out = {};
    for (const f of cfg.fields) {
      if (!(f in body)) continue;
      let v = body[f];
      if (typeof v === 'string') v = v.trim();
      if (v === '') v = null;
      if (cfg.bool?.includes(f)) v = v ? 1 : 0;
      out[f] = v;
    }
    return out;
  };

  for (const [name, cfg] of Object.entries(RESOURCES)) {
    const base = `/api/${name}`;
    const order = cfg.order || 'id DESC';

    app.get(base, (req, res) => {
      const where = [];
      const params = [];
      for (const [k, v] of Object.entries(req.query)) {
        if (cfg.fields.includes(k) && v !== '') { where.push(`${k} = ?`); params.push(v); }
      }
      const sql = `SELECT * FROM ${name}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
      res.json(db.prepare(sql).all(...params));
    });

    app.get(`${base}/:id`, (req, res) => {
      const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(Number(req.params.id));
      if (!row) throw new HttpError(404, 'Registro não encontrado.');
      res.json(row);
    });

    const save = (id, body) => tx(() => {
      let data = pick(cfg, body || {});
      if (id) {
        const cur = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
        if (!cur) throw new HttpError(404, 'Registro não encontrado.');
        const merged = {};
        for (const f of cfg.fields) merged[f] = f in data ? data[f] : cur[f];
        data = merged;
      }
      for (const f of cfg.required) {
        if (data[f] == null) throw new HttpError(400, `Campo obrigatório: ${f.replace(/_id$/, '').replace(/_/g, ' ')}.`);
      }
      cfg.validate?.(data, db, id);
      const cols = Object.keys(data);
      let newId = id;
      if (id) {
        db.prepare(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), id);
      } else {
        const r = db.prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map((c) => data[c]));
        newId = Number(r.lastInsertRowid);
      }
      const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(newId);
      cfg.after?.(db, row);
      return db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(newId);
    });

    app.post(base, (req, res) => res.status(201).json(save(null, req.body)));
    app.put(`${base}/:id`, (req, res) => res.json(save(Number(req.params.id), req.body)));

    app.delete(`${base}/:id`, (req, res) => {
      if (cfg.adminDelete && req.user.perfil !== 'admin') throw new HttpError(403, 'Somente administradores podem excluir este registro.');
      tx(() => {
        const r = db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(Number(req.params.id));
        if (!r.changes) throw new HttpError(404, 'Registro não encontrado.');
        cfg.after?.(db, null);
      });
      res.json({ ok: true });
    });
  }

  // ---------- Operações de negócio ----------
  app.post('/api/financeiro/gerar-mensalidades', (req, res) => {
    const comp = String(req.body?.competencia || today().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(comp)) throw new HttpError(400, 'Competência inválida (use AAAA-MM).');
    const fimMes = new Date(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)), 0).toISOString().slice(0, 10);
    const contratos = db.prepare(`
      SELECT c.*, b.nome AS barco, v.codigo AS vaga FROM contratos c
      JOIN barcos b ON b.id = c.barco_id JOIN vagas v ON v.id = c.vaga_id
      WHERE c.status = 'Ativo' AND c.valor_mensal > 0 AND c.data_inicio <= ? AND (c.data_fim IS NULL OR c.data_fim >= ?)`).all(fimMes, `${comp}-01`);
    let criados = 0;
    tx(() => {
      for (const c of contratos) {
        const ref = `CONTRATO-${c.id}-${comp}`;
        if (db.prepare('SELECT 1 FROM lancamentos WHERE referencia = ?').get(ref)) continue;
        upsertLancamento(db, ref, {
          tipo: 'Receita', categoria: 'Mensalidade de vaga',
          descricao: `Mensalidade ${comp.slice(5)}/${comp.slice(0, 4)} — vaga ${c.vaga} (${c.barco})`,
          valor: c.valor_mensal, vencimento: `${comp}-${String(c.dia_vencimento).padStart(2, '0')}`, cliente_id: c.cliente_id,
        });
        criados++;
      }
    });
    res.json({ competencia: comp, contratos: contratos.length, criados });
  });

  app.post('/api/lancamentos/:id/baixar', (req, res) => {
    const id = Number(req.params.id);
    const l = db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id);
    if (!l) throw new HttpError(404, 'Lançamento não encontrado.');
    if (l.status !== 'Pendente') throw new HttpError(409, `Lançamento já está ${l.status.toLowerCase()}.`);
    db.prepare(`UPDATE lancamentos SET status = 'Pago', data_pagamento = ?, forma_pagamento = ? WHERE id = ?`)
      .run(req.body?.data_pagamento || today(), req.body?.forma_pagamento || l.forma_pagamento, id);
    res.json(db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(id));
  });

  app.get('/api/clientes/:id/extrato', (req, res) => {
    const id = Number(req.params.id);
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
    if (!cliente) throw new HttpError(404, 'Cliente não encontrado.');
    res.json({
      cliente,
      barcos: db.prepare('SELECT * FROM barcos WHERE cliente_id = ?').all(id),
      contratos: db.prepare(`SELECT c.*, v.codigo AS vaga, b.nome AS barco FROM contratos c
        JOIN vagas v ON v.id = c.vaga_id JOIN barcos b ON b.id = c.barco_id WHERE c.cliente_id = ?`).all(id),
      reservas: db.prepare(`SELECT r.*, b.nome AS barco FROM reservas r JOIN barcos b ON b.id = r.barco_id
        WHERE r.cliente_id = ? ORDER BY data_inicio DESC`).all(id),
      lancamentos: db.prepare('SELECT * FROM lancamentos WHERE cliente_id = ? ORDER BY vencimento DESC').all(id),
    });
  });

  app.get('/api/barcos/:id/historico', (req, res) => {
    const id = Number(req.params.id);
    const barco = db.prepare('SELECT * FROM barcos WHERE id = ?').get(id);
    if (!barco) throw new HttpError(404, 'Barco não encontrado.');
    res.json({
      barco,
      movimentacoes: db.prepare('SELECT * FROM movimentacoes WHERE barco_id = ? ORDER BY data_hora DESC LIMIT 100').all(id),
      manutencoes: db.prepare('SELECT * FROM manutencoes WHERE barco_id = ? ORDER BY data_abertura DESC').all(id),
      reservas: db.prepare('SELECT * FROM reservas WHERE barco_id = ? ORDER BY data_inicio DESC').all(id),
      contrato: db.prepare(`SELECT c.*, v.codigo AS vaga FROM contratos c JOIN vagas v ON v.id = c.vaga_id
        WHERE c.barco_id = ? AND c.status <> 'Encerrado'`).get(id) || null,
    });
  });

  app.get('/api/dashboard', (req, res) => {
    const hoje = today();
    const mes = hoje.slice(0, 7);
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const vagas = one(`SELECT COUNT(*) total, SUM(status='Ocupada') ocupadas, SUM(status='Livre') livres, SUM(status='Manutenção') manutencao FROM vagas`);
    const barcos = one(`SELECT COUNT(*) total, SUM(frota_propria=1) frota, SUM(status='Em manutenção') manutencao, SUM(status='Em uso') em_uso FROM barcos WHERE status <> 'Inativo'`);
    const fin = one(`SELECT
        COALESCE(SUM(CASE WHEN tipo='Receita' AND status='Pago' AND substr(data_pagamento,1,7)=? THEN valor END),0) receita_mes,
        COALESCE(SUM(CASE WHEN tipo='Despesa' AND status='Pago' AND substr(data_pagamento,1,7)=? THEN valor END),0) despesa_mes,
        COALESCE(SUM(CASE WHEN tipo='Receita' AND status='Pendente' THEN valor END),0) a_receber,
        COALESCE(SUM(CASE WHEN tipo='Receita' AND status='Pendente' AND vencimento < ? THEN valor END),0) vencido,
        COUNT(CASE WHEN tipo='Receita' AND status='Pendente' AND vencimento < ? THEN 1 END) qtd_vencido,
        COALESCE(SUM(CASE WHEN tipo='Despesa' AND status='Pendente' THEN valor END),0) a_pagar
      FROM lancamentos`, mes, mes, hoje, hoje);
    const historico = db.prepare(`
      WITH RECURSIVE m(i, mes) AS (SELECT 0, strftime('%Y-%m', 'now', 'localtime')
        UNION ALL SELECT i+1, strftime('%Y-%m', date('now', 'localtime', 'start of month', '-' || (i+1) || ' months')) FROM m WHERE i < 5)
      SELECT m.mes,
        COALESCE((SELECT SUM(valor) FROM lancamentos WHERE tipo='Receita' AND status='Pago' AND substr(data_pagamento,1,7)=m.mes),0) receita,
        COALESCE((SELECT SUM(valor) FROM lancamentos WHERE tipo='Despesa' AND status='Pago' AND substr(data_pagamento,1,7)=m.mes),0) despesa
      FROM m ORDER BY m.mes`).all();
    res.json({
      hoje,
      vagas, barcos, financeiro: fin, historico,
      clientes: one('SELECT COUNT(*) n FROM clientes').n,
      contratos_ativos: one(`SELECT COUNT(*) n FROM contratos WHERE status='Ativo'`).n,
      manutencoes_abertas: db.prepare(`SELECT m.*, b.nome AS barco FROM manutencoes m JOIN barcos b ON b.id=m.barco_id
        WHERE m.status IN ('Aberta','Em andamento')
        ORDER BY CASE m.prioridade WHEN 'Urgente' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Média' THEN 2 ELSE 3 END, m.data_prevista LIMIT 8`).all(),
      reservas_proximas: db.prepare(`SELECT r.*, b.nome AS barco, c.nome AS cliente FROM reservas r
        JOIN barcos b ON b.id=r.barco_id JOIN clientes c ON c.id=r.cliente_id
        WHERE r.status IN ('Pendente','Confirmada','Em andamento') AND substr(r.data_fim,1,10) >= ?
        ORDER BY r.data_inicio LIMIT 8`).all(hoje),
      barcos_fora: db.prepare(`SELECT b.id, b.nome, v.data_hora, v.destino, v.responsavel FROM barcos b
        JOIN movimentacoes v ON v.id = (SELECT id FROM movimentacoes WHERE barco_id=b.id ORDER BY data_hora DESC, id DESC LIMIT 1)
        WHERE v.tipo='Saída' ORDER BY v.data_hora`).all(),
      inadimplentes: db.prepare(`SELECT l.*, c.nome AS cliente FROM lancamentos l LEFT JOIN clientes c ON c.id=l.cliente_id
        WHERE l.tipo='Receita' AND l.status='Pendente' AND l.vencimento < ? ORDER BY l.vencimento LIMIT 8`).all(hoje),
      seguros_vencendo: db.prepare(`SELECT id, nome, seguro_validade FROM barcos
        WHERE seguro_validade IS NOT NULL AND seguro_validade <= date(?, '+30 days') AND status <> 'Inativo'
        ORDER BY seguro_validade`).all(hoje),
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // ---------- Frontend ----------
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // ---------- Erros ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint')) return res.status(409).json({ erro: 'Já existe um registro com este valor (campo único).' });
    if (msg.includes('FOREIGN KEY constraint')) return res.status(409).json({ erro: 'Registro está vinculado a outros dados e não pode ser removido/alterado.' });
    if (msg.includes('CHECK constraint')) return res.status(400).json({ erro: 'Valor inválido.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno do servidor.' });
  });

  return app;
}

module.exports = { createApp };
