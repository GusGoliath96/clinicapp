<script setup>
import { reactive, ref, computed } from 'vue';
import { api } from '../api/client.js';

const props = defineProps({ professional: { type: Object, default: null } });
const emit = defineEmits(['close', 'saved']);

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const CORES = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#db2777', '#0891b2', '#dc2626', '#f59e0b'];

const editando = computed(() => Boolean(props.professional?.id));
const erro = ref('');
const salvando = ref(false);

function initHorarios(agenda) {
  const h = {};
  const src = agenda?.horarios;
  for (const d of DIAS) {
    if (src && src[d]) {
      const [ai, af] = String(src[d].almoco || '').split('-');
      h[d] = { ativo: !!src[d].ativo, inicio: src[d].inicio || '08:00', fim: src[d].fim || '18:00', almocoIni: ai || '', almocoFim: af || '' };
    } else if (agenda?.dias) { // formato antigo (horário único)
      const [ai, af] = String(agenda.almoco || '').split('-');
      h[d] = { ativo: agenda.dias.includes(d), inicio: agenda.inicio || '08:00', fim: agenda.fim || '18:00', almocoIni: ai || '', almocoFim: af || '' };
    } else {
      const padrao = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].includes(d);
      h[d] = { ativo: padrao, inicio: '08:00', fim: '18:00', almocoIni: '12:00', almocoFim: '13:00' };
    }
  }
  return h;
}

const p = props.professional || {};
const f = reactive({
  nome: p.nome || '', conselho: p.conselho || '', especialidade: p.especialidade || '',
  cor: p.cor || '#2563eb',
  duracaoConsulta: p.agenda?.duracaoConsulta || 30,
  duracaoRetorno: p.agenda?.duracaoRetorno || 20,
  horarios: initHorarios(p.agenda),
});

function copiarParaUteis() {
  const base = f.horarios.Seg;
  for (const d of ['Ter', 'Qua', 'Qui', 'Sex']) {
    f.horarios[d] = { ...base };
  }
}

async function salvar() {
  if (!f.nome.trim()) { erro.value = 'O nome é obrigatório.'; return; }
  salvando.value = true;
  erro.value = '';
  const horarios = {};
  for (const d of DIAS) {
    const x = f.horarios[d];
    horarios[d] = x.ativo
      ? { ativo: true, inicio: x.inicio, fim: x.fim, almoco: (x.almocoIni && x.almocoFim) ? `${x.almocoIni}-${x.almocoFim}` : null }
      : { ativo: false };
  }
  const payload = {
    nome: f.nome.trim(), conselho: f.conselho || null, especialidade: f.especialidade || null, cor: f.cor,
    agenda: { duracaoConsulta: Number(f.duracaoConsulta) || 30, duracaoRetorno: Number(f.duracaoRetorno) || 20, horarios },
  };
  try {
    const { data } = editando.value
      ? await api.put(`/professionals/${props.professional.id}`, payload)
      : await api.post('/professionals', payload);
    emit('saved', data);
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível salvar.';
  } finally {
    salvando.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop active" @click.self="emit('close')">
    <div class="modal lg">
      <div class="modal-header">
        <div class="modal-title">{{ editando ? '✏️ Editar profissional' : '＋ Novo profissional' }}</div>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <div v-if="erro" class="form-erro">{{ erro }}</div>

        <div class="row-2">
          <div class="form-row"><label class="form-label">Nome <span class="required">*</span></label><input class="form-input" v-model="f.nome" /></div>
          <div class="form-row"><label class="form-label">Conselho (CRM/CRO...)</label><input class="form-input" v-model="f.conselho" placeholder="CRM-SP 123456" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Especialidade</label><input class="form-input" v-model="f.especialidade" placeholder="Ortopedia" /></div>
          <div class="form-row">
            <label class="form-label">Cor na agenda</label>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <button v-for="c in CORES" :key="c" type="button" class="cor-dot" :class="{ sel: f.cor === c }" :style="{ background: c }" @click="f.cor = c"></button>
              <input type="color" v-model="f.cor" style="width:34px;height:26px;padding:0;border:1px solid var(--gray-200);border-radius:6px;" />
            </div>
          </div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Duração da consulta (min)</label><input type="number" class="form-input" v-model="f.duracaoConsulta" min="5" step="5" /></div>
          <div class="form-row"><label class="form-label">Duração do retorno (min)</label><input type="number" class="form-input" v-model="f.duracaoRetorno" min="5" step="5" /></div>
        </div>

        <div class="cv-section-title" style="margin-top:8px;">
          🗓️ Horário de trabalho por dia
          <button type="button" class="btn btn-secondary btn-sm" style="margin-left:auto;" @click="copiarParaUteis">Copiar Seg → dias úteis</button>
        </div>
        <div class="hora-grid">
          <div class="hora-grid-head">
            <span></span><span>Dia</span><span>Entrada</span><span>Saída</span><span>Almoço</span>
          </div>
          <div v-for="d in DIAS" :key="d" class="hora-row" :class="{ off: !f.horarios[d].ativo }">
            <input type="checkbox" v-model="f.horarios[d].ativo" />
            <strong>{{ d }}</strong>
            <template v-if="f.horarios[d].ativo">
              <input type="time" class="form-input hora-inp" v-model="f.horarios[d].inicio" />
              <input type="time" class="form-input hora-inp" v-model="f.horarios[d].fim" />
              <span class="hora-almoco">
                <input type="time" class="form-input hora-inp" v-model="f.horarios[d].almocoIni" />
                <span style="color:var(--gray-400);">–</span>
                <input type="time" class="form-input hora-inp" v-model="f.horarios[d].almocoFim" />
              </span>
            </template>
            <span v-else class="hora-folga">Folga</span>
          </div>
        </div>
        <p style="font-size:11px;color:var(--gray-500);margin-top:8px;">Deixe o almoço em branco se não houver intervalo naquele dia.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="emit('close')">Cancelar</button>
        <button class="btn btn-primary" :disabled="salvando" @click="salvar">{{ salvando ? 'Salvando…' : (editando ? 'Salvar' : 'Cadastrar') }}</button>
      </div>
    </div>
  </div>
</template>
