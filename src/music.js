// Müzik botu yardımcıları: link çözümleme ve YouTube araması.
// Çalma işi her dinleyicinin kendi tarayıcısındaki resmi YouTube oynatıcısıyla, senkron yapılır.

const YT_ID = /^[A-Za-z0-9_-]{11}$/
export const isYtId = id => typeof id === 'string' && YT_ID.test(id)

export function parseYouTube(s) {
  let u
  try { u = new URL(String(s).trim()) } catch { return null }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  let id = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v')
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)
    if (!id && m) id = m[1]
  }
  return isYtId(id) ? id : null
}

export function parseSpotify(s) {
  const m = String(s).match(/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|episode|artist)\/([A-Za-z0-9]{22})/)
  return m ? {type: m[1], id: m[2]} : null
}

async function getJson(url, ms = 6000, signal) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const r = await fetch(url, {signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer'})
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

const decode = s => {
  try { return new DOMParser().parseFromString(String(s), 'text/html').documentElement.textContent || '' } catch { return String(s) }
}

export async function spotifyTitle(url) {
  const j = await getJson('https://open.spotify.com/oembed?url=' + encodeURIComponent(url), 6000)
  return j && j.title ? String(j.title) : null
}

export async function ytTitle(id) {
  try {
    const j = await getJson('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), 4000)
    return j && j.title ? String(j.title) : null
  } catch { return null }
}

// Anahtarsız arama için herkese açık YouTube ön yüzleri (Piped / Invidious).
// Hangisinin çalıştığı zamanla değişir; hepsi aynı anda denenir, ilk cevap veren kullanılır ve hatırlanır.
const PIPED = [
  'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://pipedapi.leptons.xyz',
  'https://pipedapi.reallyaweso.me', 'https://pipedapi.drgns.space', 'https://pipedapi.ducks.party',
  'https://piped-api.privacy.com.de', 'https://pipedapi.nosebs.ru'
]
const INVIDIOUS = [
  'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be', 'https://invidious.jing.rocks',
  'https://iv.ggtyler.dev', 'https://invidious.privacyredirect.com', 'https://inv.tux.pizza', 'https://invidious.f5.si'
]
const SOURCES = [...PIPED.map(b => ({kind: 'piped', b})), ...INVIDIOUS.map(b => ({kind: 'inv', b}))]
let lastGood = null
try { lastGood = localStorage.getItem('kd_ytsrc') } catch {}

async function searchOn(src, q, signal) {
  const enc = encodeURIComponent(q)
  let out = []
  if (src.kind === 'piped') {
    for (const filter of ['music_songs', 'videos']) {
      const j = await getJson(`${src.b}/search?q=${enc}&filter=${filter}`, 7000, signal)
      out = (j.items || []).filter(x => x && typeof x.url === 'string' && x.url.includes('watch?v='))
        .map(x => ({id: new URL(x.url, 'https://x.invalid').searchParams.get('v'), t: decode(x.title), d: +x.duration || 0}))
        .filter(x => isYtId(x.id))
      if (out.length) break
    }
  } else {
    const j = await getJson(`${src.b}/api/v1/search?q=${enc}&type=video`, 7000, signal)
    out = (Array.isArray(j) ? j : []).filter(x => x && x.type === 'video' && isYtId(x.videoId))
      .map(x => ({id: x.videoId, t: decode(x.title), d: +x.lengthSeconds || 0}))
  }
  if (!out.length) throw new Error('sonuç yok')
  return out.slice(0, 6)
}

// Şarkı adıyla YouTube'da ara. key verilirse resmi YouTube Data API kullanılır (en güvenilir yol).
export async function ytSearch(q, key) {
  if (key) {
    const j = await getJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=6&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`, 7000)
    return (j.items || []).filter(x => isYtId(x.id?.videoId)).map(x => ({id: x.id.videoId, t: decode(x.snippet?.title || ''), d: 0}))
  }
  const order = [...SOURCES].sort((a, b) => (b.b === lastGood) - (a.b === lastGood))
  const ctrl = new AbortController()
  try {
    // Önce son çalışan kaynak tek başına; olmazsa hepsi aynı anda
    if (lastGood) {
      try { return await searchOn(order[0], q, ctrl.signal) } catch {}
    }
    const res = await Promise.any(order.map(src => searchOn(src, q, ctrl.signal).then(r => {
      lastGood = src.b
      try { localStorage.setItem('kd_ytsrc', src.b) } catch {}
      return r
    })))
    return res
  } catch {
    throw new Error('arama yapılamadı')
  } finally {
    ctrl.abort()
  }
}

let ytApi = null
export function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT)
  if (!ytApi) {
    ytApi = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { try { prev && prev() } catch {} res(window.YT) }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.async = true
      s.onerror = () => { ytApi = null; rej(new Error('YouTube oynatıcısı yüklenemedi')) }
      document.head.appendChild(s)
    })
  }
  return ytApi
}
