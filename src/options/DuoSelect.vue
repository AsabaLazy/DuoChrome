<script setup>
// 自定义下拉菜单（Duolingo 风格）：替代 Chrome 原生 <select> 弹出控件。
// 按钮 + 自绘面板，支持鼠标点击、键盘方向键选择、Esc 关闭、点击外部关闭。
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { required: true },
  options: { type: Array, required: true }, // [{ value, label }]
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const rootEl = ref(null)
const hoverIndex = ref(-1)

const current = computed(() =>
  props.options.find((o) => o.value === props.modelValue),
)

function toggle() {
  open.value = !open.value
  if (open.value) {
    hoverIndex.value = props.options.findIndex(
      (o) => o.value === props.modelValue,
    )
  }
}

function close() {
  open.value = false
}

function select(opt) {
  emit('update:modelValue', opt.value)
  close()
}

function onDocPointerDown(e) {
  if (rootEl.value && !rootEl.value.contains(e.target)) close()
}

function onKeydown(e) {
  if (!open.value) {
    if (
      e.key === 'Enter' ||
      e.key === ' ' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp'
    ) {
      e.preventDefault()
      toggle()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    hoverIndex.value = Math.min(props.options.length - 1, hoverIndex.value + 1)
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    hoverIndex.value = Math.max(0, hoverIndex.value - 1)
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const opt = props.options[hoverIndex.value]
    if (opt) select(opt)
  }
}

watch(open, (isOpen) => {
  document[isOpen ? 'addEventListener' : 'removeEventListener'](
    'pointerdown',
    onDocPointerDown,
  )
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <div ref="rootEl" class="duo-select" :class="{ open }" @keydown="onKeydown">
    <button
      type="button"
      class="duo-select__button"
      :aria-expanded="open"
      :aria-label="ariaLabel || undefined"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="duo-select__value">{{ current ? current.label : '' }}</span>
      <span class="duo-select__caret" aria-hidden="true"></span>
    </button>
    <div v-if="open" class="duo-select__panel" role="listbox">
      <button
        v-for="(opt, i) in options"
        :key="opt.value"
        type="button"
        class="duo-select__option"
        :class="{ selected: opt.value === modelValue, hover: i === hoverIndex }"
        role="option"
        :aria-selected="opt.value === modelValue"
        @mouseenter="hoverIndex = i"
        @click="select(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>
