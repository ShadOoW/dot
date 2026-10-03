// WCAG contrast of every distinct (colour, background, size, weight) pair under ROOT.
//   playwright-cli -s=<session> --raw eval "$(cat contrast.js)"
// The background is composited from the ancestor chain: reading the declared
// backgroundColor of a text node's parent almost always yields rgba(0,0,0,0).
() => {
	const ROOT = '.MuiDataGrid-root';
	const ZONES = [
		['header', '.MuiDataGrid-columnHeader'],
		['card', '.MuiDataGrid-cell:not(.MuiDataGrid-cell--pinnedLeft)'],
		['axis', '.MuiDataGrid-cell--pinnedLeft'],
	];

	const lum = (rgb) => {
		const c = rgb.map((v) => v / 255)
			.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
		return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	};
	const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
	const over = (fg, bg) => {
		const a = fg.length > 3 ? fg[3] : 1;
		return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
	};
	const bgOf = (el) => {
		const stack = [];
		let node = el;
		while (node && node !== document.documentElement) {
			const c = parse(getComputedStyle(node).backgroundColor);
			if (c.length && (c.length < 4 || c[3] > 0)) stack.push(c);
			node = node.parentElement;
		}
		return stack.reduceRight((acc, c) => over(c, acc), [255, 255, 255]);
	};
	const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

	const root = document.querySelector(ROOT);
	if (!root) return JSON.stringify({ error: 'root not found: ' + ROOT });
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const seen = new Map();
	let n;
	while ((n = walker.nextNode())) {
		const text = (n.nodeValue || '').trim();
		if (!text) continue;
		const el = n.parentElement;
		const rect = el.getBoundingClientRect();
		if (!rect.width || !rect.height) continue;
		const cs = getComputedStyle(el);
		const bg = bgOf(el);
		const fg = over(parse(cs.color), bgOf(el.parentElement || el));
		const l1 = lum(fg);
		const l2 = lum(bg);
		const ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
		const px = parseFloat(cs.fontSize);
		const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
		const key = [cs.color, hex(bg), px, cs.fontWeight].join('|');
		if (seen.has(key)) continue;
		seen.set(key, {
			zone: (ZONES.find(([, sel]) => el.closest(sel)) || ['other'])[0],
			px,
			weight: cs.fontWeight,
			fg: hex(fg),
			bg: hex(bg),
			ratio,
			threshold: large ? 3 : 4.5,
			passes: ratio >= (large ? 3 : 4.5),
			sample: text.slice(0, 26),
		});
	}
	return JSON.stringify([...seen.values()].sort((a, b) => a.ratio - b.ratio));
}
