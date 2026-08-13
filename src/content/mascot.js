// Duo 猫头鹰控制器：创建页面底部的 Lottie Duo 动画。
// Duo 常驻角落，保留动画、气泡提醒与点击交互。
import lottie from "lottie-web/build/player/lottie_light";
import { MSG, LEARNING_URL, safeHttpUrl } from "../shared/constants.js";

const ANIMATION_PATHS = {
	reader: "animations/duo-reader.json",
	path: "animations/duo-sway.json",
};
const HIDDEN_ANIMATION_UNLOAD_DELAY = 60_000;

function normalizeAppearance(value) {
	return Object.prototype.hasOwnProperty.call(ANIMATION_PATHS, value)
		? value
		: "reader";
}

async function getAnimationData(appearance, signal) {
	const key = normalizeAppearance(appearance);
	const response = await fetch(chrome.runtime.getURL(ANIMATION_PATHS[key]), {
		signal,
		cache: "force-cache",
	});
	if (!response.ok) throw new Error(`动画资源加载失败：${response.status}`);
	return response.json();
}

function normalizeDragPosition(value) {
	const x = Number(value?.x);
	const y = Number(value?.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return {
		x: Math.min(1, Math.max(0, x)),
		y: Math.min(1, Math.max(0, y)),
	};
}

export function createMascot(opts = {}) {
	const settings = {
		appearance: "reader",
		position: "right",
		dragPosition: null,
		size: 120,
		learningUrl: LEARNING_URL,
		snoozeMinutes: 15,
		onPositionChange: null,
		...opts,
	};
	settings.appearance = normalizeAppearance(settings.appearance);
	settings.dragPosition = normalizeDragPosition(settings.dragPosition);

	let root = null;
	let mascotEl = null;
	let lottieEl = null;
	let lottieAnimation = null;
	let animationRequestId = 0;
	let animationController = null;
	let loadedAppearance = null;
	let hiddenAnimationTimer = null;
	let bubble = null;
	let msgEl = null;
	let goBtn = null;
	let laterBtn = null;

	let bubbleTimer = null;
	let positionFrame = null;
	let dragState = null;
	let ignoreClickUntil = 0;
	let destroyed = false;
	let lastRemindAt = 0;
	let pendingBubble = null;

	// 打开外链：不用 window.open，改用带 noopener 的锚点点击（与 window.open 等价、同样安全）
	function openExternal(url) {
		const a = document.createElement("a");
		a.href = url;
		a.target = "_blank";
		a.rel = "noopener noreferrer";
		a.hidden = true;
		(document.body || document.documentElement).append(a);
		a.click();
		a.remove();
	}

	function applyRootSettings() {
		if (!root) return;
		const configuredSize = Math.min(
			180,
			Math.max(80, Number(settings.size) || 120),
		);
		settings.size = configuredSize;
		root.setAttribute("data-position", settings.position);
		root.setAttribute("data-appearance", settings.appearance);
		root.style.setProperty("--duo-size", `${Math.round(configuredSize)}px`);
		if (root.isConnected) schedulePositionUpdate();
	}

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function setPixelPosition(left, top) {
		if (!root) return;
		const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
		const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
		root.setAttribute("data-dragged", "true");
		root.style.left = `${Math.round(clamp(left, 0, maxLeft))}px`;
		root.style.top = `${Math.round(clamp(top, 0, maxTop))}px`;
		root.style.right = "auto";
		root.style.bottom = "auto";
	}

	function applyPosition() {
		if (!root || destroyed) return;
		const position = normalizeDragPosition(settings.dragPosition);
		settings.dragPosition = position;
		if (!position) {
			root.removeAttribute("data-dragged");
			root.style.removeProperty("left");
			root.style.removeProperty("top");
			root.style.removeProperty("right");
			root.style.removeProperty("bottom");
			return;
		}
		const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
		const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
		setPixelPosition(position.x * maxLeft, position.y * maxTop);
	}

	function schedulePositionUpdate() {
		if (positionFrame !== null) cancelAnimationFrame(positionFrame);
		positionFrame = requestAnimationFrame(() => {
			positionFrame = null;
			applyPosition();
			if (root?.classList.contains("bubble-open")) updateBubblePlacement();
		});
	}

	function currentNormalizedPosition() {
		const rect = root.getBoundingClientRect();
		const maxLeft = Math.max(0, window.innerWidth - rect.width);
		const maxTop = Math.max(0, window.innerHeight - rect.height);
		return {
			x: maxLeft ? clamp(rect.left / maxLeft, 0, 1) : 0,
			y: maxTop ? clamp(rect.top / maxTop, 0, 1) : 0,
		};
	}

	function updateBubblePlacement() {
		if (!root || !bubble) return;
		const rootRect = root.getBoundingClientRect();
		const bubbleWidth = bubble.offsetWidth;
		const bubbleHeight = bubble.offsetHeight;
		const viewportGap = 8;
		const centeredLeft = rootRect.left + rootRect.width / 2 - bubbleWidth / 2;
		const minLeft = viewportGap;
		const maxLeft = Math.max(minLeft, window.innerWidth - bubbleWidth - viewportGap);
		const shiftX = clamp(centeredLeft, minLeft, maxLeft) - centeredLeft;
		const aboveSpace = rootRect.top - viewportGap;
		const belowSpace = window.innerHeight - rootRect.bottom - viewportGap;
		root.style.setProperty("--bubble-shift-x", `${Math.round(shiftX)}px`);
		root.setAttribute(
			"data-bubble-placement",
			aboveSpace < bubbleHeight && belowSpace > aboveSpace ? "below" : "above",
		);
	}

	function onPointerDown(event) {
		if (
			dragState ||
			!event.isPrimary ||
			(event.pointerType === "mouse" && event.button !== 0)
		) {
			return;
		}
		const rect = root.getBoundingClientRect();
		dragState = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startLeft: rect.left,
			startTop: rect.top,
			dragging: false,
		};
		mascotEl.setPointerCapture?.(event.pointerId);
	}

	function onPointerMove(event) {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		const deltaX = event.clientX - dragState.startX;
		const deltaY = event.clientY - dragState.startY;
		if (!dragState.dragging) {
			if (Math.hypot(deltaX, deltaY) < 5) return;
			dragState.dragging = true;
			root.classList.add("is-dragging");
		}
		event.preventDefault();
		setPixelPosition(
			dragState.startLeft + deltaX,
			dragState.startTop + deltaY,
		);
		if (root.classList.contains("bubble-open")) updateBubblePlacement();
	}

	function finishDrag(event) {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		const wasDragging = dragState.dragging;
		dragState = null;
		root.classList.remove("is-dragging");
		if (mascotEl.hasPointerCapture?.(event.pointerId)) {
			mascotEl.releasePointerCapture(event.pointerId);
		}
		if (!wasDragging) return;
		ignoreClickUntil = Date.now() + 400;
		settings.dragPosition = currentNormalizedPosition();
		if (typeof settings.onPositionChange === "function") {
			Promise.resolve(settings.onPositionChange(settings.dragPosition)).catch(
				() => {},
			);
		}
	}

	function onMascotClick(event) {
		if (Date.now() < ignoreClickUntil) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		openDuolingo();
	}

	function invalidateAnimationRequest() {
		animationRequestId += 1;
		animationController?.abort();
		animationController = null;
		return animationRequestId;
	}

	function unloadAnimation() {
		invalidateAnimationRequest();
		lottieAnimation?.destroy();
		lottieAnimation = null;
		loadedAppearance = null;
	}

	async function loadAnimation() {
		if (!lottieEl || destroyed || document.hidden) return;
		const appearance = normalizeAppearance(settings.appearance);
		settings.appearance = appearance;
		root.setAttribute("data-appearance", appearance);
		if (lottieAnimation && loadedAppearance === appearance) {
			if (animationController) invalidateAnimationRequest();
			lottieAnimation.play();
			return;
		}
		const requestId = invalidateAnimationRequest();
		const controller = new AbortController();
		animationController = controller;
		try {
			const animationData = await getAnimationData(appearance, controller.signal);
			if (destroyed || requestId !== animationRequestId || !lottieEl) return;
			lottieAnimation?.destroy();
			lottieAnimation = lottie.loadAnimation({
				container: lottieEl,
				renderer: "svg",
				loop: true,
				autoplay: !document.hidden,
				animationData,
				rendererSettings: {
					preserveAspectRatio: "xMidYMid meet",
					progressiveLoad: true,
				},
			});
			loadedAppearance = appearance;
		} catch {
			// 下次切换形象时会重新请求；当前动画（若有）保持可见。
		} finally {
			if (requestId === animationRequestId) animationController = null;
		}
	}

	// ---------- DOM 搭建 ----------
	function build() {
		root = document.createElement("div");
		root.id = "duochrome-root";
		applyRootSettings();

		bubble = document.createElement("div");
		bubble.className = "duochrome-bubble";
		msgEl = document.createElement("div");
		msgEl.className = "duochrome-bubble-msg";
		const actions = document.createElement("div");
		actions.className = "duochrome-bubble-actions";
		goBtn = document.createElement("button");
		goBtn.type = "button";
		goBtn.className = "duochrome-btn-go";
		goBtn.textContent = "去打卡";
		laterBtn = document.createElement("button");
		laterBtn.type = "button";
		laterBtn.className = "duochrome-btn-later";
		laterBtn.textContent = "稍后提醒";
		actions.append(goBtn, laterBtn);
		bubble.append(msgEl, actions);

		mascotEl = document.createElement("div");
		mascotEl.className = "duochrome-mascot";
		mascotEl.title = "拖动调整位置，点击去多邻国打卡";
		mascotEl.setAttribute("role", "button");
		mascotEl.setAttribute(
			"aria-label",
			"Duo 猫头鹰，可拖动调整位置，点击打开多邻国打卡页",
		);
		mascotEl.tabIndex = 0;
		lottieEl = document.createElement("div");
		lottieEl.className = "duochrome-lottie";
		lottieEl.setAttribute("aria-hidden", "true");
		mascotEl.append(lottieEl);

		root.append(bubble, mascotEl);
		(document.body || document.documentElement).append(root);

		if (!document.hidden) loadAnimation();
		schedulePositionUpdate();

		mascotEl.addEventListener("click", onMascotClick);
		mascotEl.addEventListener("pointerdown", onPointerDown);
		mascotEl.addEventListener("pointermove", onPointerMove);
		mascotEl.addEventListener("pointerup", finishDrag);
		mascotEl.addEventListener("pointercancel", finishDrag);
		mascotEl.addEventListener("lostpointercapture", finishDrag);
		mascotEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openDuolingo();
			}
		});
		goBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			openDuolingo();
		});
		laterBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			snooze();
		});
		document.addEventListener("visibilitychange", onVisibility, {
			passive: true,
		});
		window.addEventListener("resize", schedulePositionUpdate, { passive: true });
	}

	// ---------- 气泡 ----------
	function showBubble(text, force = false) {
		if (destroyed) return;
		const now = Date.now();
		if (!force && now - lastRemindAt < 60000) return; // 1 分钟内不重复打扰
		lastRemindAt = now;
		if (document.hidden) {
			pendingBubble = { text, force: true };
			return;
		}
		msgEl.textContent = text;
		updateBubblePlacement();
		root.classList.add("bubble-open");
		clearTimeout(bubbleTimer);
		bubbleTimer = setTimeout(hideBubble, 30000);
	}

	function hideBubble() {
		if (root) root.classList.remove("bubble-open");
	}

	function onVisibility() {
		if (document.hidden) {
			lottieAnimation?.pause();
			clearTimeout(hiddenAnimationTimer);
			hiddenAnimationTimer = setTimeout(() => {
				hiddenAnimationTimer = null;
				if (document.hidden) unloadAnimation();
			}, HIDDEN_ANIMATION_UNLOAD_DELAY);
			return;
		}
		clearTimeout(hiddenAnimationTimer);
		hiddenAnimationTimer = null;
		if (lottieAnimation && loadedAppearance === settings.appearance) {
			lottieAnimation.play();
		} else {
			loadAnimation();
		}
		if (pendingBubble) {
			const p = pendingBubble;
			pendingBubble = null;
			showBubble(p.text, true);
		}
	}

	// ---------- 交互 ----------
	function openDuolingo() {
		hideBubble();
		const url = safeHttpUrl(settings.learningUrl, LEARNING_URL);
		try {
			chrome.runtime.sendMessage({ type: MSG.OPEN_DUOLINGO, url }, (response) => {
				// 背景页不可用时（如 devtools 预览）回退本地打开
				if (chrome.runtime.lastError || !response?.ok) openExternal(url);
			});
		} catch {
			openExternal(url);
		}
	}

	function snooze() {
		hideBubble();
		try {
			chrome.runtime.sendMessage({
				type: MSG.SNOOZE,
				minutes: settings.snoozeMinutes,
			});
		} catch {
			/* 无 background 时忽略 */
		}
	}

	// ---------- 设置热更新 ----------
	function setSettings(partial = {}) {
		const previousAppearance = settings.appearance;
		Object.assign(settings, partial);
		settings.appearance = normalizeAppearance(settings.appearance);
		settings.dragPosition = normalizeDragPosition(settings.dragPosition);
		if (root) {
			applyRootSettings();
			if (settings.appearance !== previousAppearance && !document.hidden) {
				loadAnimation();
			}
		}
	}

	// ---------- 销毁 ----------
	function destroy() {
		destroyed = true;
		clearTimeout(bubbleTimer);
		clearTimeout(hiddenAnimationTimer);
		if (positionFrame !== null) cancelAnimationFrame(positionFrame);
		unloadAnimation();
		if (root) {
			root.remove();
			root = mascotEl = lottieEl = bubble = msgEl = goBtn = laterBtn = null;
		}
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("resize", schedulePositionUpdate);
	}

	build();
	return { showBubble, hideBubble, setSettings, destroy };
}
