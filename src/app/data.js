// Fetch the catalog and recognition list from this site (same origin only) and build the model once.
import { buildModel } from "../engine/model.js";

let pending = null;

export function base() { return document.body.dataset.base || "/"; }
export function version() { return document.body.dataset.v || "0"; }

async function getJson(name) {
  const res = await fetch(`${base()}data/${name}?v=${version()}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Couldn't load ${name} (${res.status}). Check your connection and reload.`);
  return res.json();
}

/** Resolves to the model. The recognition list is optional: if it fails, picks still work from the catalog. */
export function loadModel() {
  if (!pending) {
    pending = (async () => {
      const [catalog, recog] = await Promise.all([getJson("catalog.json"), getJson("recog.json").catch(() => null)]);
      return buildModel(catalog, recog);
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

export function pagePath(item) {
  return `${base()}${item.k === "b" ? "books-like" : "movies-like"}/${item.id}/`;
}
