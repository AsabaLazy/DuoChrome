<script setup>
import { computed, reactive, ref, onMounted } from 'vue'
import { getSettings, saveSettings } from '../shared/storage.js'
import { DEFAULT_SETTINGS, isHttpUrl } from '../shared/constants.js'
import DuoSelect from './DuoSelect.vue'

const clone = (obj) => JSON.parse(JSON.stringify(obj))
const form = reactive(clone(DEFAULT_SETTINGS))
const savedSnapshot = ref(clone(DEFAULT_SETTINGS))
const urlError = ref('')
const saveError = ref('')

const sizePercent = computed(() => {
  const min = 80
  const max = 180
  const size = Math.min(max, Math.max(min, Number(form.duo.size) || min))
  return ((size - min) / (max - min)) * 100
})

onMounted(async () => {
  try {
    const settings = clone(await getSettings())
    Object.assign(form, settings)
    savedSnapshot.value = clone(settings)
  } catch {
    // 保留默认表单；用户仍可修改后重新保存。
  }
})

function removeTime(i) {
  if (form.reminderTimes.length <= 1) return
  form.reminderTimes.splice(i, 1)
}

// 时间选择器：小时 00–23 + 分钟（每 5 分钟一档）
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function addTime() {
  const existing = new Set(form.reminderTimes)
  const total = HOURS.length * MINUTES.length
  const start = 20 * MINUTES.length
  for (let offset = 0; offset < total; offset += 1) {
    const index = (start + offset) % total
    const time = `${HOURS[Math.floor(index / MINUTES.length)]}:${MINUTES[index % MINUTES.length]}`
    if (!existing.has(time)) {
      form.reminderTimes.push(time)
      return
    }
  }
}

function timeParts(t) {
  const [hh, mm] = String(t || '20:00').split(':')
  return { hh: hh || '20', mm: mm || '00' }
}

// 分钟选项：始终包含当前值（兼容旧数据里非整 5 分钟的时间）
function minuteOptions(mm) {
  return MINUTES.includes(mm) ? MINUTES : [mm, ...MINUTES]
}

function setTimePart(i, part, value) {
  const p = timeParts(form.reminderTimes[i])
  form.reminderTimes[i] = part === 'hh' ? `${value}:${p.mm}` : `${p.hh}:${value}`
}

function setDefaultPosition(value) {
  form.duo.position = value
  form.duo.dragPosition = null
}

// 下拉选项（{ value, label }）
const HOUR_OPTIONS = HOURS.map((h) => ({ value: h, label: h }))
const APPEARANCE_OPTIONS = [
  { value: 'reader', label: '读书 Duo' },
  { value: 'path', label: '摇摆 Duo' },
]
const POSITION_OPTIONS = [
  { value: 'right', label: '右下角' },
  { value: 'left', label: '左下角' },
]

function minuteOptionsFor(mm) {
  return minuteOptions(mm).map((m) => ({ value: m, label: m }))
}

function snoozeOptionsFor() {
  return snoozeOptions().map((m) => ({ value: m, label: `${m} 分钟` }))
}

// 「稍后提醒」可选间隔（分钟），始终包含当前值
const SNOOZE_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120]

function snoozeOptions() {
  if (SNOOZE_MINUTES.includes(form.snoozeMinutes)) return SNOOZE_MINUTES
  return [...SNOOZE_MINUTES, form.snoozeMinutes].sort((a, b) => a - b)
}

function differs(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b)
}

function createSavePatch(previous, next) {
  const patch = {}
  for (const key of ['enabled', 'reminderTimes', 'snoozeMinutes', 'learningUrl']) {
    if (differs(previous[key], next[key])) patch[key] = clone(next[key])
  }
  const duo = {}
  for (const key of ['appearance', 'position', 'dragPosition', 'size']) {
    if (differs(previous.duo[key], next.duo[key])) duo[key] = clone(next.duo[key])
  }
  if (Object.keys(duo).length) patch.duo = duo
  return patch
}

async function save() {
  if (!isValidLearningUrl(form.learningUrl)) {
    urlError.value = '请输入有效的 http 或 https 链接'
    return
  }
  saveError.value = ''
  try {
    const patch = createSavePatch(savedSnapshot.value, form)
    const settings = Object.keys(patch).length
      ? await saveSettings(patch)
      : await getSettings()
    const normalized = clone(settings)
    Object.assign(form, normalized)
    savedSnapshot.value = clone(normalized)
    urlError.value = ''
  } catch {
    saveError.value = '保存失败，请稍后重试'
  }
}

function reset() {
  Object.assign(form, clone(DEFAULT_SETTINGS))
  urlError.value = ''
  saveError.value = ''
}

function isValidLearningUrl(value) {
  return isHttpUrl(value)
}
</script>

<template>
  <div class="wrap">
    <header class="app-header">
      <h1>DuoChrome</h1>
    </header>

    <section class="card">
      <h2>提醒</h2>
      <div class="row">
        <span>稍后提醒间隔</span>
        <DuoSelect
          class="snooze-select"
          aria-label="稍后提醒间隔"
          :options="snoozeOptionsFor()"
          :model-value="form.snoozeMinutes"
          @update:model-value="form.snoozeMinutes = $event"
        />
      </div>
      <div class="row">
        <span>启用打卡提醒</span>
        <label class="switch">
          <input
            v-model="form.enabled"
            type="checkbox"
            aria-label="启用打卡提醒"
          />
          <span class="track"></span>
        </label>
      </div>
      <div class="times">
        <div class="times-heading">每日提醒时间</div>
        <div class="time-row" v-for="(t, i) in form.reminderTimes" :key="i">
          <div class="time-picker">
            <DuoSelect
              :options="HOUR_OPTIONS"
              :aria-label="`第 ${i + 1} 个提醒时间，小时`"
              :model-value="timeParts(t).hh"
              @update:model-value="setTimePart(i, 'hh', $event)"
            />
            <span class="time-colon">:</span>
            <DuoSelect
              :options="minuteOptionsFor(timeParts(t).mm)"
              :aria-label="`第 ${i + 1} 个提醒时间，分钟`"
              :model-value="timeParts(t).mm"
              @update:model-value="setTimePart(i, 'mm', $event)"
            />
          </div>
          <button
            v-if="form.reminderTimes.length > 1"
            class="btn-danger"
            type="button"
            :aria-label="`删除第 ${i + 1} 个提醒时间`"
            @click="removeTime(i)"
          >删除</button>
        </div>
        <button class="btn-small" @click="addTime">＋ 添加提醒时间</button>
      </div>
    </section>

    <section class="card">
      <h2>Duo 外观与行为</h2>
      <div class="row">
        <span>Duo 形象</span>
        <DuoSelect
          :options="APPEARANCE_OPTIONS"
          aria-label="Duo 形象"
          :model-value="form.duo.appearance"
          @update:model-value="form.duo.appearance = $event"
        />
      </div>
      <div class="row">
        <span>默认位置</span>
        <DuoSelect
          :options="POSITION_OPTIONS"
          aria-label="Duo 默认位置"
          :model-value="form.duo.position"
          @update:model-value="setDefaultPosition"
        />
      </div>
      <div class="row">
        <span>大小：{{ form.duo.size }}px</span>
        <input
          class="range"
          type="range"
          aria-label="Duo 大小"
          :aria-valuetext="`${form.duo.size} 像素`"
          :style="{ '--pct': `${sizePercent}%` }"
          v-model.number="form.duo.size"
          min="80"
          max="180"
          step="4"
        />
      </div>
      <div class="row">
        <span>打卡链接</span>
        <input
          type="url"
          v-model="form.learningUrl"
          aria-label="打卡链接"
          :aria-invalid="Boolean(urlError)"
          aria-describedby="learning-url-error"
          :class="{ 'input-invalid': urlError }"
          @input="urlError = ''"
          placeholder="https://www.duolingo.com/learn"
        />
      </div>
      <p v-if="urlError" id="learning-url-error" class="form-error">
        {{ urlError }}
      </p>
    </section>

    <footer class="footer">
      <button class="btn-primary" @click="save">保存设置</button>
      <button class="btn-secondary" @click="reset">恢复默认</button>
    </footer>
    <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
  </div>
</template>
