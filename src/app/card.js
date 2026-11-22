// Draw a taste-profile share card (1200×630 PNG) on a canvas, entirely on this device.

const W = 1200, H = 630;

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** profile: { name, traits: [label], favorites: [{t, k}], books, films, url } → Promise<Blob> */
export function drawCard(profile) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1f3a34"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f4ead5"; ctx.fillRect(40, 40, W - 80, H - 80);
  ctx.fillStyle = "#c2552d"; ctx.fillRect(40, 40, 18, H - 80);
  const serif = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = "#5a4a3a"; ctx.font = `600 26px ${sans}`;
  ctx.fillText("MY READING & WATCHING TASTE", 100, 112);
  ctx.fillStyle = "#1f2a27"; ctx.font = `700 72px ${serif}`;
  let y = 196;
  for (const line of wrap(ctx, profile.name, W - 200).slice(0, 2)) { ctx.fillText(line, 100, y); y += 80; }
  ctx.font = `400 30px ${sans}`; ctx.fillStyle = "#3c3229";
  if (profile.traits.length) {
    for (const line of wrap(ctx, "Loves " + profile.traits.join(" · "), W - 200).slice(0, 2)) { ctx.fillText(line, 100, y + 10); y += 42; }
  }
  if (profile.favorites.length) {
    ctx.font = `italic 400 28px ${serif}`; ctx.fillStyle = "#5a4a3a";
    for (const line of wrap(ctx, "Favorites: " + profile.favorites.map((f) => f.t).join(", "), W - 200).slice(0, 2)) { ctx.fillText(line, 100, y + 30); y += 38; }
  }
  ctx.font = `600 26px ${sans}`; ctx.fillStyle = "#1f3a34";
  ctx.fillText(`${profile.books} books · ${profile.films} films`, 100, H - 92);
  ctx.textAlign = "right"; ctx.fillStyle = "#c2552d";
  ctx.fillText("Shelf & Screen", W - 100, H - 92);
  ctx.textAlign = "left";
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
}
