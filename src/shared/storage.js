// chrome.storage 封装：读取/保存设置（sync 区），监听变更
import {
	DEFAULT_SETTINGS,
	isHttpUrl,
	safeHttpUrl,
	MSG,
} from "./constants.js";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const APPEARANCES = new Set(["reader", "path"]);
const POSITIONS = new Set(["left", "right"]);

function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}

function clampInteger(value, min, max, fallback) {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeReminderTimes(value) {
	if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.reminderTimes];
	const times = [
		...new Set(
			value.filter((time) => typeof time === "string" && TIME_PATTERN.test(time)),
		),
	];
	return times.length ? times : [...DEFAULT_SETTINGS.reminderTimes];
}

function normalizeDragPosition(value) {
	const position = asRecord(value);
	const x = Number(position.x);
	const y = Number(position.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return {
		x: Math.min(1, Math.max(0, x)),
		y: Math.min(1, Math.max(0, y)),
	};
}

function normalizeDuo(value) {
	const duo = asRecord(value);
	const rawSize = Number(duo.size);
	const migratedSize = duo.sizeVersion === 2 ? rawSize : rawSize * 1.25;
	const size = Number.isFinite(migratedSize)
		? Math.min(180, Math.max(80, Math.round(migratedSize / 4) * 4))
		: DEFAULT_SETTINGS.duo.size;
	return {
		...DEFAULT_SETTINGS.duo,
		appearance: APPEARANCES.has(duo.appearance)
			? duo.appearance
			: DEFAULT_SETTINGS.duo.appearance,
		position: POSITIONS.has(duo.position)
			? duo.position
			: DEFAULT_SETTINGS.duo.position,
		dragPosition: normalizeDragPosition(duo.dragPosition),
		size,
		sizeVersion: 2,
	};
}

function sameValue(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

// 读取、写入与更新路径共用一份校验，避免损坏的 sync 数据影响页面或闹钟调度。
export function normalizeSettings(value = {}) {
	const stored = asRecord(value);
	return {
		...DEFAULT_SETTINGS,
		enabled:
			typeof stored.enabled === "boolean"
				? stored.enabled
				: DEFAULT_SETTINGS.enabled,
		reminderTimes: normalizeReminderTimes(stored.reminderTimes),
		snoozeMinutes: clampInteger(
			stored.snoozeMinutes,
			1,
			240,
			DEFAULT_SETTINGS.snoozeMinutes,
		),
		learningUrl: isHttpUrl(stored.learningUrl)
			? safeHttpUrl(stored.learningUrl)
			: DEFAULT_SETTINGS.learningUrl,
		duo: normalizeDuo(stored.duo),
	};
}

export async function getSettings() {
	const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
	return normalizeSettings(stored);
}

// 仅由 background 调用：读改写需要在一个上下文内串行执行，避免多标签页互相覆盖。
export async function saveSettingsDirect(patch = {}) {
	const current = await getSettings();
	const partial = asRecord(patch);
	const next = normalizeSettings({
		...current,
		...partial,
		duo: { ...current.duo, ...asRecord(partial.duo) },
	});
	const changes = Object.fromEntries(
		Object.keys(DEFAULT_SETTINGS)
			.filter((key) => !sameValue(current[key], next[key]))
			.map((key) => [key, next[key]]),
	);
	if (Object.keys(changes).length) await chrome.storage.sync.set(changes);
	return next;
}

// 普通页面经 background 串行写入；background 重载时由调用方处理失败并重试。
export async function saveSettings(patch = {}) {
	const response = await chrome.runtime.sendMessage({
		type: MSG.SAVE_SETTINGS,
		patch,
	});
	if (!response?.ok) throw new Error(response?.error || "设置保存失败");
	return normalizeSettings(response.settings);
}
