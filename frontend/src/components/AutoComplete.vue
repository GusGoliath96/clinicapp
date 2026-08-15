<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import { api } from '../api/client.js';

// Autocomplete genérico sobre /catalog/:tipo (cids | medicamentos | exames).
// - v-model (opcional): espelha o texto digitado (útil quando o valor vira o campo).
// - @select: emitido ao escolher um item ({ label, value }).
// - clearOnSelect: limpa o campo após escolher (útil quando o item é "anexado" a outro lugar).
const props = defineProps({
  modelValue: { type: String, default: '' },
  tipo: { type: String, required: true },
  placeholder: { type: String, default: 'Buscar...' },
  clearOnSelect: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'select']);

const texto = ref(props.modelValue);
const resultados = ref([]);
const aberto = ref(false);
const idx = ref(-1);
let debounce;

watch(() => props.modelValue, (v) => { if (v !== texto.value) texto.value = v; });

function onInput() {
  emit('update:modelValue', texto.value);
  clearTimeout(debounce);
  const q = texto.value.trim();
  if (q.length < 2) { resultados.value = []; aberto.value = false; return; }
  debounce = setTimeout(async () => {
    try {
      resultados.value = (await api.get(`/catalog/${props.tipo}`, { params: { q } })).data;
      aberto.value = resultados.value.length > 0;
      idx.value = -1;
    } catch { resultados.value = []; aberto.value = false; }
  }, 180);
}

function escolher(item) {
  emit('select', item);
  if (props.clearOnSelect) { texto.value = ''; emit('update:modelValue', ''); }
  else { texto.value = item.value; emit('update:modelValue', item.value); }
  resultados.value = [];
  aberto.value = false;
}

function onKey(e) {
  if (!aberto.value || !resultados.value.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); idx.value = (idx.value + 1) % resultados.value.length; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); idx.value = (idx.value - 1 + resultados.value.length) % resultados.value.length; }
  else if (e.key === 'Enter' && idx.value >= 0) { e.preventDefault(); escolher(resultados.value[idx.value]); }
  else if (e.key === 'Escape') { aberto.value = false; }
}

function fechar() { setTimeout(() => { aberto.value = false; }, 150); }
onBeforeUnmount(() => clearTimeout(debounce));
</script>

<template>
  <div class="ac-wrap">
    <input class="form-input" :placeholder="placeholder" v-model="texto"
      @input="onInput" @keydown="onKey" @focus="onInput" @blur="fechar" autocomplete="off" />
    <div v-if="aberto" class="ac-list">
      <div v-for="(r, i) in resultados" :key="r.value" class="ac-item" :class="{ ativo: i === idx }"
        @mousedown.prevent="escolher(r)" @mouseenter="idx = i">{{ r.label }}</div>
    </div>
  </div>
</template>
