// The shared taste-profile page (/p/#…). The profile is read from the link's #fragment, which never reaches a server.
import { h, clear } from "./dom.js";
import { loadModel, pagePath, base } from "./data.js";
import { decodeProfile } from "./share.js";
import { listPhrase } from "../engine/similar.js";

export async function boot() {
  const root = document.getElementById("shared");
  const status = document.getElementById("status");
  const code = location.hash.slice(1);
  if (!code) { status.textContent = "This link has no profile in it."; return; }
  let model;
  try { model = await loadModel(); } catch (e) { status.textContent = e.message; return; }
  const p = decodeProfile(code, model);
  if (!p || !p.n) { status.textContent = "This profile link is incomplete or damaged."; return; }
  clear(root);
  const tagLabel = new Map(model.tags.map((t) => [t.key, t.label]));
  root.append(
    h("p", { class: "eyebrow" }, "A reading and watching taste"),
    h("h1", { class: "archetype" }, p.n),
    p.t.length ? h("p", { class: "lede" }, "Loves ", listPhrase(p.t.map((k) => tagLabel.get(k))), ".") : null,
    h("p", { class: "sub" }, `From ${p.b} books and ${p.f} films.`),
    p.c.length ? h("section", {}, h("h2", {}, "Favorites"), h("ul", { class: "rows" }, p.c.map((kn) => h("li", { class: "row" },
      h("span", { class: `kind kind-${kn.k}` }, kn.k === "b" ? "Book" : "Film"), h("a", { class: "t", href: pagePath(kn.item) }, kn.t), h("span", { class: "meta" }, `${kn.c} · ${kn.y}`))))) : null,
    h("aside", { class: "cta-box" }, h("h2", {}, "What's yours?"),
      h("p", {}, "Import your Goodreads, StoryGraph, Letterboxd or IMDb export and get picks ranked for your own taste, with the reasons. Nothing is uploaded."),
      h("p", {}, h("a", { class: "btn", href: base() }, "Get my picks"))));
}
