// Shareable taste profiles. The profile travels in the link's #fragment, which browsers never send to a server.
// Only a short summary is shared: a name, up to six traits, up to five favorite catalog titles and two counts.

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

/** { n: name, t: ["m:bleak", …], c: ["b:gone-girl", …], b: 120, f: 340 } → "…" */
export function encodeProfile(p) {
  const clean = {
    n: String(p.n || "").slice(0, 60),
    t: (p.t || []).slice(0, 6).map(String),
    c: (p.c || []).slice(0, 5).map(String),
    b: Math.max(0, Math.min(99999, p.b | 0)),
    f: Math.max(0, Math.min(99999, p.f | 0)),
  };
  return b64url(JSON.stringify(clean));
}

/** Decode and validate against the catalog. Returns null for anything malformed. */
export function decodeProfile(code, model) {
  try {
    const raw = JSON.parse(unb64url(String(code || "").slice(0, 2000)));
    if (!raw || typeof raw !== "object") return null;
    const tagKeys = new Set(model.tags.map((t) => t.key));
    const ids = new Map();
    for (let i = 0; i < model.nCurated; i++) ids.set(`${model.known[i].k}:${model.known[i].item.id}`, model.known[i]);
    return {
      n: typeof raw.n === "string" ? raw.n.slice(0, 60) : "",
      t: (Array.isArray(raw.t) ? raw.t : []).filter((k) => tagKeys.has(k)).slice(0, 6),
      c: (Array.isArray(raw.c) ? raw.c : []).map((id) => ids.get(id)).filter(Boolean).slice(0, 5),
      b: Number.isInteger(raw.b) ? raw.b : 0,
      f: Number.isInteger(raw.f) ? raw.f : 0,
    };
  } catch { return null; }
}
