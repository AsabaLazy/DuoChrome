// DuoChrome background service worker：
// 负责定时提醒调度（chrome.alarms）、稍后提醒(snooze)、
// 消息路由与通知兜底；点击扩展图标打开设置页。
import {
	MSG,
	ALARM_ID,
	LEARNING_URL,
	getRandomReminderText,
	safeHttpUrl,
} from "../shared/constants.js";
import { getSettings, saveSettingsDirect } from "../shared/storage.js";

const SCHEDULE_KEYS = ["enabled", "reminderTimes", "snoozeMinutes"];
const CONTENT_SYNC_KEYS = ["enabled", "duo", "learningUrl", "snoozeMinutes"];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
let scheduleQueue = Promise.resolve();
let settingsWriteQueue = Promise.resolve();

function saveSettingsSerialized(patch) {
	const save = () => saveSettingsDirect(patch);
	settingsWriteQueue = settingsWriteQueue.then(save, save);
	return settingsWriteQueue;
}

async function broadcastSettingsUpdated() {
	const tabs = await chrome.tabs.query({});
	await Promise.all(
		tabs.map(async (tab) => {
			if (!tab.id) return;
			try {
				await chrome.tabs.sendMessage(tab.id, {
					type: MSG.SETTINGS_UPDATED,
				});
			} catch {
				// 浏览器内部页或尚未注入 content script 的页面直接跳过。
			}
		}),
	);
}

// ---------- 工具 ----------
function parseTime(str, now = new Date()) {
	if (typeof str !== "string" || !TIME_PATTERN.test(str)) return null;
	const [h, m] = str.split(":").map(Number);
	const d = new Date(now);
	d.setHours(h, m, 0, 0);
	return d;
}

// ---------- 调度 ----------
// 计算下一个提醒时刻：优先未过期的今日提醒时间，否则取明天的；若在 snooze 期间则取 snooze 结束时刻。
async function scheduleNextImpl() {
	const s = await getSettings();
	if (!s.enabled || !s.reminderTimes.length) {
		await chrome.alarms.clear(ALARM_ID);
		return;
	}
	const now = Date.now();
	const { snoozeUntil: storedSnoozeUntil = 0 } = await chrome.storage.local.get(
		"snoozeUntil",
	);
	const snoozeUntil = Number(storedSnoozeUntil) || 0;
	let next = Infinity;
	if (snoozeUntil > now) {
		next = snoozeUntil;
	} else {
		for (const t of s.reminderTimes) {
			const d = parseTime(t);
			if (!d) continue;
			if (d.getTime() <= now) d.setDate(d.getDate() + 1);
			next = Math.min(next, d.getTime());
		}
	}
	if (next === Infinity) {
		await chrome.alarms.clear(ALARM_ID);
		return;
	}
	chrome.alarms.create(ALARM_ID, { when: next });
}

// alarms API 是最后一次 create 生效；串行化可避免并发更新把旧时间覆盖回去。
function scheduleNext() {
	scheduleQueue = scheduleQueue.then(scheduleNextImpl, scheduleNextImpl);
	return scheduleQueue;
}

function scheduleSafely() {
	void scheduleNext().catch(() => {});
}

// ---------- 提醒触发 ----------
async function onReminderAlarm() {
	const s = await getSettings();
	const now = Date.now();
	const { snoozeUntil: storedSnoozeUntil = 0 } = await chrome.storage.local.get(
		"snoozeUntil",
	);
	const snoozeUntil = Number(storedSnoozeUntil) || 0;

	if (now < snoozeUntil) {
		await scheduleNext(); // 仍在 snooze 期：调度器会把闹钟挪到 snooze 结束
		return;
	}
	if (!s.enabled) {
		await scheduleNext();
		return;
	}
	if (snoozeUntil) await chrome.storage.local.remove("snoozeUntil");

	await broadcastRemind(getRandomReminderText());
	await scheduleNext();
}

// 向所有标签页广播提醒；若没有一个页面能收到（无标签页/全部为浏览器内部页），
// 则退回系统通知，确保提醒不丢失。
async function broadcastRemind(text, force = false) {
	const tabs = await chrome.tabs.query({});
	const results = await Promise.all(
		tabs.map(async (tab) => {
			if (!tab.id) return 0;
			try {
				const response = await chrome.tabs.sendMessage(tab.id, {
					type: MSG.REMIND,
					text,
					force,
				});
				return response?.ok ? 1 : 0;
			} catch {
				return 0; // 页面没有 content script 或标签页不可达
			}
		}),
	);
	const delivered = results.reduce((a, b) => a + b, 0);
	if (delivered === 0) {
		await chrome.notifications.create("duochrome-remind", {
			type: "basic",
			iconUrl: "icons/icon128.png",
			title: "DuoChrome",
			message: text,
			priority: 1,
		});
	}
}

// ---------- 生命周期 ----------
chrome.runtime.onInstalled.addListener(() => {
	scheduleSafely();
});

chrome.runtime.onStartup.addListener(() => {
	scheduleSafely();
});

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === ALARM_ID) void onReminderAlarm().catch(() => {});
});

// 设置变更后重新调度
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "sync") return;
	if (SCHEDULE_KEYS.some((key) => changes[key])) scheduleSafely();
	if (CONTENT_SYNC_KEYS.some((key) => changes[key])) {
		void broadcastSettingsUpdated().catch(() => {});
	}
});

// 点击扩展图标（无 popup）：打开设置页
chrome.action.onClicked.addListener(() => {
	chrome.runtime.openOptionsPage();
});

// 消息路由：打开打卡页 / 稍后提醒
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.type === MSG.SAVE_SETTINGS) {
		(async () => {
			try {
				const settings = await saveSettingsSerialized(msg.patch);
				sendResponse({ ok: true, settings });
			} catch {
				sendResponse({ ok: false, error: "设置保存失败" });
			}
		})();
		return true;
	}
	if (msg?.type === MSG.OPEN_DUOLINGO) {
		(async () => {
			try {
				const s = await getSettings();
				const url = safeHttpUrl(msg.url, s.learningUrl || LEARNING_URL);
				await chrome.tabs.create({ url });
				sendResponse({ ok: true });
			} catch {
				sendResponse({ ok: false });
			}
		})();
		return true; // 异步响应
	}
	if (msg?.type === MSG.SNOOZE) {
		(async () => {
			try {
				const minutes = Math.max(
					1,
					Math.min(240, Math.round(Number(msg.minutes) || 15)),
				);
				await chrome.storage.local.set({
					snoozeUntil: Date.now() + minutes * 60000,
				});
				await scheduleNext();
				sendResponse({ ok: true });
			} catch {
				sendResponse({ ok: false });
			}
		})();
		return true;
	}
	return false;
});
