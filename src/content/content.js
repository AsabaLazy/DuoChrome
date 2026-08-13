// DuoChrome content script：在所有网页注入 Duo 猫头鹰。
// 入口为 IIFE bundle（MV3 content script 不支持 ES module）。
import { MSG, getRandomReminderText } from "../shared/constants.js";
import {
	getSettings,
	saveSettings,
} from "../shared/storage.js";
import { createMascot } from "./mascot.js";

let mascot = null;
let syncPromise = null;
let syncQueued = false;

async function persistDuoPosition(dragPosition) {
	try {
		await saveSettings({ duo: { dragPosition } });
	} catch {
		// 页面关闭或扩展刷新时，storage 可能暂时不可用。
	}
}

async function syncMascot() {
	const s = await getSettings();
	if (!s.enabled) {
		if (mascot) {
			mascot.destroy();
			mascot = null;
		}
		return;
	}
	const opts = {
		...s.duo,
		learningUrl: s.learningUrl,
		snoozeMinutes: s.snoozeMinutes,
		onPositionChange: persistDuoPosition,
	};
	if (!mascot) mascot = createMascot(opts);
	else mascot.setSettings(opts);
}

// 合并同一事件循环内的多次 storage 更新，避免初始化或多标签拖动时重复创建 Duo。
function ensureMascot() {
	syncQueued = true;
	if (syncPromise) return syncPromise;
	syncPromise = (async () => {
		do {
			syncQueued = false;
			try {
				await syncMascot();
			} catch {
				// 临时无法读取 storage 时保留当前 Duo，下一次后台广播会自动重试。
			}
		} while (syncQueued);
	})().finally(() => {
		syncPromise = null;
	});
	return syncPromise;
}

// 接收 background 的提醒
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (!msg) return false;
	if (msg.type === MSG.SETTINGS_UPDATED) {
		ensureMascot();
		sendResponse({ ok: true });
		return false;
	}
	if (!mascot) return false;
	if (msg.type === MSG.REMIND) {
		mascot.showBubble(
			typeof msg.text === "string" ? msg.text : getRandomReminderText(),
			msg.force,
		);
		sendResponse({ ok: true });
	}
	return false;
});

function main() {
	if (window.top !== window.self) return; // 只注入顶层页面
	if (!document.documentElement) return;
	// 独立 SVG/XML 文档没有 HTMLElement.style，且无法承载常规 HTML 浮层。
	if (!(document.documentElement instanceof HTMLElement)) return;
	ensureMascot();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
	main();
}
