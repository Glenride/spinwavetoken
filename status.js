/* SpinWave — single source of truth for every status label on the site.
   index.html, trust.html, flow.html and token.html all read this file,
   so the site can never contradict itself about what is live. */
window.SPIN_STATUS = [
  { label: "Token", text: "Live on Base", state: "live" },
  { label: "Trading", text: "Not yet — pool deployed, no trades", state: "pending" },
  { label: "Scholar recognition", text: "Locked — opens Phase 1", state: "locked" },
  { label: "Reader licensing", text: "Locked — opens Phase 2", state: "locked" },
  { label: "The tale", text: "Open", state: "live" }
];

/* Verified token facts (on-chain, Base). Anything not listed here
   is not claimed anywhere on the site. */
/* STANZA is the current token. $SPIN (kept below) is superseded history. */
window.STANZA_META = {
  name: "stanza",
  symbol: "STANZA",
  chain: "Base",
  contract: "0xf629f16ba91086e266accc417d10742f76207ba3",
  supply: "100,000,000,000",
  launched: "October 17, 2026",
  launchRoute: "Bankr on Base",
  poolNote: "85B STANZA in the liquidity pool, paired with Wrapped TAO. 15B STANZA under creator vesting (1 year, 30-day cliff).",
  trades: "No trades have occurred since deployment."
};
window.SPIN_META = {
  name: "spinwave",
  symbol: "$SPIN",
  status: "superseded",
  chain: "Base",
  contract: "0x4c972afefa2e4552307b87cf944e53136c361ba3",
  supply: "100,000,000,000",
  decimals: 18,
  launched: "September 27, 2026",
  launchRoute: "Bankr → Doppler Airlock → Uniswap V4",
  poolNote: "85B $SPIN sat in the Uniswap V4 PoolManager, paired with ForeverMoney Wrapped TAO; the pool never saw a single trade.",
  trades: "No trades ever occurred."
};
