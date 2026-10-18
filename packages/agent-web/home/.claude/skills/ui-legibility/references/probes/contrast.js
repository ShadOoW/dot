// WCAG contrast of every distinct (colour, background, size, weight) pair under ROOT, shadow
// roots included.
//   playwright-cli -s=<session> --raw eval "$(cat contrast.js)"
// Run it once per palette the surface ships (set the theme, re-run, same page state).
//
// Three things a simpler probe gets wrong, each measured on a real page:
//   - a computed colour is not always rgb(): a token-based design system returns oklch(...),
//     color-mix(...) or lab(...), and a regex reading the first three numbers as r, g, b
//     reports garbage. Every colour here is resolved by painting it on a 1x1 canvas.
//   - the background is composited from the ancestor chain, across shadow hosts: a text
//     node's own backgroundColor is almost always transparent.
//   - a library's surface (a code diff, an editor) often renders inside a shadow root, which
//     a document-level TreeWalker never enters. On logos' walkthrough page every failing pair
//     was in there: syntax colours at 1.6:1 beside page text that all cleared 4.7:1.
() => {
	const ROOT = 'body';
	const ZONES = [
		['header', 'header'],
		['main', 'main'],
	];

	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	const rgba = (css) => {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#000';
		ctx.fillStyle = css;
		ctx.fillRect(0, 0, 1, 1);
		const d = ctx.getImageData(0, 0, 1, 1).data;
		return [d[0], d[1], d[2], d[3] / 255];
	};
	const lum = (rgb) => {
		const c = rgb.slice(0, 3).map((v) => v / 255)
			.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
		return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	};
	const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
	const parentOf = (node) => node.parentElement || (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
	const bgOf = (el) => {
		const stack = [];
		for (let node = el; node; node = parentOf(node)) {
			const c = rgba(getComputedStyle(node).backgroundColor);
			if (c[3] > 0) stack.push(c);
		}
		return stack.reduceRight((acc, c) => over(c, acc), [255, 255, 255]);
	};
	const opacityOf = (el) => {
		let o = 1;
		for (let node = el; node; node = parentOf(node)) o *= Number(getComputedStyle(node).opacity);
		return o;
	};
	const hex = (rgb) => '#' + rgb.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
	const zoneOf = (el) => {
		for (let node = el; node; node = parentOf(node)) {
			const hit = ZONES.find(([, sel]) => node.matches && node.matches(sel));
			if (hit) return hit[0];
		}
		return 'other';
	};

	const root = document.querySelector(ROOT);
	if (!root) return JSON.stringify({ error: 'root not found: ' + ROOT });
	const roots = [root];
	for (let i = 0; i < roots.length; i++) {
		for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
	}
	const seen = new Map();
	for (const scope of roots) {
		const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		let n;
		while ((n = walker.nextNode())) {
			const text = (n.nodeValue || '').trim();
			if (!text) continue;
			const el = n.parentElement;
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (!rect.width || !rect.height) continue;
			const cs = getComputedStyle(el);
			if (cs.visibility === 'hidden') continue;
			const bg = bgOf(el);
			const fg = over([...rgba(cs.color).slice(0, 3), rgba(cs.color)[3] * opacityOf(el)], bg);
			const l1 = lum(fg);
			const l2 = lum(bg);
			const ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
			const px = parseFloat(cs.fontSize);
			const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
			const zone = zoneOf(el);
			const key = [zone, hex(fg), hex(bg), px, cs.fontWeight].join('|');
			if (seen.has(key)) {
				seen.get(key).count += 1;
				continue;
			}
			seen.set(key, {
				zone,
				shadow: scope !== root,
				px,
				weight: cs.fontWeight,
				fg: hex(fg),
				bg: hex(bg),
				ratio,
				threshold: large ? 3 : 4.5,
				passes: ratio >= (large ? 3 : 4.5),
				sample: text.slice(0, 26),
				count: 1,
			});
		}
	}
	const pairs = [...seen.values()].sort((a, b) => a.ratio - b.ratio);
	return JSON.stringify({
		theme: document.documentElement.dataset.theme || null,
		shadowRoots: roots.length - 1,
		failing: pairs.filter((p) => !p.passes),
		lowestPassing: pairs.filter((p) => p.passes).slice(0, 8),
	});
}
