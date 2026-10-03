// Does a string fit, and how much headroom is there — measured, never arithmetic.
//   playwright-cli -s=<session> --raw eval "$(cat fit.js)"
// Finds the REAL ceiling by growing the live element until it clips, because
// clientWidth on a shrink-to-fit element reports its content, not its limit.
() => {
	const TARGET = '.MuiDataGrid-columnHeader[data-field="__tree_data_group__"] .MuiTypography-root';
	const CANDIDATES = [
		'Entreprise · Poste',
		'Entreprise · Commande',
		'Entreprise · Fiche de poste',
	];

	const el = document.querySelector(TARGET);
	if (!el) return JSON.stringify({ error: 'target not found: ' + TARGET });
	const exact = (node) => Math.round(node.getBoundingClientRect().width * 100) / 100;
	const clips = () => el.scrollWidth > el.clientWidth;
	const shipped = el.textContent;
	const state = () => ({
		text: el.textContent,
		box: exact(el),
		clientW: el.clientWidth,
		scrollW: el.scrollWidth,
		parentClientW: el.parentElement.clientWidth,
		clipped: clips(),
	});
	const out = { shipped: state(), candidates: {}, ceiling: null };

	// Grow the live element one character at a time: the transition is the true ceiling.
	let lastFit = null;
	for (let pad = 0; pad <= 40; pad++) {
		el.textContent = shipped + 'X'.repeat(pad);
		if (clips()) {
			out.ceiling = { firstClipAtPad: pad, ...state(), lastFit };
			break;
		}
		lastFit = { pad, ...state() };
	}
	if (!out.ceiling) out.ceiling = { firstClipAtPad: null, note: 'never clipped within 40 chars', lastFit };

	CANDIDATES.forEach((s) => {
		el.textContent = s;
		out.candidates[s] = state();
	});

	el.textContent = shipped;
	out.restored = state();
	out.headroom = out.ceiling.lastFit
		? Math.round((out.ceiling.lastFit.parentClientW - out.shipped.box) * 100) / 100
		: null;
	return JSON.stringify(out, null, 1);
}
