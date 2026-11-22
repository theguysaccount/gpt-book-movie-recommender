// A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and line breaks inside quotes, BOM,
// CRLF or LF. Returns { headers, rows } where each row is an object keyed by header.

export function parseCsv(text) {
  let s = String(text ?? "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const records = [];
  let field = "", record = [], inQuotes = false, i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; i++; continue; }
    if (ch === ",") { record.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { record.push(field); records.push(record); record = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }
  while (records.length && records[records.length - 1].every((c) => c.trim() === "")) records.pop();
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length === 1 && rec[0].trim() === "") continue;
    const o = {};
    for (let c = 0; c < headers.length; c++) o[headers[c]] = (rec[c] ?? "").trim();
    rows.push(o);
  }
  return { headers, rows };
}

/** Write rows (arrays) as CSV text. */
export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
