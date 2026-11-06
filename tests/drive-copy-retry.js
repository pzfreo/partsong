// On a computer a link is copied to the clipboard. Safari refuses the copy when
// making the link took too long after the tap (NotAllowedError): that's "retry"
// (Ready to share: tap again), not an error. Run against http://127.0.0.1:8765/index.html.
const { shareLink } = await import("/share.js");
let refuse = true;
const copied = [];
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { if (refuse) { refuse = false; throw new DOMException("The request is not allowed by the user agent or the platform in the current context", "NotAllowedError"); } copied.push(t); } } });
const first = await shareLink("https://partsong.app/#x", "Song");
const second = await shareLink("https://partsong.app/#x", "Song");
let other;
navigator.clipboard.writeText = async () => { throw new Error("broken"); };
try { await shareLink("https://partsong.app/#x", "Song"); } catch (e) { other = e.message; }
window.result = { first, second, copied, otherErrorThrown: other };
