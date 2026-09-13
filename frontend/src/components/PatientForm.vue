<script setup>
import { reactive, ref, computed } from 'vue';
import { api } from '../api/client.js';

const props = defineProps({ patient: { type: Object, default: null } });
const emit = defineEmits(['close', 'saved']);

const editing = computed(() => Boolean(props.patient?.id));
const error = ref('');
const saving = ref(false);

function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseList(str) { return String(str || '').split(',').map((s) => s.trim()).filter(Boolean); }
function joinList(arr) { return (arr || []).join(', '); }

const p = props.patient || {};
const f = reactive({
  nome: p.nome || '', nome_social: p.nome_social || '', cpf: p.cpf || '', rg: p.rg || '',
  nascimento: toDateInput(p.nascimento), sexo: p.sexo || '', origem: p.origem || '',
  telefone: p.telefone || '', email: p.email || '',
  end: { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', ...(p.endereco || {}) },
  emerg: { nome: '', tel: '', parentesco: '', ...(p.contato_emergencia || {}) },
  convenio: p.convenio || '',
  conv: { operadora: '', plano: '', matricula: '', validade: '', ...(p.convenio_detalhe || {}) },
  alergiasStr: joinList(p.alergias), comorbidadesStr: joinList(p.comorbidades), medicacoesStr: joinList(p.medicacoes),
  tagsStr: joinList(p.tags),
  consentimento_lgpd: Boolean(p.consentimento_lgpd),
});

async function save() {
  if (!f.nome.trim()) { error.value = 'O nome é obrigatório.'; return; }
  saving.value = true;
  error.value = '';
  const payload = {
    nome: f.nome.trim(), nome_social: f.nome_social || null, cpf: f.cpf || null, rg: f.rg || null,
    nascimento: f.nascimento || null, sexo: f.sexo || null, origem: f.origem || null,
    telefone: f.telefone || null, email: f.email || null,
    endereco: f.end, contato_emergencia: f.emerg,
    convenio: f.convenio || null, convenio_detalhe: f.conv,
    alergias: parseList(f.alergiasStr), comorbidades: parseList(f.comorbidadesStr),
    medicacoes: parseList(f.medicacoesStr), tags: parseList(f.tagsStr),
    consentimento_lgpd: f.consentimento_lgpd,
  };
  try {
    const { data } = editing.value
      ? await api.put(`/patients/${props.patient.id}`, payload)
      : await api.post('/patients', payload);
    emit('saved', data);
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível save.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop active" @click.self="emit('close')">
    <div class="modal lg">
      <div class="modal-header">
        <div class="modal-title">{{ editing ? '✏️ Editar paciente' : '＋ Cadastrar paciente' }}</div>
        <button class="modal-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <div v-if="error" class="form-erro">{{ error }}</div>

        <div class="cv-section-title">📇 Identificação</div>
        <div class="form-row">
          <label class="form-label">Nome completo <span class="required">*</span></label>
          <input class="form-input" v-model="f.nome" />
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Nome social</label><input class="form-input" v-model="f.nome_social" /></div>
          <div class="form-row"><label class="form-label">Origem</label><input class="form-input" v-model="f.origem" placeholder="WhatsApp, Recepção..." /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">CPF</label><input class="form-input" v-model="f.cpf" /></div>
          <div class="form-row"><label class="form-label">RG</label><input class="form-input" v-model="f.rg" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Nascimento</label><input type="date" class="form-input" v-model="f.nascimento" /></div>
          <div class="form-row">
            <label class="form-label">Sexo</label>
            <select class="form-input" v-model="f.sexo">
              <option value="">—</option><option value="F">Feminino</option><option value="M">Masculino</option><option value="Outro">Outro</option>
            </select>
          </div>
        </div>

        <div class="cv-section-title" style="margin-top:16px;">📞 Contato</div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Telefone (WhatsApp)</label><input class="form-input" v-model="f.telefone" placeholder="+5511..." /></div>
          <div class="form-row"><label class="form-label">E-mail</label><input class="form-input" v-model="f.email" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">CEP</label><input class="form-input" v-model="f.end.cep" /></div>
          <div class="form-row"><label class="form-label">Rua</label><input class="form-input" v-model="f.end.rua" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Número</label><input class="form-input" v-model="f.end.numero" /></div>
          <div class="form-row"><label class="form-label">Complemento</label><input class="form-input" v-model="f.end.complemento" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Bairro</label><input class="form-input" v-model="f.end.bairro" /></div>
          <div class="form-row"><label class="form-label">Cidade / UF</label>
            <div style="display:flex;gap:6px;"><input class="form-input" v-model="f.end.cidade" /><input class="form-input" style="max-width:64px;" v-model="f.end.uf" placeholder="UF" /></div>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">Contato de emergência</label>
          <div style="display:flex;gap:6px;">
            <input class="form-input" v-model="f.emerg.nome" placeholder="Nome" />
            <input class="form-input" v-model="f.emerg.tel" placeholder="Telefone" />
            <input class="form-input" v-model="f.emerg.parentesco" placeholder="Parentesco" />
          </div>
        </div>

        <div class="cv-section-title" style="margin-top:16px;">💳 Convênio</div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Convênio</label><input class="form-input" v-model="f.convenio" placeholder="Particular, Unimed..." /></div>
          <div class="form-row"><label class="form-label">Plano</label><input class="form-input" v-model="f.conv.plano" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Matrícula</label><input class="form-input" v-model="f.conv.matricula" /></div>
          <div class="form-row"><label class="form-label">Validade</label><input class="form-input" v-model="f.conv.validade" placeholder="MM/AAAA" /></div>
        </div>

        <div class="cv-section-title" style="margin-top:16px;">🩺 Saúde e etiquetas</div>
        <div class="form-row"><label class="form-label">Alergias <span style="font-weight:400;color:var(--gray-500);">(separadas por vírgula)</span></label><input class="form-input" v-model="f.alergiasStr" placeholder="Dipirona, Penicilina" /></div>
        <div class="form-row"><label class="form-label">Comorbidades</label><input class="form-input" v-model="f.comorbidadesStr" placeholder="Hipertensão, Diabetes" /></div>
        <div class="form-row"><label class="form-label">Medicações</label><input class="form-input" v-model="f.medicacoesStr" placeholder="Losartana 50mg, ..." /></div>
        <div class="form-row"><label class="form-label">Etiquetas</label><input class="form-input" v-model="f.tagsStr" placeholder="VIP, Idosa, Recorrente" /></div>
        <div class="form-row" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="lgpd-chk" v-model="f.consentimento_lgpd" style="width:auto;" />
          <label for="lgpd-chk" class="form-label" style="margin:0;">🔒 Consentimento LGPD concedido</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="emit('close')">Cancelar</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? 'Salvando…' : (editing ? 'Salvar alterações' : 'Cadastrar') }}</button>
      </div>
    </div>
  </div>
</template>
