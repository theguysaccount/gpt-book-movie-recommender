// Build small ZIP files in memory, the way export tools write them. Used by tests and the browser self-test.
import zlib from "node:zlib";

/** Write a minimal ZIP (stored or deflated entries) the way export tools do. */
export function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, text, store } of files) {
    const data = Buffer.from(text, "utf8");
    const comp = store ? data : zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

export const LETTERBOXD_ZIP = [
  { name: "ratings.csv", text: "Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,Arrival,2016,https://boxd.it/a,5\n2024-01-02,Heat,1995,https://boxd.it/b,4\n" },
  { name: "watchlist.csv", text: "Date,Name,Year,Letterboxd URI\n2024-01-03,Solaris,1972,https://boxd.it/c\n", store: true },
  { name: "likes/films.csv", text: "Date,Name,Year,Letterboxd URI\n2024-01-01,Arrival,2016,https://boxd.it/a\n" },
  { name: "profile.csv", text: "Date Joined,Username,Given Name\n2020-01-01,someone,\n" },
  { name: "__MACOSX/._ratings.csv", text: "junk" },
];

