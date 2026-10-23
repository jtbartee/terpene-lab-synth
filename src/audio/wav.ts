// PCM WAV encoder (16- or 24-bit) with a LIST/INFO chunk carrying title,
// software and a comment (key, scale, tempo, seed) that DAWs display.

export interface PcmSource {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(c: number): Float32Array;
}

export interface WavInfo { title?: string; comment?: string; software?: string; genre?: string }

function infoChunk(info: WavInfo): Uint8Array {
  const entries: [string, string][] = [];
  if (info.title) entries.push(['INAM', info.title]);
  if (info.comment) entries.push(['ICMT', info.comment]);
  if (info.software) entries.push(['ISFT', info.software]);
  if (info.genre) entries.push(['IGNR', info.genre]);
  if (!entries.length) return new Uint8Array(0);
  const enc = new TextEncoder();
  const parts = entries.map(([id, text]) => {
    const body = enc.encode(text.replace(/[^\x20-\x7e]/g, '?') + '\0');
    const padded = body.length % 2 ? body.length + 1 : body.length;
    const b = new Uint8Array(8 + padded);
    const v = new DataView(b.buffer);
    for (let i = 0; i < 4; i++) b[i] = id.charCodeAt(i);
    v.setUint32(4, body.length, true);
    b.set(body, 8);
    return b;
  });
  const size = 4 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(8 + size);
  const v = new DataView(out.buffer);
  out.set([0x4c, 0x49, 0x53, 0x54]); // LIST
  v.setUint32(4, size, true);
  out.set([0x49, 0x4e, 0x46, 0x4f], 8); // INFO
  let o = 12;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function encodeWav(src: PcmSource, opts: { bitDepth?: 16 | 24; info?: WavInfo; dither?: boolean } = {}): Uint8Array {
  const bits = opts.bitDepth ?? 16;
  const bytes = bits / 8;
  const ch = src.numberOfChannels;
  const n = src.length;
  const dataSize = n * ch * bytes;
  const info = infoChunk(opts.info ?? {});
  const total = 12 + 24 + info.length + 8 + dataSize;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF');
  v.setUint32(4, total - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, src.sampleRate, true);
  v.setUint32(28, src.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bits, true);
  out.set(info, 36);
  let o = 36 + info.length;
  str(o, 'data');
  v.setUint32(o + 4, dataSize, true);
  o += 8;
  const chans = Array.from({ length: ch }, (_, c) => src.getChannelData(c));
  const max = bits === 16 ? 32767 : 8388607;
  const dither = opts.dither ?? bits === 16;
  let seed = 22222;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let x = Math.max(-1, Math.min(1, chans[c][i]));
      // TPDF dither of ±1 LSB when reducing to 16-bit
      let s = x * max + (dither ? rnd() - rnd() : 0);
      s = Math.max(-max - 1, Math.min(max, Math.round(s)));
      if (bits === 16) { v.setInt16(o, s, true); o += 2; }
      else { out[o] = s & 0xff; out[o + 1] = (s >> 8) & 0xff; out[o + 2] = (s >> 16) & 0xff; o += 3; }
      x = 0;
    }
  }
  return out;
}

/** Minimal reader for tests: returns header fields and channel data. */
export function decodeWav(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let data: { offset: number; size: number } | null = null;
  const info: Record<string, string> = {};
  while (o + 8 <= buf.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') data = { offset: o + 8, size };
    if (id === 'LIST' && tag(o + 8) === 'INFO') {
      let p = o + 12;
      while (p < o + 8 + size) {
        const sid = tag(p); const sz = v.getUint32(p + 4, true);
        info[sid] = new TextDecoder().decode(buf.slice(p + 8, p + 8 + sz)).replace(/\0+$/, '');
        p += 8 + sz + (sz % 2);
      }
    }
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  const frames = data.size / (fmt.channels * (fmt.bits / 8));
  return { ...fmt, frames, info, dataOffset: data.offset };
}
