const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex = rgb => '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');
const hexLin = h => [1, 3, 5].map(i => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));
const vnorm = v => { const l = Math.hypot(...v) || 1; return v.map(q => q / l); };
const lerp3 = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// three colourways (authored in sRGB, used in linear RGB)
// flesh: the clear jelly in transmission, density: how strongly it absorbs · fleshDeep: its scattering
// pale: the milky layer · skin: the mouth line and blowholes · seed: the eyes · aril: the drops
// krill, glow: the krill and its light · mottle: the pale blotches on the back
const PALETTES = {
  ocean: {
    name: 'Ocean',
    flesh: hexLin('#3a8ef0'), density: 2.2, fleshDeep: hexLin('#1a56c4'), pale: hexLin('#f3efe6'),
    skin: hexLin('#0a2252'), seed: hexLin('#0a0c11'), aril: hexLin('#4d9ff0'), krill: hexLin('#ff6f5e'), glow: hexLin('#ffb09a'),
    mottle: hexLin('#cfe4ff'), mottleW: 0.55, shadowTint: [0.5, 0.6, 0.8], rough: 0.07,
    ui: { deep: hexLin('#1a56c4'), mid: hexLin('#3a8ef0'), pale: hexLin('#ff6f5e') },
  },
  arctic: {
    name: 'Arctic',
    flesh: hexLin('#5fcaf2'), density: 2.0, fleshDeep: hexLin('#1586ba'), pale: hexLin('#f6f8f6'),
    skin: hexLin('#063a52'), seed: hexLin('#080c10'), aril: hexLin('#74d4f4'), krill: hexLin('#ff7a6a'), glow: hexLin('#ffb7a2'),
    mottle: hexLin('#e8f8ff'), mottleW: 0.5, shadowTint: [0.52, 0.7, 0.8], rough: 0.06,
    ui: { deep: hexLin('#1586ba'), mid: hexLin('#5fcaf2'), pale: hexLin('#ff7a6a') },
  },
  twilight: {
    name: 'Twilight',
    flesh: hexLin('#6a6cf0'), density: 2.2, fleshDeep: hexLin('#3436b4'), pale: hexLin('#f5f0f4'),
    skin: hexLin('#16134a'), seed: hexLin('#0a0a12'), aril: hexLin('#8486f4'), krill: hexLin('#ff6a8a'), glow: hexLin('#ffa8c0'),
    mottle: hexLin('#e2deff'), mottleW: 0.5, shadowTint: [0.58, 0.56, 0.8], rough: 0.07,
    ui: { deep: hexLin('#3436b4'), mid: hexLin('#6a6cf0'), pale: hexLin('#ff6a8a') },
  },
};

// the backdrop, chosen so that after the Neutral tone map it lands exactly on the page colour (lights on / out)
function invNeutral(o) {
  const m = Math.min(...o);
  const off = m >= 0.04 ? 0.04 : Math.sqrt(m / 6.25) - m;
  return o.map(v => v + off);
}
const BG_ON = invNeutral(hexLin('#e2dfda'));
const BG_OFF = invNeutral(hexLin('#15181e'));


export { srgbToLin, linToSrgb, hex, hexLin, vnorm, lerp3, PALETTES, invNeutral, BG_ON, BG_OFF };
