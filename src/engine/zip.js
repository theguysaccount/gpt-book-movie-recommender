// Read text files out of a ZIP archive in the browser (or Node 18+), with no library:
// the central directory is parsed by hand and entries are inflated with DecompressionStream.
// Used for the Letterboxd export, which is a .zip of CSV files. Nothing is uploaded anywhere.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** List entries: [{ name, method, compressedSize, size, offset }]. */
export function listZip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This doesn't look like a .zip file.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = [];
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open .zip files. Unzip it and choose the CSV files instead.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read one entry as text. */
export async function readZipText(bytes, entry) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const o = entry.offset;
  if (u32(b, o) !== 0x04034b50) throw new Error("The .zip file is damaged.");
  const start = o + 30 + u16(b, o + 26) + u16(b, o + 28);
  const data = b.subarray(start, start + entry.compressedSize);
  let raw;
  if (entry.method === 0) raw = data;
  else if (entry.method === 8) raw = await inflateRaw(data);
  else throw new Error("This .zip uses a compression method the browser can't read. Unzip it and choose the CSV files instead.");
  return new TextDecoder("utf-8").decode(raw);
}

/** Read every .csv in the archive: [{ name, text }]. Skips folders, hidden files and anything over 64 MB. */
export async function readZipCsvs(bytes) {
  const out = [];
  for (const e of listZip(bytes)) {
    if (!/\.csv$/i.test(e.name) || /(^|\/)(\.|__MACOSX)/.test(e.name) || e.size > 64 * 1024 * 1024) continue;
    out.push({ name: e.name, text: await readZipText(bytes, e) });
  }
  return out;
}
