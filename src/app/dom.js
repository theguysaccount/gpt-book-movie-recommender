// Tiny DOM helpers. No framework, no innerHTML with data: every string goes in as text.

/** h("button", { class: "btn", onclick }, "Label", child, …) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** "★★★★½" for 4.5; "" for null. */
export function starText(r) {
  if (r == null) return "";
  const full = Math.floor(r), half = r - full >= 0.5;
  return "★".repeat(full) + (half ? "½" : "");
}

/** "1,204" */
export const fmt = (n) => Number(n).toLocaleString("en-US");

/** Count something only when the site has an analytics key and the visitor hasn't asked not to be tracked. */
export function track(name) {
  try {
    const gc = document.body.dataset.gc;
    if (!gc || navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    const img = new Image();
    img.src = `${gc}?p=${encodeURIComponent("/event/" + name)}&t=${encodeURIComponent(name)}&e=true&rnd=${Math.random().toString(36).slice(2)}`;
  } catch { /* counting is optional */ }
}

export function pageview() {
  try {
    const gc = document.body.dataset.gc;
    if (!gc || navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    const img = new Image();
    img.src = `${gc}?p=${encodeURIComponent(location.pathname)}&r=${encodeURIComponent(document.referrer ? new URL(document.referrer).origin : "")}&rnd=${Math.random().toString(36).slice(2)}`;
  } catch { /* counting is optional */ }
}
