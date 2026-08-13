// DuoChrome 共享常量与默认设置

// 消息类型（content <-> background）
export const MSG = {
	REMIND: "DUOCHROME_REMIND", // background -> content：弹出气泡
	SETTINGS_UPDATED: "DUOCHROME_SETTINGS_UPDATED", // background -> content：热同步设置
	SAVE_SETTINGS: "DUOCHROME_SAVE_SETTINGS", // options/content -> background：串行保存设置
	OPEN_DUOLINGO: "DUOCHROME_OPEN_DUOLINGO", // content -> background：打开打卡页
	SNOOZE: "DUOCHROME_SNOOZE", // content -> background：稍后提醒
};

export const ALARM_ID = "duochrome-reminder";

export const LEARNING_URL = "https://www.duolingo.com/learn";

export const REMINDER_TEXTS = [
	"该打卡啦！保持连胜",
	"多儿在看着你。",
	"别让你的多邻国鸟伤心。",
	"你的连胜要没了，多儿现在很难过。",
	"看来你忘记了今天的练习，多儿正提着菜刀在路上了。",
	"只要你按时打卡，大家就都相安无事。",
	"还有时间！快来延续你的连胜！",
	"别让昨天的努力白费，5分钟就能保住连胜！",
	"你的连胜正在流逝，快用一课来拯救它！",
	"连胜不仅是个数字，更是你坚持的勋章。",
	"这些通知似乎不起作用，我们以后不发了。（除非你现在点开）",
	"你有时间刷朋友圈，没时间学5分钟外语吗？",
	"多儿累了，多儿只是希望你能优秀。",
	"嗨！该给大脑做个5分钟的热身运动了。",
	"每天进步一点点，今天你想学点什么？",
	"碎片时间别浪费，点开多邻国学一会。",
];

export function getRandomReminderText() {
	return REMINDER_TEXTS[Math.floor(Math.random() * REMINDER_TEXTS.length)];
}

export function isHttpUrl(value) {
	try {
		const url = new URL(String(value || ""));
		return (
			(url.protocol === "https:" || url.protocol === "http:") &&
			Boolean(url.hostname) &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

export function safeHttpUrl(value, fallback = LEARNING_URL) {
	return isHttpUrl(value) ? new URL(String(value)).href : fallback;
}

export const DEFAULT_SETTINGS = {
	enabled: true,
	reminderTimes: ["20:00"], // 每日提醒时间，格式 "HH:MM"
	snoozeMinutes: 15, // 「稍后提醒」间隔（分钟）
	learningUrl: LEARNING_URL,
	duo: {
		appearance: "reader", // 'reader' | 'path'，Duo 动画形象
		position: "right", // 'left' | 'right'，Duo 常驻角落
		dragPosition: null, // { x, y }：在可移动视口范围内的归一化拖动位置
		size: 120, // px
		sizeVersion: 2, // v2：尺寸档位由 64–144 放大为 80–180
	},
};
