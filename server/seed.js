'use strict';
const { syncVagas, syncBarcos, today } = require('./resources');

function addDays(n, base = today()) {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthOffset(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Insere dados de demonstração. Com onlyIfEmpty=true só roda em banco sem clientes. */
function seed(db, { onlyIfEmpty = true } = {}) {
  if (onlyIfEmpty && db.prepare('SELECT COUNT(*) n FROM clientes').get().n > 0) return false;

  const ins = (table, obj) => {
    const cols = Object.keys(obj);
    return Number(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => obj[c])).lastInsertRowid);
  };

  db.exec('BEGIN');
  try {
    const clientes = [
      ['Carlos Mendes', '123.456.789-00', '(21) 99876-5432', 'carlos.mendes@email.com', 'Av. Atlântica, 1200 — Rio de Janeiro/RJ', 'ARA-2019-0045'],
      ['Fernanda Lima', '987.654.321-00', '(21) 98765-1234', 'fernanda.lima@email.com', 'Rua das Gaivotas, 45 — Angra dos Reis/RJ', 'MSA-2021-0112'],
      ['Ricardo Souza', '456.789.123-00', '(11) 97654-3210', 'ricardo.souza@email.com', 'Rua Oscar Freire, 800 — São Paulo/SP', 'CPA-2015-0301'],
      ['Juliana Rocha', '321.654.987-00', '(21) 99123-4567', 'juliana.rocha@email.com', 'Estrada do Contorno, 90 — Paraty/RJ', null],
      ['Náutica Horizonte Ltda.', '12.345.678/0001-90', '(21) 3344-5566', 'contato@nauticahorizonte.com.br', 'Rua do Porto, 10 — Niterói/RJ', null],
      ['Marcos Albuquerque', '741.852.963-00', '(24) 99988-7766', 'marcos.alb@email.com', 'Condomínio Porto Bracuí — Angra dos Reis/RJ', 'ARA-2010-0007'],
    ].map(([nome, documento, telefone, email, endereco, habilitacao]) =>
      ins('clientes', { nome, documento, telefone, email, endereco, habilitacao }));

    const B = (o) => ins('barcos', o);
    const barcos = {
      vento: B({ nome: 'Vento Sul', tipo: 'Lancha', fabricante: 'Schaefer', modelo: 'Phantom 303', ano: 2021, comprimento_pes: 30, inscricao: '381-123456-7', motor: '2x Mercury 250hp', capacidade: 12, frota_propria: 1, valor_diaria: 3500, seguro_validade: addDays(20) }),
      mar: B({ nome: 'Mar Azul', tipo: 'Veleiro', fabricante: 'Beneteau', modelo: 'Oceanis 38', ano: 2018, comprimento_pes: 38, inscricao: '381-223344-1', motor: 'Yanmar 40hp', capacidade: 8, frota_propria: 1, valor_diaria: 2800, seguro_validade: addDays(200) }),
      jet: B({ nome: 'Raio', tipo: 'Jet Ski', fabricante: 'Sea-Doo', modelo: 'GTX 170', ano: 2023, comprimento_pes: 11, inscricao: '381-998877-0', motor: 'Rotax 170hp', capacidade: 3, frota_propria: 1, valor_diaria: 900, seguro_validade: addDays(120) }),
      estrela: B({ nome: 'Estrela do Mar', tipo: 'Lancha', fabricante: 'Fibrafort', modelo: 'Focker 242', ano: 2019, comprimento_pes: 24, inscricao: '381-556677-3', motor: 'Mercury 300hp', capacidade: 10, frota_propria: 1, valor_diaria: 2200, seguro_validade: addDays(-5) }),
      aurora: B({ nome: 'Aurora', tipo: 'Lancha', fabricante: 'Azimut', modelo: 'Atlantis 45', ano: 2020, comprimento_pes: 45, inscricao: '381-100200-9', motor: '2x Volvo IPS 600', capacidade: 14, cliente_id: clientes[0], seguro_validade: addDays(300) }),
      liberdade: B({ nome: 'Liberdade', tipo: 'Veleiro', fabricante: 'Jeanneau', modelo: 'Sun Odyssey 410', ano: 2017, comprimento_pes: 41, inscricao: '381-300400-2', motor: 'Yanmar 45hp', capacidade: 8, cliente_id: clientes[1], seguro_validade: addDays(90) }),
      tubarao: B({ nome: 'Tubarão Branco', tipo: 'Lancha', fabricante: 'Ferretti', modelo: 'Ferretti 500', ano: 2022, comprimento_pes: 50, inscricao: '381-500600-4', motor: '2x MAN 1000hp', capacidade: 16, cliente_id: clientes[2], seguro_validade: addDays(25) }),
      catamara: B({ nome: 'Brisa', tipo: 'Catamarã', fabricante: 'Lagoon', modelo: 'Lagoon 42', ano: 2019, comprimento_pes: 42, inscricao: '381-700800-6', motor: '2x Yanmar 57hp', capacidade: 12, cliente_id: clientes[4], seguro_validade: addDays(180) }),
      pesca: B({ nome: 'Pescador', tipo: 'Barco de pesca', fabricante: 'Levefort', modelo: 'Marajó 21', ano: 2015, comprimento_pes: 21, inscricao: '381-900100-8', motor: 'Yamaha 115hp', capacidade: 6, cliente_id: clientes[5], seguro_validade: addDays(60) }),
    };

    const vagas = {};
    const tiposVaga = [['A', 'Molhada', 50, 4500], ['B', 'Molhada', 40, 3200], ['C', 'Seca/Hangar', 30, 1800], ['P', 'Poita', 45, 1200]];
    for (const [pref, tipo, comp, tarifa] of tiposVaga) {
      for (let i = 1; i <= 6; i++) {
        const codigo = `${pref}-${String(i).padStart(2, '0')}`;
        vagas[codigo] = ins('vagas', { codigo, tipo, comprimento_max: comp, tarifa_mensal: tarifa, status: codigo === 'B-06' ? 'Manutenção' : 'Livre' });
      }
    }

    const contratos = [
      [clientes[0], barcos.aurora, vagas['A-01'], addDays(-400), 4500, 5],
      [clientes[1], barcos.liberdade, vagas['B-01'], addDays(-200), 3200, 10],
      [clientes[2], barcos.tubarao, vagas['A-02'], addDays(-90), 4800, 10],
      [clientes[4], barcos.catamara, vagas['A-03'], addDays(-300), 4500, 15],
      [clientes[5], barcos.pesca, vagas['C-01'], addDays(-60), 1800, 5],
      [null, barcos.vento, vagas['B-02'], addDays(-700), 0, 10],
      [null, barcos.mar, vagas['B-03'], addDays(-700), 0, 10],
      [null, barcos.jet, vagas['C-02'], addDays(-700), 0, 10],
      [null, barcos.estrela, vagas['C-03'], addDays(-700), 0, 10],
    ];
    // Barcos da frota própria ocupam vaga sem gerar mensalidade: contrato interno com a própria marina.
    const marinaCli = ins('clientes', { nome: 'Marina do Léo (frota própria)', observacoes: 'Cadastro interno para vagas da frota própria.' });
    const contratoIds = contratos.map(([cli, barco, vaga, inicio, valor, dia]) =>
      ins('contratos', { cliente_id: cli || marinaCli, barco_id: barco, vaga_id: vaga, data_inicio: inicio, valor_mensal: valor, dia_vencimento: dia,
        observacoes: cli ? null : 'Vaga da frota própria' }));

    // Mensalidades dos últimos 4 meses (3 anteriores pagos, mês atual parcialmente pago)
    for (let m = -5; m <= 0; m++) {
      const comp = monthOffset(m);
      contratos.forEach(([cli, , , , valor, dia], idx) => {
        if (!cli || !valor) return;
        const venc = `${comp}-${String(dia).padStart(2, '0')}`;
        const pago = m < 0 ? !(m === -1 && idx === 2) : idx % 2 === 0;
        ins('lancamentos', {
          tipo: 'Receita', categoria: 'Mensalidade de vaga', valor, vencimento: venc, cliente_id: cli,
          descricao: `Mensalidade ${comp.slice(5)}/${comp.slice(0, 4)}`, referencia: `CONTRATO-${contratoIds[idx]}-${comp}`,
          status: pago ? 'Pago' : 'Pendente', data_pagamento: pago ? venc : null, forma_pagamento: pago ? 'PIX' : null,
        });
      });
      const despesas = [['Energia elétrica', 'Conta de luz da marina', 3800], ['Folha de pagamento', 'Salários da equipe', 18500],
        ['Combustível', 'Diesel e gasolina para frota', 4200], ['Manutenção', 'Materiais de manutenção do píer', 1500]];
      for (const [categoria, descricao, valor] of despesas) {
        const venc = `${comp}-05`;
        const pago = m < 0 || categoria !== 'Folha de pagamento';
        ins('lancamentos', { tipo: 'Despesa', categoria, descricao: `${descricao} ${comp.slice(5)}/${comp.slice(0, 4)}`,
          valor: valor + (m * 137) % 400, vencimento: venc, status: pago ? 'Pago' : 'Pendente', data_pagamento: pago ? venc : null,
          forma_pagamento: pago ? 'Boleto' : null });
      }
      // Receita de aluguéis históricos
      if (m < 0) {
        ins('lancamentos', { tipo: 'Receita', categoria: 'Aluguel de barcos', descricao: `Aluguéis de lanchas ${comp.slice(5)}/${comp.slice(0, 4)}`,
          valor: 9000 + (m + 4) * 2100, vencimento: `${comp}-20`, status: 'Pago', data_pagamento: `${comp}-20`, forma_pagamento: 'Cartão' });
      }
    }

    // Reservas
    const reservas = [
      [barcos.vento, clientes[3], addDays(2), addDays(2), 1, 10, 3500, 'Confirmada'],
      [barcos.mar, clientes[1], addDays(5), addDays(7), 0, 6, 8400, 'Pendente'],
      [barcos.jet, clientes[3], addDays(1), addDays(1), 0, 2, 900, 'Confirmada'],
      [barcos.vento, clientes[2], addDays(-10), addDays(-10), 1, 8, 3500, 'Concluída'],
      [barcos.mar, clientes[5], addDays(12), addDays(14), 1, 4, 8400, 'Pendente'],
    ];
    for (const [barco_id, cliente_id, ini, fim, com_marinheiro, passageiros, valor, status] of reservas) {
      const id = ins('reservas', { barco_id, cliente_id, data_inicio: ini, data_fim: fim, com_marinheiro, passageiros, valor, status });
      if (status === 'Confirmada' || status === 'Concluída') {
        ins('lancamentos', { tipo: 'Receita', categoria: 'Aluguel de barcos', descricao: `Reserva #${id} — ${db.prepare('SELECT nome FROM barcos WHERE id = ?').get(barco_id).nome}`, valor, vencimento: ini,
          cliente_id, referencia: `RESERVA-${id}`, status: status === 'Concluída' ? 'Pago' : 'Pendente',
          data_pagamento: status === 'Concluída' ? ini : null, forma_pagamento: status === 'Concluída' ? 'PIX' : null });
      }
    }

    // Manutenções
    const manut = [
      [barcos.estrela, 'Corretiva', 'Troca da bomba d\'água do motor', 'Alta', addDays(-3), addDays(4), null, 'Oficina Náutica Angra', 2400, 'Em andamento'],
      [barcos.aurora, 'Preventiva', 'Revisão de 200 horas dos motores', 'Média', addDays(-1), addDays(10), null, 'Volvo Penta Autorizada', 8500, 'Aberta'],
      [barcos.vento, 'Limpeza', 'Limpeza de casco e aplicação de antiincrustante', 'Baixa', addDays(-30), addDays(-25), addDays(-26), 'Equipe interna', 1800, 'Concluída'],
      [barcos.jet, 'Preventiva', 'Troca de óleo e velas', 'Média', addDays(-60), addDays(-58), addDays(-58), 'Equipe interna', 450, 'Concluída'],
    ];
    for (const [barco_id, tipo, descricao, prioridade, ab, prev, concl, responsavel, custo, status] of manut) {
      ins('manutencoes', { barco_id, tipo, descricao, prioridade, data_abertura: ab, data_prevista: prev, data_conclusao: concl, responsavel, custo, status });
    }

    // Movimentações
    const agora = new Date();
    const dt = (diasAtras, h) => { const d = new Date(agora); d.setDate(d.getDate() - diasAtras); d.setHours(h, 0, 0, 0); return d.toISOString().slice(0, 16); };
    const movs = [
      [barcos.aurora, 'Saída', dt(3, 9), 'Carlos Mendes', 'Ilha Grande', 8],
      [barcos.aurora, 'Retorno', dt(3, 18), 'Carlos Mendes', null, 8],
      [barcos.tubarao, 'Saída', dt(0, 8), 'Ricardo Souza', 'Ilha da Gipóia', 10],
      [barcos.vento, 'Saída', dt(10, 9), 'Marinheiro João', 'Lagoa Azul', 8],
      [barcos.vento, 'Retorno', dt(10, 17), 'Marinheiro João', null, 8],
      [barcos.pesca, 'Descida', dt(1, 6), 'Equipe de pátio', null, null],
      [barcos.pesca, 'Saída', dt(1, 6), 'Marcos Albuquerque', 'Pesca oceânica', 3],
      [barcos.pesca, 'Retorno', dt(1, 15), 'Marcos Albuquerque', null, 3],
      [barcos.pesca, 'Içamento', dt(1, 16), 'Equipe de pátio', null, null],
    ];
    for (const [barco_id, tipo, data_hora, responsavel, destino, passageiros] of movs) {
      ins('movimentacoes', { barco_id, tipo, data_hora, responsavel, destino, passageiros });
    }

    syncVagas(db);
    syncBarcos(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return true;
}

module.exports = { seed };
