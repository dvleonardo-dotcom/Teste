'use strict';
/* Marina do Léo — frontend (SPA sem dependências) */
(() => {
  // ================= Utilitários =================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const NUM = new Intl.NumberFormat('pt-BR');
  const money = (v) => (v == null || v === '' ? '—' : BRL.format(v));
  const fdate = (v) => {
    if (!v) return '—';
    const [y, m, d] = v.slice(0, 10).split('-');
    return `${d}/${m}/${y}${v.length > 10 ? ' ' + v.slice(11, 16) : ''}`;
  };
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][m - 1]}/${y.slice(2)}`; };
  const daysBetween = (a, b) => Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 86400000);

  const BADGE = {
    ok: ['Ativo', 'Livre', 'Pago', 'Concluída', 'Confirmada', 'Receita', 'Retorno', 'admin'],
    warn: ['Em manutenção', 'Manutenção', 'Pendente', 'Em andamento', 'Aberta', 'Suspenso', 'Alta', 'Média'],
    info: ['Ocupada', 'Em uso', 'Reservada', 'Saída', 'operador'],
    bad: ['Cancelada', 'Cancelado', 'Inativo', 'Vencido', 'Urgente', 'Despesa'],
  };
  const badge = (s) => {
    const cls = Object.keys(BADGE).find((k) => BADGE[k].includes(s)) || '';
    return `<span class="badge ${cls}">${esc(s ?? '—')}</span>`;
  };

  const state = {
    token: localStorage.getItem('mdl_token'),
    user: JSON.parse(localStorage.getItem('mdl_user') || 'null'),
    refs: { clientes: [], barcos: [], vagas: [], contratos: [] },
    ui: {},
  };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') { logout(true); throw new Error(data.erro || 'Sessão expirada.'); }
    if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  async function loadRefs() {
    const [clientes, barcos, vagas, contratos] = await Promise.all(
      ['clientes', 'barcos', 'vagas', 'contratos'].map((r) => api(`/api/${r}`)));
    Object.assign(state.refs, { clientes, barcos, vagas, contratos });
  }
  const byId = (list, id) => state.refs[list].find((x) => x.id === Number(id));
  const clienteNome = (id) => byId('clientes', id)?.nome || '—';
  const barcoNome = (id) => byId('barcos', id)?.nome || '—';
  const vagaCodigo = (id) => byId('vagas', id)?.codigo || '—';
  const linkBarco = (id) => (id ? `<a href="#/barco/${id}">${esc(barcoNome(id))}</a>` : '—');
  const linkCliente = (id) => (id ? `<a href="#/cliente/${id}">${esc(clienteNome(id))}</a>` : '—');
  const statusLanc = (l) => (l.status === 'Pendente' && l.vencimento < todayISO() ? 'Vencido' : l.status);

  // ================= Modal de formulário =================
  function fieldHTML(f, value) {
    const id = `f_${f.name}`;
    const req = f.required ? 'required' : '';
    const full = f.full || f.type === 'textarea' ? ' full' : '';
    const v = value ?? '';
    let input;
    switch (f.type) {
      case 'textarea':
        input = `<textarea id="${id}" name="${f.name}" ${req}>${esc(v)}</textarea>`; break;
      case 'select': {
        const opts = typeof f.options === 'function' ? f.options() : f.options;
        input = `<select id="${id}" name="${f.name}" ${req}>${f.required ? '' : '<option value="">—</option>'}${opts.map((o) => {
          const [val, lab] = Array.isArray(o) ? o : [o, o];
          return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
        }).join('')}</select>`;
        break;
      }
      case 'ref': {
        const list = (f.filter ? state.refs[f.ref].filter(f.filter) : state.refs[f.ref]);
        const lab = f.refLabel || ((r) => r.nome);
        input = `<select id="${id}" name="${f.name}" ${req}><option value="">${f.required ? 'Selecione…' : '—'}</option>${list.map((r) =>
          `<option value="${r.id}" ${Number(v) === r.id ? 'selected' : ''}>${esc(lab(r))}</option>`).join('')}</select>`;
        break;
      }
      case 'check':
        return `<label class="check${full}"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
      case 'money':
        input = `<input id="${id}" name="${f.name}" type="number" step="0.01" min="0" value="${esc(v)}" ${req}>`; break;
      case 'number':
        input = `<input id="${id}" name="${f.name}" type="number" step="${f.step || 'any'}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} value="${esc(v)}" ${req}>`; break;
      case 'datetime':
        input = `<input id="${id}" name="${f.name}" type="datetime-local" value="${esc(String(v).slice(0, 16))}" ${req}>`; break;
      default:
        input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
    }
    return `<label class="${full.trim()}" for="${id}">${esc(f.label)}${f.required ? ' *' : ''}${input}</label>`;
  }

  function readForm(fields, form) {
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (!el) continue;
      if (f.type === 'check') out[f.name] = el.checked;
      else if (['number', 'money', 'ref'].includes(f.type)) out[f.name] = el.value === '' ? null : Number(el.value);
      else out[f.name] = el.value === '' ? null : el.value;
    }
    return out;
  }

  function openForm({ title, fields, data = {}, submitLabel = 'Salvar', onSubmit, onChange, extraButtons = '' }) {
    const dlg = $('#modal');
    const form = $('#modal-form');
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = fields.map((f) => fieldHTML(f, data[f.name] ?? (typeof f.default === 'function' ? f.default() : f.default))).join('');
    $('#modal-erro').textContent = '';
    $('#modal-foot').innerHTML = `${extraButtons}<button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary" value="ok">${esc(submitLabel)}</button>`;
    form.onchange = onChange ? (e) => onChange(form, e.target.name, readForm(fields, form)) : null;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const action = e.submitter?.value;
      if (action === 'cancel') return dlg.close();
      if (action && action !== 'ok') { const r = await onSubmit(null, action); if (r !== false) dlg.close(); return; }
      if (!form.reportValidity()) return;
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        await onSubmit(readForm(fields, form));
        dlg.close();
      } catch (err) {
        $('#modal-erro').textContent = err.message;
      } finally { if (btn) btn.disabled = false; }
    };
    dlg.showModal();
    setTimeout(() => $('#modal-body input, #modal-body select, #modal-body textarea')?.focus(), 30);
  }

  async function confirmDialog(msg) { return window.confirm(msg); }

  // ================= Definição dos cadastros =================
  const OPT = {
    tiposBarco: ['Lancha', 'Veleiro', 'Catamarã', 'Iate', 'Jet Ski', 'Barco de pesca', 'Bote/Inflável', 'Escuna', 'Outro'],
    tiposVaga: ['Molhada', 'Seca/Hangar', 'Poita', 'Píer flutuante'],
    tiposMov: ['Saída', 'Retorno', 'Içamento', 'Descida', 'Abastecimento', 'Lavagem'],
    tiposManut: ['Preventiva', 'Corretiva', 'Limpeza', 'Pintura', 'Elétrica', 'Motor', 'Vistoria', 'Outro'],
    prioridades: ['Baixa', 'Média', 'Alta', 'Urgente'],
    formasPag: ['PIX', 'Boleto', 'Cartão', 'Transferência', 'Dinheiro'],
    catReceita: ['Mensalidade de vaga', 'Aluguel de barcos', 'Serviços', 'Combustível', 'Diárias de visitante', 'Outros'],
    catDespesa: ['Folha de pagamento', 'Energia elétrica', 'Água', 'Combustível', 'Manutenção', 'Impostos', 'Seguros', 'Marketing', 'Outros'],
  };
  let META = { status: {} };

  const RES = {
    barcos: {
      title: 'Frota de barcos', singular: 'Barco', icon: '⛵',
      columns: [
        { label: 'Nome', get: (r) => r.nome, html: (r) => `<a href="#/barco/${r.id}"><strong>${esc(r.nome)}</strong></a><div class="small muted">${esc(r.inscricao || '')}</div>` },
        { label: 'Tipo', get: (r) => r.tipo },
        { label: 'Fabricante / modelo', get: (r) => [r.fabricante, r.modelo].filter(Boolean).join(' ') },
        { label: 'Pés', get: (r) => r.comprimento_pes, cls: 'num' },
        { label: 'Proprietário', get: (r) => (r.frota_propria ? 'Frota própria' : clienteNome(r.cliente_id)),
          html: (r) => (r.frota_propria ? '<span class="badge info">Frota própria</span>' : linkCliente(r.cliente_id)) },
        { label: 'Diária', get: (r) => r.valor_diaria, html: (r) => (r.frota_propria ? money(r.valor_diaria) : '—'), cls: 'num' },
        { label: 'Seguro', get: (r) => r.seguro_validade, html: (r) => {
          if (!r.seguro_validade) return '—';
          const d = daysBetween(todayISO(), r.seguro_validade);
          return d < 0 ? `<span class="badge bad">Vencido</span>` : d <= 30 ? `<span class="badge warn">${fdate(r.seguro_validade)}</span>` : fdate(r.seguro_validade);
        } },
        { label: 'Status', get: (r) => r.status, html: (r) => badge(r.status) },
      ],
      filters: [
        { key: 'status', label: 'Status', options: () => META.status.barcos },
        { key: 'prop', label: 'Propriedade', get: (r) => (r.frota_propria ? 'Frota própria' : 'Clientes'), options: ['Frota própria', 'Clientes'] },
        { key: 'tipo', label: 'Tipo', options: OPT.tiposBarco },
      ],
      fields: [
        { name: 'nome', label: 'Nome da embarcação', required: true },
        { name: 'tipo', label: 'Tipo', type: 'select', options: OPT.tiposBarco, required: true, default: 'Lancha' },
        { name: 'fabricante', label: 'Fabricante' },
        { name: 'modelo', label: 'Modelo' },
        { name: 'ano', label: 'Ano', type: 'number', min: 1900, max: 2100, step: 1 },
        { name: 'comprimento_pes', label: 'Comprimento (pés)', type: 'number', min: 0, step: 0.1 },
        { name: 'inscricao', label: 'Inscrição (Capitania)' },
        { name: 'motor', label: 'Motorização' },
        { name: 'capacidade', label: 'Capacidade (pessoas)', type: 'number', min: 0, step: 1 },
        { name: 'seguro_validade', label: 'Validade do seguro', type: 'date' },
        { name: 'frota_propria', label: 'Pertence à frota própria da marina (disponível para aluguel)', type: 'check', full: true },
        { name: 'cliente_id', label: 'Proprietário (cliente)', type: 'ref', ref: 'clientes' },
        { name: 'valor_diaria', label: 'Valor da diária de aluguel', type: 'money' },
        { name: 'status', label: 'Status', type: 'select', options: () => META.status.barcos, required: true, default: 'Ativo' },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
    },

    vagas: {
      title: 'Vagas da marina', singular: 'Vaga', icon: '⚓',
      columns: [
        { label: 'Código', get: (r) => r.codigo, html: (r) => `<strong>${esc(r.codigo)}</strong>` },
        { label: 'Tipo', get: (r) => r.tipo },
        { label: 'Comp. máx. (pés)', get: (r) => r.comprimento_max, cls: 'num' },
        { label: 'Tarifa mensal', get: (r) => r.tarifa_mensal, html: (r) => money(r.tarifa_mensal), cls: 'num' },
        { label: 'Ocupante', get: (r) => ocupante(r.id)?.barco || '', html: (r) => { const o = ocupante(r.id); return o ? `${linkBarco(o.barco_id)} <span class="small muted">· ${esc(clienteNome(o.cliente_id))}</span>` : '—'; } },
        { label: 'Status', get: (r) => r.status, html: (r) => badge(r.status) },
      ],
      filters: [
        { key: 'status', label: 'Status', options: () => META.status.vagas },
        { key: 'tipo', label: 'Tipo', options: OPT.tiposVaga },
      ],
      fields: [
        { name: 'codigo', label: 'Código', required: true, placeholder: 'Ex.: A-01' },
        { name: 'tipo', label: 'Tipo', type: 'select', options: OPT.tiposVaga, required: true },
        { name: 'comprimento_max', label: 'Comprimento máximo (pés)', type: 'number', min: 0, step: 0.1 },
        { name: 'tarifa_mensal', label: 'Tarifa mensal', type: 'money' },
        { name: 'status', label: 'Status', type: 'select', options: () => META.status.vagas, required: true, default: 'Livre' },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
      views: { mapa: 'Mapa', lista: 'Lista' },
    },

    clientes: {
      title: 'Clientes e proprietários', singular: 'Cliente', icon: '👤',
      columns: [
        { label: 'Nome', get: (r) => r.nome, html: (r) => `<a href="#/cliente/${r.id}"><strong>${esc(r.nome)}</strong></a>` },
        { label: 'CPF/CNPJ', get: (r) => r.documento },
        { label: 'Telefone', get: (r) => r.telefone, cls: 'nowrap' },
        { label: 'E-mail', get: (r) => r.email },
        { label: 'Barcos', get: (r) => state.refs.barcos.filter((b) => b.cliente_id === r.id).length, cls: 'num' },
        { label: 'Habilitação', get: (r) => r.habilitacao },
      ],
      fields: [
        { name: 'nome', label: 'Nome / Razão social', required: true, full: true },
        { name: 'documento', label: 'CPF / CNPJ' },
        { name: 'habilitacao', label: 'Habilitação náutica (Arrais/Mestre)' },
        { name: 'telefone', label: 'Telefone', type: 'tel' },
        { name: 'email', label: 'E-mail', type: 'email' },
        { name: 'endereco', label: 'Endereço', full: true },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
    },

    contratos: {
      title: 'Contratos de vaga', singular: 'Contrato', icon: '📄',
      columns: [
        { label: '#', get: (r) => r.id, cls: 'num' },
        { label: 'Cliente', get: (r) => clienteNome(r.cliente_id), html: (r) => linkCliente(r.cliente_id) },
        { label: 'Barco', get: (r) => barcoNome(r.barco_id), html: (r) => linkBarco(r.barco_id) },
        { label: 'Vaga', get: (r) => vagaCodigo(r.vaga_id), html: (r) => `<strong>${esc(vagaCodigo(r.vaga_id))}</strong>` },
        { label: 'Início', get: (r) => r.data_inicio, html: (r) => fdate(r.data_inicio), cls: 'nowrap' },
        { label: 'Término', get: (r) => r.data_fim, html: (r) => fdate(r.data_fim), cls: 'nowrap' },
        { label: 'Mensalidade', get: (r) => r.valor_mensal, html: (r) => money(r.valor_mensal), cls: 'num' },
        { label: 'Venc.', get: (r) => r.dia_vencimento, html: (r) => `dia ${r.dia_vencimento}`, cls: 'nowrap' },
        { label: 'Status', get: (r) => r.status, html: (r) => badge(r.status) },
      ],
      filters: [{ key: 'status', label: 'Status', options: () => META.status.contratos }],
      fields: [
        { name: 'cliente_id', label: 'Cliente', type: 'ref', ref: 'clientes', required: true },
        { name: 'barco_id', label: 'Barco', type: 'ref', ref: 'barcos', required: true, refLabel: (b) => `${b.nome} (${b.comprimento_pes || '?'} pés)` },
        { name: 'vaga_id', label: 'Vaga', type: 'ref', ref: 'vagas', required: true,
          refLabel: (v) => `${v.codigo} — ${v.tipo}, até ${v.comprimento_max || '?'} pés (${v.status})` },
        { name: 'valor_mensal', label: 'Valor mensal', type: 'money', required: true },
        { name: 'data_inicio', label: 'Início', type: 'date', required: true, default: todayISO },
        { name: 'data_fim', label: 'Término (opcional)', type: 'date' },
        { name: 'dia_vencimento', label: 'Dia de vencimento', type: 'number', min: 1, max: 28, step: 1, default: 10, required: true },
        { name: 'status', label: 'Status', type: 'select', options: () => META.status.contratos, required: true, default: 'Ativo' },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
      onChange(form, name, data) {
        if (name === 'vaga_id' && data.vaga_id && !form.elements.valor_mensal.value) {
          form.elements.valor_mensal.value = byId('vagas', data.vaga_id)?.tarifa_mensal ?? '';
        }
        if (name === 'barco_id' && data.barco_id && !form.elements.cliente_id.value) {
          const b = byId('barcos', data.barco_id); if (b?.cliente_id) form.elements.cliente_id.value = b.cliente_id;
        }
      },
    },

    reservas: {
      title: 'Reservas e aluguéis', singular: 'Reserva', icon: '📅',
      columns: [
        { label: '#', get: (r) => r.id, cls: 'num' },
        { label: 'Barco', get: (r) => barcoNome(r.barco_id), html: (r) => linkBarco(r.barco_id) },
        { label: 'Cliente', get: (r) => clienteNome(r.cliente_id), html: (r) => linkCliente(r.cliente_id) },
        { label: 'Início', get: (r) => r.data_inicio, html: (r) => fdate(r.data_inicio), cls: 'nowrap' },
        { label: 'Fim', get: (r) => r.data_fim, html: (r) => fdate(r.data_fim), cls: 'nowrap' },
        { label: 'Pass.', get: (r) => r.passageiros, cls: 'num' },
        { label: 'Marinheiro', get: (r) => (r.com_marinheiro ? 'Sim' : 'Não') },
        { label: 'Valor', get: (r) => r.valor, html: (r) => money(r.valor), cls: 'num' },
        { label: 'Status', get: (r) => r.status, html: (r) => badge(r.status) },
      ],
      filters: [{ key: 'status', label: 'Status', options: () => META.status.reservas }],
      fields: [
        { name: 'barco_id', label: 'Barco (frota própria)', type: 'ref', ref: 'barcos', required: true,
          filter: (b) => b.frota_propria && b.status !== 'Inativo', refLabel: (b) => `${b.nome} — ${b.tipo} · ${money(b.valor_diaria)}/dia` },
        { name: 'cliente_id', label: 'Cliente', type: 'ref', ref: 'clientes', required: true },
        { name: 'data_inicio', label: 'Data de início', type: 'date', required: true, default: todayISO },
        { name: 'data_fim', label: 'Data de fim', type: 'date', required: true, default: todayISO },
        { name: 'passageiros', label: 'Passageiros', type: 'number', min: 1, step: 1 },
        { name: 'valor', label: 'Valor total', type: 'money' },
        { name: 'com_marinheiro', label: 'Com marinheiro (skipper)', type: 'check' },
        { name: 'status', label: 'Status', type: 'select', options: () => META.status.reservas, required: true, default: 'Pendente' },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
      onChange(form, name, data) {
        if (['barco_id', 'data_inicio', 'data_fim'].includes(name) && data.barco_id && data.data_inicio && data.data_fim) {
          const b = byId('barcos', data.barco_id);
          const dias = Math.max(1, daysBetween(data.data_inicio, data.data_fim) + 1);
          if (b?.valor_diaria) form.elements.valor.value = (b.valor_diaria * dias).toFixed(2);
        }
        if (name === 'data_inicio' && data.data_fim && data.data_fim < data.data_inicio) form.elements.data_fim.value = data.data_inicio;
      },
      views: { lista: 'Lista', calendario: 'Calendário' },
    },

    movimentacoes: {
      title: 'Movimentações', singular: 'Movimentação', icon: '🧭',
      columns: [
        { label: 'Data/hora', get: (r) => r.data_hora, html: (r) => fdate(r.data_hora), cls: 'nowrap' },
        { label: 'Barco', get: (r) => barcoNome(r.barco_id), html: (r) => linkBarco(r.barco_id) },
        { label: 'Tipo', get: (r) => r.tipo, html: (r) => badge(r.tipo) },
        { label: 'Responsável', get: (r) => r.responsavel },
        { label: 'Destino', get: (r) => r.destino },
        { label: 'Pass.', get: (r) => r.passageiros, cls: 'num' },
        { label: 'Combustível', get: (r) => r.combustivel },
      ],
      filters: [{ key: 'tipo', label: 'Tipo', options: OPT.tiposMov }],
      fields: [
        { name: 'barco_id', label: 'Barco', type: 'ref', ref: 'barcos', required: true },
        { name: 'tipo', label: 'Tipo', type: 'select', options: OPT.tiposMov, required: true },
        { name: 'data_hora', label: 'Data e hora', type: 'datetime', required: true, default: nowLocal },
        { name: 'responsavel', label: 'Responsável / comandante' },
        { name: 'destino', label: 'Destino / roteiro' },
        { name: 'passageiros', label: 'Passageiros', type: 'number', min: 0, step: 1 },
        { name: 'combustivel', label: 'Combustível (nível ou litros)' },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
    },

    manutencoes: {
      title: 'Manutenções (ordens de serviço)', singular: 'Ordem de serviço', icon: '🔧',
      columns: [
        { label: 'OS', get: (r) => r.id, html: (r) => `#${r.id}`, cls: 'num' },
        { label: 'Barco', get: (r) => barcoNome(r.barco_id), html: (r) => linkBarco(r.barco_id) },
        { label: 'Tipo', get: (r) => r.tipo },
        { label: 'Descrição', get: (r) => r.descricao },
        { label: 'Prioridade', get: (r) => OPT.prioridades.indexOf(r.prioridade), html: (r) => badge(r.prioridade) },
        { label: 'Previsão', get: (r) => r.data_prevista, html: (r) => {
          const atras = r.data_prevista && r.data_prevista < todayISO() && ['Aberta', 'Em andamento'].includes(r.status);
          return `<span class="${atras ? 'badge bad' : ''}">${fdate(r.data_prevista)}</span>`;
        }, cls: 'nowrap' },
        { label: 'Responsável', get: (r) => r.responsavel },
        { label: 'Custo', get: (r) => r.custo, html: (r) => money(r.custo), cls: 'num' },
        { label: 'Status', get: (r) => r.status, html: (r) => badge(r.status) },
      ],
      filters: [
        { key: 'status', label: 'Status', options: () => META.status.manutencoes },
        { key: 'prioridade', label: 'Prioridade', options: OPT.prioridades },
      ],
      fields: [
        { name: 'barco_id', label: 'Barco', type: 'ref', ref: 'barcos', required: true },
        { name: 'tipo', label: 'Tipo', type: 'select', options: OPT.tiposManut, required: true, default: 'Preventiva' },
        { name: 'descricao', label: 'Descrição do serviço', required: true, full: true },
        { name: 'prioridade', label: 'Prioridade', type: 'select', options: OPT.prioridades, required: true, default: 'Média' },
        { name: 'responsavel', label: 'Responsável / oficina' },
        { name: 'data_abertura', label: 'Abertura', type: 'date', required: true, default: todayISO },
        { name: 'data_prevista', label: 'Previsão de entrega', type: 'date' },
        { name: 'data_conclusao', label: 'Conclusão', type: 'date' },
        { name: 'custo', label: 'Custo', type: 'money' },
        { name: 'status', label: 'Status', type: 'select', options: () => META.status.manutencoes, required: true, default: 'Aberta' },
        { name: 'observacoes', label: 'Observações', type: 'textarea' },
      ],
      note: 'Ao concluir uma OS com custo, o sistema lança automaticamente uma despesa (frota própria) ou uma cobrança ao proprietário (barco de cliente).',
    },

    lancamentos: {
      title: 'Financeiro', singular: 'Lançamento', icon: '💰',
      columns: [
        { label: 'Vencimento', get: (r) => r.vencimento, html: (r) => fdate(r.vencimento), cls: 'nowrap' },
        { label: 'Tipo', get: (r) => r.tipo, html: (r) => badge(r.tipo) },
        { label: 'Categoria', get: (r) => r.categoria },
        { label: 'Descrição', get: (r) => r.descricao },
        { label: 'Cliente', get: (r) => (r.cliente_id ? clienteNome(r.cliente_id) : ''), html: (r) => linkCliente(r.cliente_id) },
        { label: 'Valor', get: (r) => (r.tipo === 'Despesa' ? -r.valor : r.valor),
          html: (r) => `<span style="color:var(--${r.tipo === 'Despesa' ? 'bad' : 'ok'})">${r.tipo === 'Despesa' ? '−' : ''}${money(r.valor)}</span>`, cls: 'num' },
        { label: 'Pagamento', get: (r) => r.data_pagamento, html: (r) => (r.data_pagamento ? `${fdate(r.data_pagamento)}<div class="small muted">${esc(r.forma_pagamento || '')}</div>` : '—'), cls: 'nowrap' },
        { label: 'Status', get: (r) => statusLanc(r), html: (r) => badge(statusLanc(r)) },
      ],
      filters: [
        { key: 'mes', label: 'Mês', get: (r) => r.vencimento.slice(0, 7),
          options: (rows) => [...new Set(rows.map((r) => r.vencimento.slice(0, 7)))].sort().reverse().map((m) => [m, monthLabel(m)]) },
        { key: 'tipo', label: 'Tipo', options: ['Receita', 'Despesa'] },
        { key: 'st', label: 'Status', get: statusLanc, options: ['Pendente', 'Vencido', 'Pago', 'Cancelado'] },
        { key: 'categoria', label: 'Categoria', options: [...new Set([...OPT.catReceita, ...OPT.catDespesa])] },
      ],
      fields: [
        { name: 'tipo', label: 'Tipo', type: 'select', options: ['Receita', 'Despesa'], required: true, default: 'Receita' },
        { name: 'categoria', label: 'Categoria', type: 'select', options: [...new Set([...OPT.catReceita, ...OPT.catDespesa])], required: true },
        { name: 'descricao', label: 'Descrição', required: true, full: true },
        { name: 'valor', label: 'Valor', type: 'money', required: true },
        { name: 'vencimento', label: 'Vencimento', type: 'date', required: true, default: todayISO },
        { name: 'cliente_id', label: 'Cliente (opcional)', type: 'ref', ref: 'clientes' },
        { name: 'status', label: 'Status', type: 'select', options: () => META.status.lancamentos, required: true, default: 'Pendente' },
        { name: 'data_pagamento', label: 'Data do pagamento', type: 'date' },
        { name: 'forma_pagamento', label: 'Forma de pagamento', type: 'select', options: OPT.formasPag },
      ],
      rowActions: (r) => (r.status === 'Pendente' ? `<button class="btn btn-sm" data-act="baixar" data-id="${r.id}">✓ Baixar</button>` : ''),
      summary: true,
    },
  };

  const ocupante = (vagaId) => state.refs.contratos.find((c) => c.vaga_id === vagaId && c.status !== 'Encerrado');

  // ================= Visão genérica de listagem =================
  async function listView(key) {
    const cfg = RES[key];
    const ui = (state.ui[key] ||= { q: '', filters: key === 'lancamentos' ? { mes: todayISO().slice(0, 7) } : {}, sort: null, dir: 1, view: cfg.views ? Object.keys(cfg.views)[0] : null, month: todayISO().slice(0, 7) });
    const [rows] = await Promise.all([api(`/api/${key}`), loadRefs()]);
    const view = $('#view');

    const filtered = () => {
      const q = ui.q.trim().toLowerCase();
      let out = rows.filter((r) => {
        for (const f of cfg.filters || []) {
          const v = ui.filters[f.key];
          if (v && String(f.get ? f.get(r) : r[f.key]) !== v) return false;
        }
        if (!q) return true;
        return cfg.columns.some((c) => String(c.get(r) ?? '').toLowerCase().includes(q));
      });
      if (ui.sort != null) {
        const c = cfg.columns[ui.sort];
        out = [...out].sort((a, b) => {
          const x = c.get(a); const y = c.get(b);
          if (x == null || x === '') return 1; if (y == null || y === '') return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * ui.dir;
        });
      }
      return out;
    };

    const filterSelects = (cfg.filters || []).map((f) => {
      const opts = typeof f.options === 'function' ? f.options(rows) : f.options;
      return `<select data-filter="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: todos</option>${(opts || []).map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(v)}" ${ui.filters[f.key] === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
      }).join('')}</select>`;
    }).join('');

    const viewToggle = cfg.views ? `<div class="btn-group">${Object.entries(cfg.views).map(([k, l]) =>
      `<button class="btn btn-sm ${ui.view === k ? 'btn-primary' : ''}" data-view="${k}">${esc(l)}</button>`).join(' ')}</div>` : '';

    const extraTop = key === 'lancamentos'
      ? `<button class="btn" id="gerar-mens">⟳ Gerar mensalidades</button>` : '';

    view.innerHTML = `
      ${cfg.summary ? '<div class="grid kpis six" id="summary"></div>' : ''}
      <div class="toolbar">
        <input type="search" class="search" placeholder="Buscar…" value="${esc(ui.q)}" aria-label="Buscar">
        ${filterSelects}
        <span class="spacer"></span>
        ${viewToggle}
        ${extraTop}
        <button class="btn" id="csv" title="Exportar para planilha">⇩ CSV</button>
        <button class="btn btn-primary" id="novo">+ ${esc(cfg.singular)}</button>
      </div>
      ${cfg.note ? `<p class="muted small" style="margin:-4px 0 12px">${esc(cfg.note)}</p>` : ''}
      <div class="card" id="content"></div>`;

    const content = $('#content');

    const renderTable = () => {
      const data = filtered();
      if (cfg.summary) renderSummary(data);
      if (ui.view === 'mapa') return renderBerthMap(content, data);
      if (ui.view === 'calendario') return renderCalendar(content, data, ui, renderTable);
      if (!data.length) { content.innerHTML = `<div class="empty">Nenhum registro encontrado.</div>`; return; }
      content.innerHTML = `<div class="table-wrap"><table>
        <thead><tr>${cfg.columns.map((c, i) => `<th data-sort="${i}" class="${ui.sort === i ? `sorted ${ui.dir > 0 ? 'asc' : ''}` : ''} ${c.cls || ''}">${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${data.map((r) => `<tr>${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.html ? c.html(r) : esc(c.get(r) ?? '—')}</td>`).join('')}
          <td class="actions">${cfg.rowActions ? cfg.rowActions(r) : ''}
            <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}" title="Editar">✎</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-act="del" data-id="${r.id}" title="Excluir">🗑</button></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="table-foot"><span>${NUM.format(data.length)} de ${NUM.format(rows.length)} registro(s)</span></div>`;
    };

    const renderSummary = (data) => {
      const sum = (fn) => data.filter(fn).reduce((s, r) => s + Number(r.valor || 0), 0);
      const rec = sum((r) => r.tipo === 'Receita' && r.status === 'Pago');
      const desp = sum((r) => r.tipo === 'Despesa' && r.status === 'Pago');
      const aRec = sum((r) => r.tipo === 'Receita' && r.status === 'Pendente');
      const venc = sum((r) => r.tipo === 'Receita' && statusLanc(r) === 'Vencido');
      const aPag = sum((r) => r.tipo === 'Despesa' && r.status === 'Pendente');
      $('#summary').innerHTML = [
        ['Recebido', money(rec), 'ok'], ['Pago (despesas)', money(desp), ''], ['Saldo realizado', money(rec - desp), rec - desp >= 0 ? 'ok' : 'bad'],
        ['A receber', money(aRec), ''], ['Vencido', money(venc), venc > 0 ? 'bad' : ''], ['A pagar', money(aPag), ''],
      ].map(([l, v, c]) => `<div class="card kpi ${c}"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">conforme filtros</div></div>`).join('');
    };

    const openEdit = (row) => {
      openForm({
        title: row ? `Editar ${cfg.singular.toLowerCase()}` : `Novo(a) ${cfg.singular.toLowerCase()}`,
        fields: cfg.fields,
        data: row || {},
        onChange: cfg.onChange,
        onSubmit: async (data) => {
          await api(row ? `/api/${key}/${row.id}` : `/api/${key}`, { method: row ? 'PUT' : 'POST', body: data });
          toast(row ? 'Registro atualizado.' : 'Registro criado.');
          route();
        },
      });
    };

    view.oninput = (e) => { if (e.target.matches('.search')) { ui.q = e.target.value; renderTable(); } };
    view.onchange = (e) => { if (e.target.dataset.filter) { ui.filters[e.target.dataset.filter] = e.target.value; renderTable(); } };
    view.onclick = async (e) => {
      const t = e.target.closest('button, th, [data-edit]');
      if (!t) return;
      if (t.dataset.sort != null) { const i = Number(t.dataset.sort); ui.dir = ui.sort === i ? -ui.dir : 1; ui.sort = i; return renderTable(); }
      if (t.dataset.view) { ui.view = t.dataset.view; return listView(key); }
      if (t.id === 'novo') return openEdit(null);
      if (t.id === 'csv') return exportCSV(cfg, filtered(), key);
      if (t.id === 'gerar-mens') return gerarMensalidades();
      const id = Number(t.dataset.id || t.dataset.edit);
      const row = rows.find((r) => r.id === id);
      if (t.dataset.edit || t.dataset.act === 'edit') return openEdit(row);
      if (t.dataset.act === 'del') {
        if (!(await confirmDialog(`Excluir este registro (${cfg.singular} #${id})? Esta ação não pode ser desfeita.`))) return;
        try { await api(`/api/${key}/${id}`, { method: 'DELETE' }); toast('Registro excluído.'); route(); } catch (err) { toast(err.message, true); }
      }
      if (t.dataset.act === 'baixar') return baixar(row);
    };

    renderTable();
  }

  function exportCSV(cfg, data, key) {
    const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cfg.columns.map((c) => cell(c.label)).join(';')];
    for (const r of data) lines.push(cfg.columns.map((c) => { const v = c.get(r); return cell(typeof v === 'number' ? String(v).replace('.', ',') : v); }).join(';'));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `marina-do-leo-${key}-${todayISO()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function gerarMensalidades() {
    openForm({
      title: 'Gerar mensalidades dos contratos',
      fields: [{ name: 'competencia', label: 'Competência (mês)', type: 'month', required: true, default: todayISO().slice(0, 7), full: true }],
      submitLabel: 'Gerar',
      onSubmit: async (d) => {
        const r = await api('/api/financeiro/gerar-mensalidades', { method: 'POST', body: d });
        toast(`${r.criados} mensalidade(s) gerada(s) para ${monthLabel(r.competencia)} — ${r.contratos} contrato(s) ativo(s).`);
        route();
      },
    });
  }

  function baixar(row) {
    openForm({
      title: `Registrar pagamento — ${row.descricao}`,
      fields: [
        { name: 'data_pagamento', label: 'Data do pagamento', type: 'date', required: true, default: todayISO },
        { name: 'forma_pagamento', label: 'Forma de pagamento', type: 'select', options: OPT.formasPag, required: true, default: 'PIX' },
      ],
      submitLabel: `Confirmar ${money(row.valor)}`,
      onSubmit: async (d) => { await api(`/api/lancamentos/${row.id}/baixar`, { method: 'POST', body: d }); toast('Pagamento registrado.'); route(); },
    });
  }

  // ================= Mapa de vagas =================
  function renderBerthMap(el, data) {
    if (!data.length) { el.innerHTML = '<div class="empty">Nenhuma vaga encontrada.</div>'; return; }
    const groups = {};
    for (const v of data) (groups[v.tipo] ||= []).push(v);
    const counts = (st) => data.filter((v) => v.status === st).length;
    el.innerHTML = `<div class="card-head"><h3>Mapa da marina</h3><div class="legend">
        <span><i style="background:var(--ok)"></i>Livre (${counts('Livre')})</span>
        <span><i style="background:var(--primary)"></i>Ocupada (${counts('Ocupada')})</span>
        <span><i style="background:var(--info)"></i>Reservada (${counts('Reservada')})</span>
        <span><i style="background:var(--warn)"></i>Manutenção (${counts('Manutenção')})</span></div></div>
      ${Object.entries(groups).map(([tipo, vs]) => `<div class="berth-group">${esc(tipo)}</div><div class="berth-map">${vs
        .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })).map((v) => {
          const o = ocupante(v.id);
          return `<button class="berth ${esc(v.status)}" data-edit="${v.id}" title="Editar vaga ${esc(v.codigo)}">
            <div class="code">${esc(v.codigo)}</div>
            <div class="meta">${o ? `⛵ ${esc(barcoNome(o.barco_id))}` : esc(v.status)}</div>
            <div class="meta">até ${esc(v.comprimento_max ?? '?')} pés · ${money(v.tarifa_mensal)}</div></button>`;
        }).join('')}</div>`).join('')}<div style="height:16px"></div>`;
  }

  // ================= Calendário de reservas =================
  function renderCalendar(el, data, ui, rerender) {
    const [y, m] = ui.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const hoje = todayISO();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ativos = data.filter((r) => r.status !== 'Cancelada');
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const di = iso(d);
      const evs = ativos.filter((r) => r.data_inicio.slice(0, 10) <= di && r.data_fim.slice(0, 10) >= di);
      cells += `<div class="day ${d.getMonth() !== m - 1 ? 'out' : ''} ${di === hoje ? 'today' : ''}"><span class="dn">${d.getDate()}</span>
        ${evs.map((r) => `<button class="ev ${esc(r.status)}" data-edit="${r.id}" title="${esc(`${barcoNome(r.barco_id)} — ${clienteNome(r.cliente_id)} (${r.status})`)}">${esc(barcoNome(r.barco_id))}</button>`).join('')}</div>`;
    }
    const mesNome = first.toLocaleDateString('pt-BR', { month: 'long' });
    const nome = `${mesNome[0].toUpperCase()}${mesNome.slice(1)} de ${y}`;
    el.innerHTML = `<div class="card-head"><button class="btn btn-sm" data-cal="-1">‹</button><h3>${esc(nome)}</h3><button class="btn btn-sm" data-cal="1">›</button></div>
      <div class="cal">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>`;
    $$('[data-cal]', el).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = new Date(y, m - 1 + Number(b.dataset.cal), 1);
      ui.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      rerender();
    }));
  }

  // ================= Painel =================
  async function dashboard() {
    const [d] = await Promise.all([api('/api/dashboard'), loadRefs()]);
    const pctOcup = d.vagas.total ? Math.round((d.vagas.ocupadas / d.vagas.total) * 100) : 0;
    const saldo = d.financeiro.receita_mes - d.financeiro.despesa_mes;
    const kpi = (label, value, sub, cls = '', meter) => `<div class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>
      <div class="sub">${sub}</div>${meter != null ? `<div class="meter"><div style="width:${meter}%"></div></div>` : ''}</div>`;
    const li = (items, fn, empty) => (items.length ? `<ul class="list">${items.map(fn).join('')}</ul>` : `<div class="empty">${empty}</div>`);

    $('#view').innerHTML = `
      <div class="grid kpis six">
        ${kpi('Ocupação da marina', `${pctOcup}%`, `${d.vagas.ocupadas || 0} de ${d.vagas.total} vagas · ${d.vagas.livres || 0} livres`, '', pctOcup)}
        ${kpi('Embarcações', NUM.format(d.barcos.total || 0), `${d.barcos.frota || 0} da frota própria · ${d.barcos.em_uso || 0} navegando`)}
        ${kpi('Receita do mês', money(d.financeiro.receita_mes), `Saldo: ${money(saldo)}`, 'ok')}
        ${kpi('A receber', money(d.financeiro.a_receber), `${money(d.financeiro.a_pagar)} a pagar`)}
        ${kpi('Inadimplência', money(d.financeiro.vencido), `${d.financeiro.qtd_vencido} cobrança(s) vencida(s)`, d.financeiro.vencido > 0 ? 'bad' : '')}
        ${kpi('Manutenções abertas', NUM.format(d.manutencoes_abertas.length), `${d.barcos.manutencao || 0} barco(s) parado(s)`, d.manutencoes_abertas.length ? '' : 'ok')}
      </div>
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h3>Receitas × despesas (6 meses)</h3><div class="legend"><span><i style="background:var(--primary)"></i>Receitas</span><span><i style="background:var(--accent);opacity:.55"></i>Despesas</span></div></div>
          <div class="chart">${barChart(d.historico)}</div></div>
        <div class="card"><div class="card-head"><h3>Próximas reservas</h3><a href="#/reservas" class="small">ver todas</a></div>
          ${li(d.reservas_proximas, (r) => `<li><div><div class="t">${esc(r.barco)} · ${esc(r.cliente)}</div><div class="small muted">${fdate(r.data_inicio)}${r.data_fim !== r.data_inicio ? ' → ' + fdate(r.data_fim) : ''}${r.com_marinheiro ? ' · com marinheiro' : ''}</div></div>${badge(r.status)}</li>`, 'Nenhuma reserva futura.')}</div>
        <div class="card"><div class="card-head"><h3>Manutenções em aberto</h3><a href="#/manutencoes" class="small">ver todas</a></div>
          ${li(d.manutencoes_abertas, (m) => `<li><div><div class="t">${esc(m.barco)} — ${esc(m.descricao)}</div><div class="small muted">OS #${m.id} · previsão ${fdate(m.data_prevista)} · ${esc(m.responsavel || 'sem responsável')}</div></div>${badge(m.prioridade)}</li>`, 'Nenhuma manutenção pendente. ✓')}</div>
        <div class="card"><div class="card-head"><h3>Barcos navegando agora</h3><a href="#/movimentacoes" class="small">movimentações</a></div>
          ${li(d.barcos_fora, (b) => `<li><div><div class="t"><a href="#/barco/${b.id}">${esc(b.nome)}</a></div><div class="small muted">Saiu ${fdate(b.data_hora)}${b.destino ? ' → ' + esc(b.destino) : ''} · ${esc(b.responsavel || '')}</div></div><button class="btn btn-sm" data-retorno="${b.id}">Registrar retorno</button></li>`, 'Todos os barcos estão na marina.')}</div>
        <div class="card"><div class="card-head"><h3>Cobranças vencidas</h3><a href="#/financeiro" class="small">financeiro</a></div>
          ${li(d.inadimplentes, (l) => `<li><div><div class="t">${esc(l.cliente || '—')}</div><div class="small muted">${esc(l.descricao)} · venceu ${fdate(l.vencimento)}</div></div><strong class="num">${money(l.valor)}</strong></li>`, 'Nenhuma cobrança vencida. ✓')}</div>
        <div class="card"><div class="card-head"><h3>Seguros vencidos / vencendo em 30 dias</h3><a href="#/barcos" class="small">frota</a></div>
          ${li(d.seguros_vencendo, (b) => `<li><a href="#/barco/${b.id}" class="t">${esc(b.nome)}</a>${b.seguro_validade < d.hoje ? '<span class="badge bad">Vencido</span>' : `<span class="badge warn">${fdate(b.seguro_validade)}</span>`}</li>`, 'Nenhum seguro a vencer. ✓')}</div>
      </div>`;

    $('#view').onclick = (e) => {
      const b = e.target.closest('[data-retorno]');
      if (!b) return;
      openForm({
        title: `Registrar retorno — ${barcoNome(b.dataset.retorno)}`,
        fields: RES.movimentacoes.fields,
        data: { barco_id: Number(b.dataset.retorno), tipo: 'Retorno', data_hora: nowLocal() },
        onSubmit: async (data) => { await api('/api/movimentacoes', { method: 'POST', body: data }); toast('Retorno registrado.'); route(); },
      });
    };
    $('#view').oninput = $('#view').onchange = null;
  }

  function barChart(hist) {
    const W = 560; const H = 220; const pad = { l: 56, r: 8, t: 10, b: 26 };
    const max = Math.max(1, ...hist.flatMap((h) => [h.receita, h.despesa]));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step) * step;
    const gw = (W - pad.l - pad.r) / hist.length;
    const bw = Math.min(26, gw / 3);
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    const short = (v) => (v >= 1000 ? `${NUM.format(Math.round(v / 1000))} mil` : NUM.format(v));
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de receitas e despesas">`;
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i;
      s += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`;
    }
    hist.forEach((h, i) => {
      const cx = pad.l + gw * i + gw / 2;
      s += `<rect class="bar-r" x="${cx - bw - 1}" y="${y(h.receita)}" width="${bw}" height="${y(0) - y(h.receita)}" rx="3"><title>Receitas ${monthLabel(h.mes)}: ${money(h.receita)}</title></rect>`;
      s += `<rect class="bar-d" x="${cx + 1}" y="${y(h.despesa)}" width="${bw}" height="${y(0) - y(h.despesa)}" rx="3"><title>Despesas ${monthLabel(h.mes)}: ${money(h.despesa)}</title></rect>`;
      s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(h.mes)}</text>`;
    });
    return s + '</svg>';
  }

  // ================= Detalhes =================
  const tableOf = (cols, rows, empty = 'Nenhum registro.') => (rows.length
    ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
      `<tr>${cols.map((c) => `<td class="${c[2] || ''}">${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${empty}</div>`);

  function tabbed(tabs) {
    const keys = Object.keys(tabs);
    return `<div class="card" style="margin-top:16px"><div class="tabs">${keys.map((k, i) => `<button data-tab="${i}" class="${i ? '' : 'active'}">${esc(k)} (${tabs[k].n})</button>`).join('')}</div>
      ${keys.map((k, i) => `<div data-pane="${i}" class="${i ? 'hidden' : ''}">${tabs[k].html}</div>`).join('')}</div>`;
  }
  function bindTabs() {
    $('#view').onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) {
        $$('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
        $$('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
      }
    };
  }

  async function barcoDetail(id) {
    const [h] = await Promise.all([api(`/api/barcos/${id}/historico`), loadRefs()]);
    const b = h.barco;
    setTitle(b.nome);
    const info = [
      ['Tipo', b.tipo], ['Fabricante / modelo', [b.fabricante, b.modelo].filter(Boolean).join(' ') || '—'], ['Ano', b.ano || '—'],
      ['Comprimento', b.comprimento_pes ? `${b.comprimento_pes} pés (${(b.comprimento_pes * 0.3048).toFixed(1)} m)` : '—'],
      ['Inscrição', b.inscricao || '—'], ['Motorização', b.motor || '—'], ['Capacidade', b.capacidade ? `${b.capacidade} pessoas` : '—'],
      ['Proprietário', b.frota_propria ? 'Frota própria' : linkCliente(b.cliente_id)], ['Diária', b.frota_propria ? money(b.valor_diaria) : '—'],
      ['Seguro válido até', fdate(b.seguro_validade)], ['Vaga', h.contrato ? `<strong>${esc(h.contrato.vaga)}</strong> (contrato #${h.contrato.id})` : 'Sem vaga'],
      ['Status', badge(b.status)],
    ];
    $('#view').innerHTML = `
      <div class="toolbar"><a href="#/barcos" class="btn btn-ghost">← Frota</a><span class="spacer"></span>
        <button class="btn" id="b-mov">🧭 Movimentação</button><button class="btn" id="b-os">🔧 Nova OS</button>${b.frota_propria ? '<button class="btn" id="b-res">📅 Reservar</button>' : ''}
        <button class="btn btn-primary" id="b-edit">✎ Editar</button></div>
      <div class="card"><div class="card-head"><h3>⛵ ${esc(b.nome)}</h3>${badge(b.status)}</div>
        <div class="detail-grid">${info.map(([k, v]) => `<div><span>${k}</span><strong>${typeof v === 'string' && v.startsWith('<') ? v : esc(v)}</strong></div>`).join('')}</div>
        ${b.observacoes ? `<p class="muted" style="padding:0 18px 16px;margin:0">${esc(b.observacoes)}</p>` : ''}</div>
      ${tabbed({
        Movimentações: { n: h.movimentacoes.length, html: tableOf([['Data/hora', (r) => fdate(r.data_hora), 'nowrap'], ['Tipo', (r) => badge(r.tipo)], ['Responsável', (r) => esc(r.responsavel || '—')], ['Destino', (r) => esc(r.destino || '—')], ['Pass.', (r) => esc(r.passageiros ?? '—'), 'num']], h.movimentacoes) },
        Manutenções: { n: h.manutencoes.length, html: tableOf([['OS', (r) => `#${r.id}`], ['Tipo', (r) => esc(r.tipo)], ['Descrição', (r) => esc(r.descricao)], ['Abertura', (r) => fdate(r.data_abertura)], ['Conclusão', (r) => fdate(r.data_conclusao)], ['Custo', (r) => money(r.custo), 'num'], ['Status', (r) => badge(r.status)]], h.manutencoes) },
        Reservas: { n: h.reservas.length, html: tableOf([['#', (r) => r.id], ['Cliente', (r) => linkCliente(r.cliente_id)], ['Período', (r) => `${fdate(r.data_inicio)} → ${fdate(r.data_fim)}`], ['Valor', (r) => money(r.valor), 'num'], ['Status', (r) => badge(r.status)]], h.reservas) },
      })}`;
    bindTabs();
    const save = (res, data) => openForm({
      title: `${RES[res].singular} — ${b.nome}`, fields: RES[res].fields, data, onChange: RES[res].onChange,
      onSubmit: async (d) => { await api(`/api/${res}${data.id ? '/' + data.id : ''}`, { method: data.id ? 'PUT' : 'POST', body: d }); toast('Salvo.'); route(); },
    });
    $('#b-edit').onclick = () => save('barcos', b);
    $('#b-mov').onclick = () => save('movimentacoes', { barco_id: b.id, tipo: b.status === 'Em uso' ? 'Retorno' : 'Saída' });
    $('#b-os').onclick = () => save('manutencoes', { barco_id: b.id });
    if ($('#b-res')) $('#b-res').onclick = () => save('reservas', { barco_id: b.id });
  }

  async function clienteDetail(id) {
    const [x] = await Promise.all([api(`/api/clientes/${id}/extrato`), loadRefs()]);
    const c = x.cliente;
    setTitle(c.nome);
    const pend = x.lancamentos.filter((l) => l.tipo === 'Receita' && l.status === 'Pendente');
    const venc = pend.filter((l) => statusLanc(l) === 'Vencido');
    const total = (a) => a.reduce((s, l) => s + l.valor, 0);
    $('#view').innerHTML = `
      <div class="toolbar"><a href="#/clientes" class="btn btn-ghost">← Clientes</a><span class="spacer"></span>
        <button class="btn btn-primary" id="c-edit">✎ Editar</button></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Barcos</div><div class="value">${x.barcos.length}</div><div class="sub">${x.contratos.filter((k) => k.status === 'Ativo').length} contrato(s) ativo(s)</div></div>
        <div class="card kpi"><div class="label">Em aberto</div><div class="value">${money(total(pend))}</div><div class="sub">${pend.length} cobrança(s)</div></div>
        <div class="card kpi ${venc.length ? 'bad' : 'ok'}"><div class="label">Vencido</div><div class="value">${money(total(venc))}</div><div class="sub">${venc.length ? 'cliente inadimplente' : 'em dia'}</div></div>
        <div class="card kpi"><div class="label">Total pago</div><div class="value">${money(total(x.lancamentos.filter((l) => l.status === 'Pago' && l.tipo === 'Receita')))}</div><div class="sub">histórico</div></div>
      </div>
      <div class="card"><div class="card-head"><h3>👤 ${esc(c.nome)}</h3></div>
        <div class="detail-grid">${[['CPF/CNPJ', c.documento], ['Telefone', c.telefone], ['E-mail', c.email], ['Habilitação', c.habilitacao], ['Endereço', c.endereco], ['Cliente desde', fdate(c.criado_em)]]
          .map(([k, v]) => `<div><span>${k}</span><strong>${esc(v || '—')}</strong></div>`).join('')}</div>
        ${c.observacoes ? `<p class="muted" style="padding:0 18px 16px;margin:0">${esc(c.observacoes)}</p>` : ''}</div>
      ${tabbed({
        Financeiro: { n: x.lancamentos.length, html: tableOf([['Vencimento', (l) => fdate(l.vencimento), 'nowrap'], ['Descrição', (l) => esc(l.descricao)], ['Valor', (l) => money(l.valor), 'num'], ['Pagamento', (l) => fdate(l.data_pagamento)], ['Status', (l) => badge(statusLanc(l))]], x.lancamentos) },
        Barcos: { n: x.barcos.length, html: tableOf([['Nome', (b) => linkBarco(b.id)], ['Tipo', (b) => esc(b.tipo)], ['Pés', (b) => esc(b.comprimento_pes ?? '—'), 'num'], ['Status', (b) => badge(b.status)]], x.barcos) },
        Contratos: { n: x.contratos.length, html: tableOf([['#', (k) => k.id], ['Vaga', (k) => `<strong>${esc(k.vaga)}</strong>`], ['Barco', (k) => esc(k.barco)], ['Início', (k) => fdate(k.data_inicio)], ['Mensal', (k) => money(k.valor_mensal), 'num'], ['Status', (k) => badge(k.status)]], x.contratos) },
        Reservas: { n: x.reservas.length, html: tableOf([['#', (r) => r.id], ['Barco', (r) => esc(r.barco)], ['Período', (r) => `${fdate(r.data_inicio)} → ${fdate(r.data_fim)}`], ['Valor', (r) => money(r.valor), 'num'], ['Status', (r) => badge(r.status)]], x.reservas) },
      })}`;
    bindTabs();
    $('#c-edit').onclick = () => openForm({
      title: 'Editar cliente', fields: RES.clientes.fields, data: c,
      onSubmit: async (d) => { await api(`/api/clientes/${c.id}`, { method: 'PUT', body: d }); toast('Cliente atualizado.'); route(); },
    });
  }

  // ================= Usuários e perfil =================
  async function usuarios() {
    const rows = await api('/api/usuarios');
    $('#view').innerHTML = `<div class="toolbar"><span class="spacer"></span><button class="btn btn-primary" id="novo">+ Usuário</button></div>
      <div class="card">${tableOf([
        ['Nome', (u) => `<strong>${esc(u.nome)}</strong>`], ['E-mail', (u) => esc(u.email)], ['Perfil', (u) => badge(u.perfil)],
        ['Situação', (u) => (u.ativo ? badge('Ativo') : badge('Inativo'))], ['Criado em', (u) => fdate(u.criado_em)],
        ['', (u) => `<button class="btn btn-ghost btn-sm" data-edit="${u.id}">✎</button>${u.id !== state.user.id ? `<button class="btn btn-ghost btn-sm btn-danger" data-del="${u.id}">🗑</button>` : ''}`, 'actions'],
      ], rows)}</div>
      <p class="muted small">Administradores acessam tudo, incluindo usuários e exclusão de lançamentos financeiros. Operadores fazem a gestão do dia a dia.</p>`;
    const fields = (novo) => [
      { name: 'nome', label: 'Nome', required: true },
      { name: 'email', label: 'E-mail', type: 'email', required: true },
      { name: 'perfil', label: 'Perfil', type: 'select', options: [['operador', 'Operador'], ['admin', 'Administrador']], required: true, default: 'operador' },
      { name: 'senha', label: novo ? 'Senha (mín. 6 caracteres)' : 'Nova senha (deixe em branco para manter)', type: 'password', required: novo },
      ...(novo ? [] : [{ name: 'ativo', label: 'Usuário ativo', type: 'check' }]),
    ];
    $('#view').onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'novo') return openForm({ title: 'Novo usuário', fields: fields(true), onSubmit: async (d) => { await api('/api/usuarios', { method: 'POST', body: d }); toast('Usuário criado.'); route(); } });
      if (t.dataset.edit) {
        const u = rows.find((r) => r.id === Number(t.dataset.edit));
        return openForm({ title: 'Editar usuário', fields: fields(false), data: u, onSubmit: async (d) => { await api(`/api/usuarios/${u.id}`, { method: 'PUT', body: d }); toast('Usuário atualizado.'); route(); } });
      }
      if (t.dataset.del && await confirmDialog('Excluir este usuário?')) {
        try { await api(`/api/usuarios/${t.dataset.del}`, { method: 'DELETE' }); toast('Usuário excluído.'); route(); } catch (err) { toast(err.message, true); }
      }
    };
  }

  function perfil() {
    $('#view').innerHTML = `<div class="card" style="max-width:520px"><div class="card-head"><h3>Meu perfil</h3>${badge(state.user.perfil)}</div>
      <div class="detail-grid"><div><span>Nome</span><strong>${esc(state.user.nome)}</strong></div><div><span>E-mail</span><strong>${esc(state.user.email)}</strong></div></div>
      <form id="senha-form" style="padding:0 18px 18px;display:grid;gap:12px">
        <label>Senha atual<input type="password" name="atual" required autocomplete="current-password"></label>
        <label>Nova senha<input type="password" name="nova" required minlength="6" autocomplete="new-password"></label>
        <label>Confirmar nova senha<input type="password" name="conf" required minlength="6" autocomplete="new-password"></label>
        <p class="form-error" id="senha-erro"></p>
        <div><button class="btn btn-primary">Alterar senha</button></div></form></div>`;
    $('#view').onclick = null;
    $('#senha-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      $('#senha-erro').textContent = '';
      if (f.nova.value !== f.conf.value) { $('#senha-erro').textContent = 'As senhas não conferem.'; return; }
      try { await api('/api/me/senha', { method: 'PUT', body: { atual: f.atual.value, nova: f.nova.value } }); e.target.reset(); toast('Senha alterada.'); } catch (err) { $('#senha-erro').textContent = err.message; }
    };
  }

  // ================= Navegação =================
  const NAV = [
    ['Visão geral'],
    ['painel', 'Painel', '📊'],
    ['Operação'],
    ['barcos', 'Frota', '⛵'], ['vagas', 'Vagas', '⚓'], ['movimentacoes', 'Movimentações', '🧭'],
    ['reservas', 'Reservas', '📅'], ['manutencoes', 'Manutenções', '🔧'],
    ['Comercial'],
    ['clientes', 'Clientes', '👤'], ['contratos', 'Contratos', '📄'], ['financeiro', 'Financeiro', '💰'],
    ['Sistema', 'admin'],
    ['usuarios', 'Usuários', '🔐', 'admin'],
  ];

  function renderNav(active) {
    $('#nav').innerHTML = NAV.filter((n) => !(n[n.length - 1] === 'admin' && state.user?.perfil !== 'admin')).map((n) => (n.length <= 2 && !n[2]
      ? `<div class="nav-sec">${esc(n[0])}</div>`
      : `<a href="#/${n[0]}" class="${active === n[0] ? 'active' : ''}"><span class="ic">${n[2]}</span>${esc(n[1])}</a>`)).join('');
  }
  const setTitle = (t) => { $('#page-title').textContent = t; document.title = `${t} · Marina do Léo`; };

  async function route() {
    if (!state.token) return showLogin();
    const [, page = 'painel', id] = location.hash.replace(/^#/, '').split('/');
    const navKey = page === 'barco' ? 'barcos' : page === 'cliente' ? 'clientes' : page;
    renderNav(navKey);
    $('#sidebar').classList.remove('open');
    const view = $('#view');
    view.onclick = view.oninput = view.onchange = null;
    try {
      if (page === 'painel') { setTitle('Painel'); await dashboard(); }
      else if (page === 'barco' && id) await barcoDetail(id);
      else if (page === 'cliente' && id) await clienteDetail(id);
      else if (page === 'usuarios' && state.user.perfil === 'admin') { setTitle('Usuários'); await usuarios(); }
      else if (page === 'perfil') { setTitle('Meu perfil'); perfil(); }
      else if (page === 'financeiro') { setTitle(RES.lancamentos.title); await listView('lancamentos'); }
      else if (RES[page]) { setTitle(RES[page].title); await listView(page); }
      else { location.hash = '#/painel'; }
    } catch (err) {
      view.innerHTML = `<div class="card empty">Não foi possível carregar: ${esc(err.message)}</div>`;
    }
  }

  // ================= Sessão =================
  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-form').elements.email.focus();
  }
  async function startApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-name').textContent = state.user?.nome || '';
    try { META = await api('/api/meta'); } catch { return; }
    route();
  }
  function logout(expired = false) {
    if (state.token && !expired) fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } }).catch(() => {});
    state.token = null; state.user = null;
    localStorage.removeItem('mdl_token'); localStorage.removeItem('mdl_user');
    if (expired) toast('Sua sessão expirou. Entre novamente.', true);
    showLogin();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    $('#login-erro').textContent = '';
    try {
      const r = await api('/api/login', { method: 'POST', body: { email: f.email.value, senha: f.senha.value } });
      state.token = r.token; state.user = r.usuario;
      localStorage.setItem('mdl_token', r.token); localStorage.setItem('mdl_user', JSON.stringify(r.usuario));
      f.senha.value = '';
      startApp();
    } catch (err) { $('#login-erro').textContent = err.message; }
  });
  $('#logout').addEventListener('click', () => logout());
  $('#menu-toggle').addEventListener('click', (e) => { e.stopPropagation(); $('#sidebar').classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#sidebar') && $('#sidebar').classList.contains('open')) $('#sidebar').classList.remove('open'); });
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('mdl_theme', next);
  });
  const savedTheme = localStorage.getItem('mdl_theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  window.addEventListener('hashchange', route);
  if (state.token) startApp(); else showLogin();
})();
