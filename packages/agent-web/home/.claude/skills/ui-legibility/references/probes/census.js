// Type-size and clipping census, split by ownership zone.
//   playwright-cli -s=<session> --raw eval "$(cat census.js)"
// Edit ROOT and ZONES for the screen under test. ZONES is ordered: first match wins.
() => {
	const ROOT = '.MuiDataGrid-root';
	const ZONES = [
		['header', '.MuiDataGrid-columnHeader'],
		['card', '.MuiDataGrid-cell:not(.MuiDataGrid-cell--pinnedLeft)'],
		['axis', '.MuiDataGrid-cell--pinnedLeft'],
	];
	const SMALL_PX = 10;

	const root = document.querySelector(ROOT);
	if (!root) return JSON.stringify({ error: 'root not found: ' + ROOT });
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes = [];
	let n;
	while ((n = walker.nextNode())) {
		const text = (n.nodeValue || '').trim();
		if (!text) continue;
		const el = n.parentElement;
		if (!el) continue;
		const rect = el.getBoundingClientRect();
		if (!rect.width || !rect.height) continue;
		const cs = getComputedStyle(el);
		const zone = (ZONES.find(([, sel]) => el.closest(sel)) || ['other'])[0];
		nodes.push({
			text,
			px: parseFloat(cs.fontSize),
			color: cs.color,
			weight: cs.fontWeight,
			zone,
			// Only meaningful for noWrap text: a line-clamp legitimately overflows scrollHeight.
			clipped: cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth,
			avail: el.clientWidth,
			wants: el.scrollWidth,
		});
	}
	const tally = (pred) => nodes.filter(pred).reduce((acc, x) => {
		acc[x.zone] = (acc[x.zone] || 0) + 1;
		return acc;
	}, {});
	const byPx = nodes.reduce((acc, x) => {
		acc[x.px] = (acc[x.px] || 0) + 1;
		return acc;
	}, {});
	const small = (x) => x.px <= SMALL_PX;
	return JSON.stringify({
		total: nodes.length,
		byPx,
		smallCount: nodes.filter(small).length,
		smallByZone: tally(small),
		clippedCount: nodes.filter((x) => x.clipped).length,
		clippedByZone: tally((x) => x.clipped),
		clippedList: nodes.filter((x) => x.clipped)
			.sort((a, b) => (b.wants - b.avail) - (a.wants - a.avail))
			.map((x) => ({ zone: x.zone, px: x.px, avail: x.avail, wants: x.wants, t: x.text.slice(0, 46) })),
		smallList: nodes.filter(small).map((x) => ({ zone: x.zone, px: x.px, color: x.color, t: x.text.slice(0, 30) })),
	});
}
