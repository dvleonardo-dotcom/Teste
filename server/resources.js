'use strict';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUS = {
  barcos: ['Ativo', 'Em manutenção', 'Em uso', 'Inativo'],
  vagas: ['Livre', 'Ocupada', 'Reservada', 'Manutenção'],
  contratos: ['Ativo', 'Suspenso', 'Encerrado'],
  manutencoes: ['Aberta', 'Em andamento', 'Concluída', 'Cancelada'],
  reservas: ['Pendente', 'Confirmada', 'Em andamento', 'Concluída', 'Cancelada'],
  lancamentos: ['Pendente', 'Pago', 'Cancelado'],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function checkDate(v, label) {
  if (v != null && v !== '' && !DATE_RE.test(v)) throw new HttpError(400, `${label}: data inválida.`);
}
function checkIn(v, list, label) {
  if (v != null && v !== '' && !list.includes(v)) throw new HttpError(400, `${label}: valor inválido (${v}).`);
}
function checkPositive(v, label) {
  if (v != null && v !== '' && (isNaN(v) || Number(v) < 0)) throw new HttpError(400, `${label} deve ser um número positivo.`);
}

/**
 * Definição dos recursos REST. Apenas os campos listados em `fields` podem ser
 * gravados — isso impede injeção de colunas arbitrárias no SQL dinâmico.
 */
const RESOURCES = {
  clientes: {
    fields: ['nome', 'documento', 'telefone', 'email', 'endereco', 'habilitacao', 'observacoes'],
    required: ['nome'],
    order: 'nome COLLATE NOCASE',
  },

  barcos: {
    fields: ['nome', 'tipo', 'fabricante', 'modelo', 'ano', 'comprimento_pes', 'inscricao', 'motor',
      'capacidade', 'frota_propria', 'cliente_id', 'valor_diaria', 'status', 'seguro_validade', 'observacoes'],
    required: ['nome', 'tipo'],
    bool: ['frota_propria'],
    order: 'nome COLLATE NOCASE',
    validate(d) {
      checkIn(d.status, STATUS.barcos, 'Status');
      checkPositive(d.comprimento_pes, 'Comprimento');
      checkPositive(d.valor_diaria, 'Valor da diária');
      checkDate(d.seguro_validade, 'Validade do seguro');
      if (d.ano != null && d.ano !== '' && (d.ano < 1900 || d.ano > 2100)) throw new HttpError(400, 'Ano inválido.');
    },
  },

  vagas: {
    fields: ['codigo', 'tipo', 'comprimento_max', 'tarifa_mensal', 'status', 'observacoes'],
    required: ['codigo', 'tipo'],
    order: 'codigo COLLATE NOCASE',
    validate(d) {
      checkIn(d.status, STATUS.vagas, 'Status');
      checkPositive(d.comprimento_max, 'Comprimento máximo');
      checkPositive(d.tarifa_mensal, 'Tarifa mensal');
    },
  },

  contratos: {
    fields: ['cliente_id', 'barco_id', 'vaga_id', 'data_inicio', 'data_fim', 'valor_mensal', 'dia_vencimento', 'status', 'observacoes'],
    required: ['cliente_id', 'barco_id', 'vaga_id', 'data_inicio', 'valor_mensal'],
    validate(d, db, id) {
      checkIn(d.status, STATUS.contratos, 'Status');
      checkDate(d.data_inicio, 'Data de início');
      checkDate(d.data_fim, 'Data de término');
      checkPositive(d.valor_mensal, 'Valor mensal');
      if (d.dia_vencimento != null && (d.dia_vencimento < 1 || d.dia_vencimento > 28)) {
        throw new HttpError(400, 'Dia de vencimento deve estar entre 1 e 28.');
      }
      if (d.data_fim && d.data_fim < d.data_inicio) throw new HttpError(400, 'Data de término anterior ao início.');
      if ((d.status || 'Ativo') !== 'Encerrado') {
        const conflito = db.prepare(`SELECT id FROM contratos WHERE vaga_id = ? AND status <> 'Encerrado' AND id <> ?`)
          .get(d.vaga_id, id || 0);
        if (conflito) throw new HttpError(409, `Esta vaga já está em uso pelo contrato #${conflito.id}.`);
        const barcoDup = db.prepare(`SELECT id FROM contratos WHERE barco_id = ? AND status <> 'Encerrado' AND id <> ?`)
          .get(d.barco_id, id || 0);
        if (barcoDup) throw new HttpError(409, `Este barco já possui o contrato ativo #${barcoDup.id}.`);
        const vaga = db.prepare('SELECT comprimento_max, status FROM vagas WHERE id = ?').get(d.vaga_id);
        const barco = db.prepare('SELECT comprimento_pes FROM barcos WHERE id = ?').get(d.barco_id);
        if (!vaga) throw new HttpError(400, 'Vaga não encontrada.');
        if (!barco) throw new HttpError(400, 'Barco não encontrado.');
        if (vaga.status === 'Manutenção') throw new HttpError(409, 'Vaga está em manutenção.');
        if (vaga.comprimento_max && barco.comprimento_pes && barco.comprimento_pes > vaga.comprimento_max) {
          throw new HttpError(409, `Barco (${barco.comprimento_pes} pés) maior que o limite da vaga (${vaga.comprimento_max} pés).`);
        }
      }
    },
    after: (db) => syncVagas(db),
  },

  movimentacoes: {
    fields: ['barco_id', 'tipo', 'data_hora', 'responsavel', 'destino', 'passageiros', 'combustivel', 'observacoes'],
    required: ['barco_id', 'tipo', 'data_hora'],
    order: 'data_hora DESC, id DESC',
    validate(d) {
      checkIn(d.tipo, ['Saída', 'Retorno', 'Içamento', 'Descida', 'Abastecimento', 'Lavagem'], 'Tipo');
      checkDate(d.data_hora, 'Data/hora');
    },
    after: (db) => syncBarcos(db),
  },

  manutencoes: {
    fields: ['barco_id', 'tipo', 'descricao', 'prioridade', 'data_abertura', 'data_prevista', 'data_conclusao',
      'responsavel', 'custo', 'status', 'observacoes'],
    required: ['barco_id', 'descricao', 'data_abertura'],
    order: "CASE status WHEN 'Aberta' THEN 0 WHEN 'Em andamento' THEN 1 ELSE 2 END, data_prevista",
    validate(d) {
      checkIn(d.status, STATUS.manutencoes, 'Status');
      checkIn(d.prioridade, ['Baixa', 'Média', 'Alta', 'Urgente'], 'Prioridade');
      checkDate(d.data_abertura, 'Data de abertura');
      checkDate(d.data_prevista, 'Data prevista');
      checkDate(d.data_conclusao, 'Data de conclusão');
      checkPositive(d.custo, 'Custo');
      if (d.status === 'Concluída' && !d.data_conclusao) d.data_conclusao = today();
    },
    after(db, row) {
      if (row && row.status === 'Concluída' && Number(row.custo) > 0) {
        const barco = db.prepare('SELECT nome, frota_propria, cliente_id FROM barcos WHERE id = ?').get(row.barco_id);
        if (barco?.frota_propria) {
          upsertLancamento(db, `OS-${row.id}`, {
            tipo: 'Despesa', categoria: 'Manutenção', descricao: `OS #${row.id} — ${barco.nome}: ${row.descricao}`,
            valor: row.custo, vencimento: row.data_conclusao || today(), cliente_id: null,
          });
        } else if (barco) {
          upsertLancamento(db, `OS-${row.id}`, {
            tipo: 'Receita', categoria: 'Serviços', descricao: `OS #${row.id} — ${barco.nome}: ${row.descricao}`,
            valor: row.custo, vencimento: row.data_conclusao || today(), cliente_id: barco.cliente_id,
          });
        }
      }
      syncBarcos(db);
    },
  },

  reservas: {
    fields: ['barco_id', 'cliente_id', 'data_inicio', 'data_fim', 'com_marinheiro', 'passageiros', 'valor', 'status', 'observacoes'],
    required: ['barco_id', 'cliente_id', 'data_inicio', 'data_fim'],
    bool: ['com_marinheiro'],
    order: 'data_inicio DESC',
    validate(d, db, id) {
      checkIn(d.status, STATUS.reservas, 'Status');
      checkDate(d.data_inicio, 'Início');
      checkDate(d.data_fim, 'Fim');
      checkPositive(d.valor, 'Valor');
      if (d.data_fim < d.data_inicio) throw new HttpError(400, 'A data final deve ser posterior à inicial.');
      const barco = db.prepare('SELECT frota_propria, status, capacidade FROM barcos WHERE id = ?').get(d.barco_id);
      if (!barco) throw new HttpError(400, 'Barco não encontrado.');
      if (!barco.frota_propria) throw new HttpError(409, 'Somente barcos da frota própria podem ser reservados para aluguel.');
      if (barco.capacidade && d.passageiros && Number(d.passageiros) > barco.capacidade) {
        throw new HttpError(409, `Capacidade máxima do barco é de ${barco.capacidade} pessoas.`);
      }
      if (d.status !== 'Cancelada' && d.status !== 'Concluída') {
        const c = db.prepare(`SELECT id FROM reservas WHERE barco_id = ? AND id <> ?
          AND status NOT IN ('Cancelada','Concluída') AND data_inicio <= ? AND data_fim >= ?`)
          .get(d.barco_id, id || 0, d.data_fim, d.data_inicio);
        if (c) throw new HttpError(409, `Conflito de agenda com a reserva #${c.id}.`);
        const m = db.prepare(`SELECT id FROM manutencoes WHERE barco_id = ? AND status IN ('Aberta','Em andamento')
          AND COALESCE(data_prevista, '9999-12-31') >= ? AND data_abertura <= ?`).get(d.barco_id, d.data_inicio, d.data_fim);
        if (m) throw new HttpError(409, `Barco possui a manutenção #${m.id} em aberto no período.`);
      }
    },
    after(db, row) {
      if (row && ['Confirmada', 'Em andamento', 'Concluída'].includes(row.status) && Number(row.valor) > 0) {
        const barco = db.prepare('SELECT nome FROM barcos WHERE id = ?').get(row.barco_id);
        upsertLancamento(db, `RESERVA-${row.id}`, {
          tipo: 'Receita', categoria: 'Aluguel de barcos',
          descricao: `Reserva #${row.id} — ${barco?.nome || ''} (${row.data_inicio.slice(0, 10)})`,
          valor: row.valor, vencimento: row.data_inicio.slice(0, 10), cliente_id: row.cliente_id,
        });
      } else if (row && row.status === 'Cancelada') {
        db.prepare(`UPDATE lancamentos SET status = 'Cancelado' WHERE referencia = ? AND status = 'Pendente'`)
          .run(`RESERVA-${row.id}`);
      }
    },
  },

  lancamentos: {
    fields: ['tipo', 'categoria', 'descricao', 'valor', 'vencimento', 'data_pagamento', 'forma_pagamento', 'status', 'cliente_id'],
    required: ['tipo', 'categoria', 'descricao', 'valor', 'vencimento'],
    order: 'vencimento DESC, id DESC',
    adminDelete: true,
    validate(d) {
      checkIn(d.tipo, ['Receita', 'Despesa'], 'Tipo');
      checkIn(d.status, STATUS.lancamentos, 'Status');
      checkDate(d.vencimento, 'Vencimento');
      checkDate(d.data_pagamento, 'Data de pagamento');
      checkPositive(d.valor, 'Valor');
      if (d.status === 'Pago' && !d.data_pagamento) d.data_pagamento = today();
      if (d.status !== 'Pago') d.data_pagamento = null;
    },
  },
};

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function upsertLancamento(db, referencia, l) {
  const ex = db.prepare('SELECT id, status FROM lancamentos WHERE referencia = ?').get(referencia);
  if (ex) {
    if (ex.status === 'Pago') return; // não altera o que já foi recebido/pago
    db.prepare(`UPDATE lancamentos SET tipo=?, categoria=?, descricao=?, valor=?, vencimento=?, cliente_id=?, status='Pendente' WHERE id=?`)
      .run(l.tipo, l.categoria, l.descricao, l.valor, l.vencimento, l.cliente_id ?? null, ex.id);
  } else {
    db.prepare(`INSERT INTO lancamentos (tipo, categoria, descricao, valor, vencimento, cliente_id, referencia) VALUES (?,?,?,?,?,?,?)`)
      .run(l.tipo, l.categoria, l.descricao, l.valor, l.vencimento, l.cliente_id ?? null, referencia);
  }
}

/** Ocupação das vagas é derivada dos contratos ativos (vagas em manutenção/reservadas manualmente são preservadas). */
function syncVagas(db) {
  db.exec(`
    UPDATE vagas SET status = 'Ocupada'
      WHERE status <> 'Manutenção' AND id IN (SELECT vaga_id FROM contratos WHERE status <> 'Encerrado');
    UPDATE vagas SET status = 'Livre'
      WHERE status = 'Ocupada' AND id NOT IN (SELECT vaga_id FROM contratos WHERE status <> 'Encerrado');
  `);
}

/** Status do barco é derivado de OS em aberto e da última movimentação (inativos não são alterados). */
function syncBarcos(db) {
  db.exec(`
    UPDATE barcos SET status = CASE
      WHEN EXISTS (SELECT 1 FROM manutencoes m WHERE m.barco_id = barcos.id AND m.status IN ('Aberta','Em andamento'))
        THEN 'Em manutenção'
      WHEN (SELECT tipo FROM movimentacoes v WHERE v.barco_id = barcos.id ORDER BY data_hora DESC, id DESC LIMIT 1) = 'Saída'
        THEN 'Em uso'
      ELSE 'Ativo' END
    WHERE status <> 'Inativo';
  `);
}

module.exports = { RESOURCES, STATUS, HttpError, syncVagas, syncBarcos, upsertLancamento, today };
