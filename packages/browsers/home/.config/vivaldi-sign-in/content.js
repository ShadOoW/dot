// dev-ready 04: clicks a button already visible on the page — never reads, stores or sends a
// credential, cookie or token (Global invariants). TARGET_EMAILS is not a secret: it is the
// email the account chooser already displays, used only to pick the right tile when more than
// one account is signed in.
const TARGET_EMAILS = ["younes.el-alami@bruce.work"];

function clickAccountTile() {
  const tiles = [...document.querySelectorAll("[data-identifier]")];
  const tile = tiles.find((t) => TARGET_EMAILS.includes(t.getAttribute("data-identifier")));
  if (!tile) return false;
  (tile.closest('[role="link"],[role="button"],button,a') ?? tile).click();
  return true;
}

function clickAwsAllow() {
  const phrases = ["allow access", "confirm and continue", "continue"];
  const el = [...document.querySelectorAll('button,[role="button"]')].find((b) =>
    phrases.includes((b.textContent ?? "").trim().toLowerCase()),
  );
  if (!el) return false;
  el.click();
  return true;
}

const run = () => (location.hostname === "accounts.google.com" ? clickAccountTile() : clickAwsAllow());
new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
run();
