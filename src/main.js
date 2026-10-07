// Kanka Chat — sunucusuz (P2P / WebRTC) Discord benzeri sohbet.
// Eşleşme Nostr röleleri üzerinden yapılır; tüm veri (mesaj, ses, görüntü)
// doğrudan kullanıcılar arasında uçtan uca şifreli akar.
import {joinRoom} from 'trystero'
import {CODECS, HW, isHwCodec, makeTunedPC, pickCodec, probeCodecs, screenBitrate, videoStats} from './media.js'

// ======================= yardımcılar =======================
const APP_ID = 'kanka-chat-p2p-v1'
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const now = () => Date.now()
const ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c])
const clamp = (s, n) => String(s ?? '').slice(0, n)
const ABC = 'abcdefghijklmnopqrstuvwxyz0123456789'
const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ABC[b % 36]).join('')
const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
const COLORS = ['#5865f2', '#eb459e', '#ed4245', '#faa61a', '#fee75c', '#57f287', '#23a55a', '#00a8fc', '#9b59b6', '#e67e22', '#1abc9c', '#e91e63']
const EMOJI = ['😀', '😂', '🤣', '😅', '😊', '😍', '😎', '🤔', '😏', '🙄', '😭', '😡', '😱', '🤯', '🥳', '😴', '😈', '💀', '🫡', '🤝', '👍', '👎', '👏', '🙏', '💪', '👀', '🔥', '❤️', '💯', '🎉', '✅', '❌', '🎮', '🎧', '⚽', '🍕', '☕', '🍺', '🚀', '⭐']
const MAX_FILE = 100 * 1024 * 1024
// İsteğe bağlı: ?relay=wss://a,wss://b ile özel Nostr röleleri kullan
const RELAYS = (new URLSearchParams(location.search).get('relay') || '').split(',').filter(u => /^wss?:\/\//.test(u))
const PAGE = 80
// Hesap ve ayarlar ayrıca IndexedDB'ye (ve kimlik + sunucular çereze) yansıtılır; biri silinirse diğerinden dönülür
const MIRROR = new Set(['kd_me', 'kd_servers', 'kd_set', 'kd_dms', 'kd_vol', 'kd_svol', 'kd_lastch', 'kd_st'])
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) {
    let ok = false
    try { localStorage.setItem(k, JSON.stringify(v)); ok = true } catch {}
    if (MIRROR.has(k)) mirror(k, v)
    return ok
  },
  del(k) { try { localStorage.removeItem(k) } catch {} }
}
const pad = n => String(n).padStart(2, '0')
const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
const dayOf = t => new Date(t).toDateString()
const fmtDay = t => new Date(t).toLocaleDateString('tr-TR', {day: 'numeric', month: 'long', year: 'numeric'})
const fmtFull = t => {
  const d = new Date(t), today = new Date()
  const y = new Date(today); y.setDate(y.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Bugün ' + fmtTime(t)
  if (d.toDateString() === y.toDateString()) return 'Dün ' + fmtTime(t)
  return d.toLocaleDateString('tr-TR') + ' ' + fmtTime(t)
}
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'
const initials = n => (String(n || '?').trim().split(/\s+/).map(w => [...w][0]).join('').slice(0, 2) || '?').toUpperCase()
const avatar = (n, c, cls = '', dot = '', attrs = '') =>
  `<div class="av ${cls}" style="background:${isColor(c) ? c : '#5865f2'}" ${attrs}>${esc(initials(n))}${dot}</div>`

// ======================= durum =======================
const S = {
  me: LS.get('kd_me', null),
  settings: Object.assign({
    ns: true, ec: true, agc: true, ptt: false, pttKey: 'KeyV', sens: 8, vq: 'med',
    sres: 0, sfps: 0, smode: 'motion', saudio: true, sv: 2,
    mic: '', cam: '', sounds: true, notif: false, members: true
  }, LS.get('kd_set', {})),
  servers: LS.get('kd_servers', []),
  dms: LS.get('kd_dms', []),
  unread: LS.get('kd_unread', {}),
  vol: LS.get('kd_vol', {}),
  svol: LS.get('kd_svol', {}),
  saudios: {},
  st: Object.assign({m: false, d: false}, LS.get('kd_st', {})),
  view: LS.get('kd_view', {sid: null, cid: null}),
  conns: {},
  msgs: {},
  lim: {},
  blobs: {},
  recv: {},
  typing: {},
  voice: null,
  showStage: false,
  focus: null,
  tileEls: new Map(),
  audios: {},
  reply: null,
  editing: null,
  pttDown: false,
  lastCh: LS.get('kd_lastch', {})
}
// Eski sürümden gelen ayarlar: ekran paylaşımı varsayılanı artık kaynak (en net) çözünürlük
if ((S.settings.sv || 0) < 2) { S.settings.sres = 0; S.settings.sv = 2 }
const saveServers = () => LS.set('kd_servers', S.servers)
const saveSettings = () => LS.set('kd_set', S.settings)
const srvById = id => S.servers.find(s => s.id === id)
const keyOf = (sid, cid) => sid ? sid + '|' + cid : 'dm|' + cid
const curKey = () => S.view.cid ? keyOf(S.view.sid, S.view.cid) : null

// ======================= mesaj deposu =======================
function msgs(key) {
  return S.msgs[key] ||= LS.get('kd_m_' + key, [])
}
const dirtyKeys = new Set()
let saveTimer = 0
function saveMsgs(key) {
  dirtyKeys.add(key)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 800)
}
function flushSave() {
  clearTimeout(saveTimer)
  for (const k of dirtyKeys) {
    const arr = S.msgs[k]
    if (!arr) continue
    if (arr.length > 500) arr.splice(0, arr.length - 500)
    // Depolama şişmesin: yalnızca son 20 resmi kalıcı tut
    let imgs = 0
    const out = arr.map(m => m).reverse().map(m => (m.img && ++imgs > 20) ? {...m, img: null, imgGone: 1} : m).reverse()
    if (!LS.set('kd_m_' + k, out)) LS.set('kd_m_' + k, out.slice(-300).map(m => m.img ? {...m, img: null, imgGone: 1} : m))
  }
  dirtyKeys.clear()
  LS.set('kd_unread', S.unread)
}

function sanitizeMsg(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^[a-z0-9]{4,32}$/.test(m.id)) return null
  const o = {
    id: m.id, uid: clamp(m.uid, 40), n: clamp(m.n, 32) || '?', c: isColor(m.c) ? m.c : '#5865f2',
    t: +m.t || 0, u: +m.u || +m.t || 0, x: clamp(m.x, 4000)
  }
  if (m.del) o.del = 1
  if (m.ed) o.ed = +m.ed || 1
  if (typeof m.img === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(m.img) && m.img.length < 4e6) o.img = m.img
  if (m.hasImg) o.hasImg = 1
  if (m.imgGone) o.imgGone = 1
  if (m.f && typeof m.f === 'object') o.f = {name: clamp(m.f.name, 200) || 'dosya', size: +m.f.size || 0, type: clamp(m.f.type, 100)}
  if (m.rp && typeof m.rp === 'object') o.rp = {id: clamp(m.rp.id, 32), n: clamp(m.rp.n, 32), x: clamp(m.rp.x, 120)}
  if (m.r && typeof m.r === 'object') {
    const r = {}
    for (const [e, us] of Object.entries(m.r).slice(0, 20)) {
      if (e.length <= 16 && Array.isArray(us)) {
        const list = us.filter(u => typeof u === 'string').slice(0, 100)
        if (list.length) r[e] = list
      }
    }
    if (Object.keys(r).length) o.r = r
  }
  if (m.to) o.to = clamp(m.to, 40)
  return o
}
function findIdx(arr, id) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].id === id) return i
  return -1
}
// Son-yazan-kazanır birleştirme. 'new' | 'ins' | 'upd' | null döner.
function mergeMsg(key, inc, senderUid) {
  const arr = msgs(key)
  const idx = findIdx(arr, inc.id)
  if (idx < 0) {
    if (senderUid && inc.uid !== senderUid) return null
    let i = arr.length
    while (i > 0 && arr[i - 1].t > inc.t) i--
    arr.splice(i, 0, inc)
    saveMsgs(key)
    return i === arr.length - 1 ? 'new' : 'ins'
  }
  const cur = arr[idx]
  if (inc.u <= cur.u) return null
  if (senderUid && cur.uid !== senderUid) {
    // Başkasının mesajında yalnızca tepkiler değişebilir
    inc = {...cur, r: inc.r, u: inc.u}
    if (!inc.r) delete inc.r
  }
  if (!inc.img && cur.img && !inc.del) inc.img = cur.img
  arr[idx] = inc
  saveMsgs(key)
  return 'upd'
}

// ======================= markdown =======================
function md(t) {
  const blocks = []
  let s = esc(t).replace(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/gi, (_, c) => {
    blocks.push(`<pre><code>${c.replace(/^\n+|\n+$/g, '')}</code></pre>`)
    return `\u0001${blocks.length - 1}\u0001`
  })
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { blocks.push(`<code>${c}</code>`); return `\u0001${blocks.length - 1}\u0001` })
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => { blocks.push(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`); return `\u0001${blocks.length - 1}\u0001` })
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" data-act="spoiler">$1</span>')
    .replace(/(^|\s)@([^\s@<]{1,32})/g, '$1<span class="men">@$2</span>')
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => blocks[i])
}
function mentionsMe(x) {
  if (!x || !S.me) return false
  const l = x.toLowerCase()
  return l.includes('@' + S.me.name.toLowerCase()) || l.includes('@everyone') || l.includes('@herkes')
}

// ======================= render zamanlayıcı =======================
const dirty = new Set()
let raf = 0
function inv(...parts) {
  for (const p of parts) dirty.add(p)
  if (!raf) raf = requestAnimationFrame(flushRender)
}
function flushRender() {
  raf = 0
  const d = new Set(dirty)
  dirty.clear()
  if (!S.me) return
  if (d.has('rail')) renderRail()
  if (d.has('side')) renderSide()
  if (d.has('vbar')) renderVbar()
  if (d.has('me')) renderMe()
  if (d.has('main')) renderMain()
  else {
    if (d.has('head')) renderHead()
    if (d.has('msgs')) renderMsgs()
    if (d.has('stage')) renderStage()
    if (d.has('members')) renderMembers()
  }
  if (d.has('typing')) renderTyping()
  updateTitle()
}
const invAll = () => inv('rail', 'side', 'vbar', 'me', 'main')

// ======================= P2P bağlantı =======================
function stateFor(sid) {
  const v = S.voice && S.voice.sid === sid ? S.voice : null
  return {
    v: v ? v.cid : null,
    m: !!(S.st.m || (v && !v.mic)),
    d: !!S.st.d,
    cam: !!(v && v.cam),
    scr: !!(v && v.scr),
    spk: !!(v && v.spk)
  }
}
const helloData = sid => ({uid: S.me.uid, n: S.me.name, c: S.me.color, st: stateFor(sid), hw: HW.dec})
function sanitizeSt(d) {
  d = d && typeof d === 'object' ? d : {}
  return {v: typeof d.v === 'string' ? clamp(d.v, 20) : null, m: !!d.m, d: !!d.d, cam: !!d.cam, scr: !!d.scr, spk: !!d.spk}
}
function metaOf(srv) {
  return {name: srv.name, ch: srv.ch, ver: srv.ver, owner: srv.owner}
}
function syncData(sid) {
  const srv = srvById(sid)
  const ch = {}
  for (const c of srv.ch) if (c.type === 'text') {
    const arr = msgs(keyOf(sid, c.id))
    if (arr.length) ch[c.id] = arr.slice(-60)
  }
  return {meta: metaOf(srv), ch}
}

// Bir RTCPeerConnection'ın karşısındaki kişinin donanımla çözebildiği codec'ler
function remoteDecFor(pc) {
  for (const c of Object.values(S.conns)) {
    const peers = c.room.getPeers()
    for (const pid in peers) if (peers[pid] === pc) return c.peers[pid]?.hw
  }
  return undefined
}
const TunedPC = makeTunedPC(remoteDecFor)

function connect(srv) {
  if (S.conns[srv.id]) return S.conns[srv.id]
  let room
  try {
    room = joinRoom({
      appId: APP_ID,
      password: srv.key,
      relayConfig: RELAYS.length ? {urls: RELAYS, warnOnRelayFailure: false} : {warnOnRelayFailure: false},
      ...(TunedPC ? {rtcPolyfill: TunedPC} : {})
    }, 'srv_' + srv.id)
  } catch (e) {
    toast('Bağlantı kurulamadı: ' + e.message)
    return null
  }
  const c = {sid: srv.id, room, peers: {}, a: {}}
  S.conns[srv.id] = c
  const on = (name, fn) => {
    const a = room.makeAction(name)
    a.onMessage = (d, ctx) => { try { fn(c, d, ctx.peerId) } catch (e) { console.warn(name, e) } }
    c.a[name] = a
  }
  on('hello', onHello)
  on('st', onState)
  on('msg', onMsg)
  on('sync', onSync)
  on('meta', (c, d) => applyMeta(c.sid, d))
  on('typ', onTyping)
  on('watch', onWatch)
  const fa = room.makeAction('file')
  fa.onReceive = ({byteLength}) => byteLength <= MAX_FILE
  let progT = 0
  fa.onReceiveProgress = (p, ctx) => {
    const mid = ctx?.metadata?.mid
    if (typeof mid !== 'string') return
    S.recv[mid] = Math.round(p * 100)
    if (now() - progT > 300) { progT = now(); refreshMsg(mid) }
  }
  fa.onMessage = (data, ctx) => onFile(c, data, ctx.peerId, ctx.metadata)
  c.a.file = fa
  room.onPeerJoin = pid => {
    c.a.hello.send(helloData(c.sid), {target: pid})
    c.a.sync.send(syncData(c.sid), {target: pid})
  }
  room.onPeerLeave = pid => onLeave(c, pid)
  room.onPeerStream = (stream, pid, meta) => onStream(c, pid, stream, meta)
  return c
}
function disconnect(sid) {
  const c = S.conns[sid]
  if (!c) return
  delete S.conns[sid]
  try { c.room.leave() } catch {}
}

function onHello(c, d, pid) {
  const srv = srvById(c.sid)
  if (!srv || !d || typeof d.uid !== 'string') return
  const fresh = !c.peers[pid]
  const prev = c.peers[pid]?.st
  const p = c.peers[pid] = {
    uid: clamp(d.uid, 40), n: clamp(d.n, 32) || 'Biri', c: isColor(d.c) ? d.c : '#5865f2', st: sanitizeSt(d.st),
    hw: Array.isArray(d.hw) ? d.hw.filter(x => CODECS.includes(x)) : undefined
  }
  srv.mem ||= {}
  srv.mem[p.uid] = {n: p.n, c: p.c, seen: now()}
  saveServersSoon()
  if (fresh) {
    // Bu kişiyle olan DM geçmişini eşitle
    const dm = msgs('dm|' + p.uid)
    if (dm.length) c.a.sync.send({dm: dm.slice(-50)}, {target: pid})
  }
  voiceStateChanged(c, pid, prev, p.st)
  inv('side', 'members', 'head', 'stage', 'rail')
}
function onState(c, d, pid) {
  const p = c.peers[pid]
  if (!p) return
  const prev = p.st
  p.st = sanitizeSt(d)
  const onlySpk = prev.v === p.st.v && prev.m === p.st.m && prev.d === p.st.d && prev.cam === p.st.cam && prev.scr === p.st.scr
  if (onlySpk) { updateSpeaking(); return }
  voiceStateChanged(c, pid, prev, p.st)
  inv('side', 'members', 'stage')
}
function voiceStateChanged(c, pid, prev, st) {
  const v = S.voice
  if (!v || v.sid !== c.sid) return
  const was = prev?.v === v.cid, is = st.v === v.cid
  if (was !== is) {
    beep(is ? 'join' : 'leave')
    if (!is) dropRemote(pid)
  }
  const r = v.remote[pid]
  if (r) {
    if (!st.cam) delete r.cam
    if (!st.scr) delete r.scr
  }
  if (!st.scr) dropScreenAudio(pid)
  if (!st.scr) { v.watching.delete(pid); delete v.lvSent[pid] }
  syncMedia(pid)
}
function onLeave(c, pid) {
  const p = c.peers[pid]
  delete c.peers[pid]
  const v = S.voice
  if (v && v.sid === c.sid) {
    if (p?.st?.v === v.cid) beep('leave')
    dropRemote(pid)
    delete v.sent[pid]
    delete v.levels[pid]
    delete v.lvSent[pid]
    v.watching.delete(pid)
    if (v.watchers.delete(pid)) retuneScreen()
  }
  inv('side', 'members', 'head', 'stage')
}
let srvSaveT = 0
function saveServersSoon() { clearTimeout(srvSaveT); srvSaveT = setTimeout(saveServers, 2000) }

function applyMeta(sid, d) {
  const srv = srvById(sid)
  if (!srv || !d || typeof d !== 'object' || !(+d.ver > (srv.ver || 0))) return
  if (!Array.isArray(d.ch)) return
  const ch = d.ch.slice(0, 100)
    .filter(x => x && typeof x.id === 'string' && /^[a-z0-9]{1,20}$/.test(x.id))
    .map(x => ({id: x.id, name: clamp(x.name, 40) || 'kanal', type: x.type === 'voice' ? 'voice' : 'text'}))
  srv.name = clamp(d.name, 50) || srv.name
  srv.ch = ch
  srv.ver = +d.ver
  if (!srv.owner && typeof d.owner === 'string') srv.owner = clamp(d.owner, 40)
  saveServers()
  if (S.view.sid === sid && S.view.cid && !ch.some(x => x.id === S.view.cid)) S.view.cid = firstText(srv)
  if (S.view.sid === sid && !S.view.cid) S.view.cid = firstText(srv)
  invAll()
}
function pushMeta(srv) {
  srv.ver = Math.max(now(), (srv.ver || 0) + 1)
  saveServers()
  S.conns[srv.id]?.a.meta.send(metaOf(srv))
  invAll()
}
const firstText = srv => srv.ch.find(c => c.type === 'text')?.id || null

function onSync(c, d, pid) {
  if (!d || typeof d !== 'object') return
  if (d.meta) applyMeta(c.sid, d.meta)
  const cur = curKey()
  let touched = false
  if (d.ch && typeof d.ch === 'object') {
    for (const [cid, list] of Object.entries(d.ch).slice(0, 100)) {
      if (!/^[a-z0-9]{1,20}$/.test(cid) || !Array.isArray(list)) continue
      const key = keyOf(c.sid, cid)
      for (const raw of list.slice(-100)) {
        const m = sanitizeMsg(raw)
        if (m && mergeMsg(key, m) && key === cur) touched = true
      }
    }
  }
  if (Array.isArray(d.dm)) {
    const p = c.peers[pid]
    if (p) {
      const key = 'dm|' + p.uid
      const ok = u => u === p.uid || u === S.me.uid
      let any = false
      for (const raw of d.dm.slice(-100)) {
        const m = sanitizeMsg(raw)
        if (m && ok(m.uid) && ok(m.to) && m.uid !== m.to && mergeMsg(key, m)) any = true
      }
      if (any) { touchDm(p.uid); if (key === cur) touched = true }
    }
  }
  if (touched) inv('msgs')
}

function onMsg(c, d, pid) {
  const p = c.peers[pid]
  if (!p || !d || typeof d !== 'object') return
  const m = sanitizeMsg(d.m)
  if (!m) return
  if (d.dm) {
    if (m.to !== S.me.uid) return
    receive('dm|' + p.uid, m, p.uid, true)
    touchDm(p.uid)
  } else {
    if (typeof d.cid !== 'string' || !/^[a-z0-9]{1,20}$/.test(d.cid)) return
    receive(keyOf(c.sid, d.cid), m, p.uid, true)
  }
}
function receive(key, m, senderUid, live) {
  const r = mergeMsg(key, m, senderUid)
  if (!r) return
  const cur = curKey()
  if (key === cur) {
    if (r === 'new') appendMsg(m)
    else if (r === 'upd') refreshMsg(m.id)
    else inv('msgs')
  }
  if (r === 'new' && live && m.uid !== S.me.uid && (key !== cur || document.hidden)) {
    const isDm = key.startsWith('dm|')
    const ment = mentionsMe(m.x)
    const u = S.unread[key] ||= {n: 0, m: 0}
    u.n++
    if (ment || isDm) u.m++
    saveMsgs(key)
    if (ment || isDm) {
      beep('msg')
      notify(isDm ? m.n : '#' + chanName(key) + ' · ' + m.n, m.x || (m.img || m.hasImg ? 'Resim' : m.f ? 'Dosya' : ''))
    }
    inv('rail', 'side')
  }
}
function chanName(key) {
  const [sid, cid] = key.split('|')
  return srvById(sid)?.ch.find(c => c.id === cid)?.name || ''
}
function touchDm(uid) {
  S.dms = [uid, ...S.dms.filter(u => u !== uid)].slice(0, 100)
  LS.set('kd_dms', S.dms)
  inv('side')
}

function onTyping(c, d, pid) {
  const p = c.peers[pid]
  if (!p || !d) return
  const key = d.dm ? (d.to === S.me.uid ? 'dm|' + p.uid : null) : (typeof d.cid === 'string' ? keyOf(c.sid, clamp(d.cid, 20)) : null)
  if (!key) return
  const t = S.typing[key] ||= {}
  t[p.uid] = {n: p.n, until: now() + 5000}
  if (key === curKey()) inv('typing')
  startTypingSweep()
}
let typSweep = 0
function startTypingSweep() {
  if (typSweep) return
  typSweep = setInterval(() => {
    let any = false
    for (const k in S.typing) {
      for (const u in S.typing[k]) if (S.typing[k][u].until < now()) delete S.typing[k][u]; else any = true
    }
    inv('typing')
    if (!any) { clearInterval(typSweep); typSweep = 0 }
  }, 1000)
}
let lastTyp = 0
function sendTyping() {
  if (now() - lastTyp < 3000) return
  lastTyp = now()
  const {sid, cid} = S.view
  if (!cid) return
  if (sid) S.conns[sid]?.a.typ.send({cid})
  else for (const [c, pid] of peersOfUid(cid)) c.a.typ.send({dm: 1, to: cid}, {target: pid})
}

function peersOfUid(uid) {
  const out = [], seen = new Set()
  for (const c of Object.values(S.conns)) {
    for (const [pid, p] of Object.entries(c.peers)) {
      if (p.uid === uid && !seen.has(pid)) { seen.add(pid); out.push([c, pid]) }
    }
  }
  return out
}
function onlineUser(uid) {
  for (const c of Object.values(S.conns)) for (const p of Object.values(c.peers)) if (p.uid === uid) return p
  return null
}
function knownUser(uid) {
  const p = onlineUser(uid)
  if (p) return {n: p.n, c: p.c}
  for (const s of S.servers) if (s.mem?.[uid]) return s.mem[uid]
  for (const m of msgs('dm|' + uid)) if (m.uid === uid) return {n: m.n, c: m.c}
  return {n: 'Bilinmeyen', c: '#5865f2'}
}

// ======================= mesaj gönderme =======================
function sendWire(key, m, includeImg) {
  const wire = m.img && !includeImg ? {...m, img: undefined, hasImg: 1} : m
  if (key.startsWith('dm|')) {
    for (const [c, pid] of peersOfUid(key.slice(3))) c.a.msg.send({dm: 1, m: wire}, {target: pid})
  } else {
    const [sid, cid] = key.split('|')
    S.conns[sid]?.a.msg.send({cid, m: wire})
  }
}
function newMsg(extra = {}) {
  const t = now()
  const m = {id: rid(12), uid: S.me.uid, n: S.me.name, c: S.me.color, t, u: t, x: '', ...extra}
  if (!S.view.sid) m.to = S.view.cid
  if (S.reply) { m.rp = S.reply; setReply(null) }
  return m
}
function postMsg(m) {
  const key = curKey()
  if (!key) return
  mergeMsg(key, m)
  appendMsg(m, true)
  sendWire(key, m, true)
  if (!S.view.sid) {
    touchDm(S.view.cid)
    if (!peersOfUid(S.view.cid).length) toast('Kişi şu an çevrimdışı — çevrimiçi olduğunda mesaj iletilecek.')
  } else if (!Object.keys(S.conns[S.view.sid]?.peers || {}).length) {
    toast('Sunucuda şu an başka kimse çevrimiçi değil — biri bağlandığında mesajlar eşitlenecek.')
  }
}
function updateMsg(key, id, fn) {
  const arr = msgs(key)
  const i = findIdx(arr, id)
  if (i < 0) return
  const m = {...arr[i]}
  if (fn(m) === false) return
  m.u = Math.max(now(), arr[i].u + 1)
  arr[i] = m
  saveMsgs(key)
  refreshMsg(id)
  sendWire(key, m, false)
}
function toggleReact(id, e) {
  updateMsg(curKey(), id, m => {
    const r = m.r = {...(m.r || {})}
    const list = new Set(r[e] || [])
    list.has(S.me.uid) ? list.delete(S.me.uid) : list.add(S.me.uid)
    if (list.size) r[e] = [...list]; else delete r[e]
    if (!Object.keys(r).length) delete m.r
  })
}

async function sendFiles(files) {
  if (!curKey()) return
  for (const f of files) {
    if (f.type.startsWith('image/') && f.size < 15e6) {
      try {
        const img = await compressImage(f)
        postMsg(newMsg({img}))
        continue
      } catch {}
    }
    if (f.size > MAX_FILE) { toast(`${f.name}: en fazla ${fmtSize(MAX_FILE)} gönderilebilir.`); continue }
    const m = newMsg({f: {name: f.name, size: f.size, type: f.type}})
    S.blobs[m.id] = URL.createObjectURL(f)
    postMsg(m)
    const key = curKey()
    const buf = await f.arrayBuffer()
    const meta = {mid: m.id, type: f.type}
    if (key.startsWith('dm|')) for (const [c, pid] of peersOfUid(key.slice(3))) c.a.file.send(buf, {target: pid, metadata: meta})
    else S.conns[S.view.sid]?.a.file.send(buf, {metadata: meta})
  }
}
function onFile(c, data, pid, meta) {
  if (!meta || typeof meta.mid !== 'string' || !/^[a-z0-9]{4,32}$/.test(meta.mid)) return
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(meta.type || '') ? meta.type : 'application/octet-stream'
  // HTML/SVG gibi aktif içerikleri indirilebilir dosya olarak ver
  const safe = /html|svg|xml|javascript/i.test(type) ? 'application/octet-stream' : type
  S.blobs[meta.mid] = URL.createObjectURL(new Blob([data], {type: safe}))
  delete S.recv[meta.mid]
  refreshMsg(meta.mid)
}
async function compressImage(file) {
  if (file.type === 'image/gif' && file.size < 1.5e6) return await readDataUrl(file)
  const bmp = await createImageBitmap(file)
  const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * sc)
  cv.height = Math.round(bmp.height * sc)
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height)
  bmp.close?.()
  let q = 0.82, url = cv.toDataURL('image/webp', q)
  if (!url.startsWith('data:image/webp')) url = cv.toDataURL('image/jpeg', q)
  while (url.length > 600000 && q > 0.35) { q -= 0.12; url = cv.toDataURL(url.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', q) }
  return url
}
const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })

// ======================= mesaj render =======================
function msgHtml(m, prev) {
  const newDay = !prev || dayOf(prev.t) !== dayOf(m.t)
  const head = newDay || !prev || prev.uid !== m.uid || m.t - prev.t > 7 * 60e3 || m.rp || prev.del
  const mine = m.uid === S.me.uid
  const ment = !m.del && !mine && mentionsMe(m.x)
  let h = newDay ? `<div class="day"><span>${fmtDay(m.t)}</span></div>` : ''
  h += `<div class="msg${head ? ' head' : ''}${ment ? ' ment' : ''}" id="m-${m.id}" data-id="${m.id}">`
  const ua = `data-act="prof" data-uid="${esc(m.uid)}"`
  if (head) {
    if (m.rp) h += `<div class="rp" data-act="jump" data-to="${esc(m.rp.id)}">↱ <b>${esc(m.rp.n)}</b> ${esc(m.rp.x)}</div>`
    h += avatar(m.n, m.c, '', '', ua)
    h += `<div class="mh"><span class="un" style="color:${m.c}" ${ua}>${esc(m.n)}</span><span class="ts">${fmtFull(m.t)}</span></div>`
  } else h += `<span class="sts">${fmtTime(m.t)}</span>`
  if (m.del) {
    h += '<div class="tx del">Bu mesaj silindi.</div>'
  } else {
    if (m.x) h += `<div class="tx">${md(m.x)}${m.ed ? '<span class="ed">(düzenlendi)</span>' : ''}</div>`
    if (m.img) h += `<img class="att" src="${esc(m.img)}" alt="resim" decoding="async" data-act="zoom">`
    else if (m.hasImg || m.imgGone) h += '<div class="file"><span class="fi">🖼️</span><div class="fs">Resim artık mevcut değil</div></div>'
    if (m.f) {
      const url = S.blobs[m.id], pr = S.recv[m.id]
      h += `<div class="file"><span class="fi">📄</span><div><div class="fn">${url ? `<a href="${url}" download="${esc(m.f.name)}">${esc(m.f.name)}</a>` : esc(m.f.name)}</div><div class="fs">${fmtSize(m.f.size)}${url ? '' : pr != null ? ` · alınıyor %${pr}` : ' · bu oturumda mevcut değil'}</div></div></div>`
    }
    if (m.r) {
      h += '<div class="reacts">'
      for (const [e, us] of Object.entries(m.r)) {
        h += `<button class="react${us.includes(S.me.uid) ? ' me' : ''}" data-act="react" data-e="${esc(e)}">${esc(e)}<span>${us.length}</span></button>`
      }
      h += '</div>'
    }
    h += `<div class="tools"><button data-act="react-pick" title="Tepki ekle">😊</button><button data-act="reply" title="Yanıtla">↩️</button>${mine ? '<button data-act="edit" title="Düzenle">✏️</button><button data-act="del" class="danger" title="Sil">🗑️</button>' : ''}</div>`
  }
  return h + '</div>'
}
function welcomeHtml() {
  const {sid, cid} = S.view
  if (!sid) {
    const u = knownUser(cid)
    return `<div class="welcome">${avatar(u.n, u.c, 's80')}<h1>${esc(u.n)}</h1><p><b>${esc(u.n)}</b> ile olan direkt mesaj geçmişinin başlangıcı.</p></div>`
  }
  const name = srvById(sid)?.ch.find(c => c.id === cid)?.name || ''
  return `<div class="welcome"><div class="big">#</div><h1>#${esc(name)} kanalına hoş geldin!</h1><p>Bu, #${esc(name)} kanalının başlangıcı.</p></div>`
}
const isAtBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 120
function scrollBottom() { const b = $('#msgs'); b.scrollTop = b.scrollHeight }
function renderMsgs(keepPos) {
  const box = $('#msgs')
  const key = curKey()
  if (!key) { box.innerHTML = homeHtml(); return }
  const arr = msgs(key)
  const lim = S.lim[key] || PAGE
  const start = Math.max(0, arr.length - lim)
  const parts = [start > 0 ? '<button class="more" data-act="more">Daha eski mesajları yükle</button>' : welcomeHtml()]
  let prev = start > 0 ? arr[start - 1] : null
  for (let i = start; i < arr.length; i++) { parts.push(msgHtml(arr[i], prev)); prev = arr[i] }
  const bottom = isAtBottom(box)
  const fromBottom = box.scrollHeight - box.scrollTop
  box.innerHTML = parts.join('')
  if (keepPos) box.scrollTop = box.scrollHeight - fromBottom
  else if (bottom || S.forceBottom) scrollBottom()
  S.forceBottom = false
  S.renderedKey = key
}
function appendMsg(m, force) {
  const box = $('#msgs')
  if (S.renderedKey !== curKey() || !box.querySelector('.msg, .welcome, .more')) { S.forceBottom = force; inv('msgs'); return }
  const arr = msgs(curKey())
  const i = findIdx(arr, m.id)
  const bottom = isAtBottom(box)
  box.insertAdjacentHTML('beforeend', msgHtml(m, i > 0 ? arr[i - 1] : null))
  if (bottom || force) scrollBottom()
  // DOM'u sınırla: çok uzun oturumlarda eski düğümleri at
  const lim = S.lim[curKey()] || PAGE
  if (arr.length > lim + 40 && bottom) inv('msgs')
}
function refreshMsg(id) {
  const el = document.getElementById('m-' + id)
  if (!el) return
  const arr = msgs(curKey())
  const i = findIdx(arr, id)
  if (i < 0) return
  const wasEditing = el.classList.contains('editing')
  const tmp = document.createElement('div')
  tmp.innerHTML = msgHtml(arr[i], i > 0 ? arr[i - 1] : null)
  const fresh = tmp.querySelector('.msg')
  el.replaceWith(fresh)
  if (wasEditing && S.editing === id) startEdit(id)
}
function renderTyping() {
  const el = $('#typing')
  const t = S.typing[curKey()] || {}
  const names = Object.entries(t).filter(([u, x]) => u !== S.me.uid && x.until > now()).map(([, x]) => x.n)
  el.innerHTML = !names.length ? '' : `<span class="dots"></span> ${names.length > 3 ? 'Birkaç kişi' : names.map(n => `<b>${esc(n)}</b>`).join(', ')} yazıyor…`
}

// ======================= arayüz render =======================
function unreadOf(prefix) {
  let n = 0, m = 0
  for (const [k, u] of Object.entries(S.unread)) if (k.startsWith(prefix)) { n += u.n; m += u.m }
  return {n, m}
}
function renderRail() {
  const home = unreadOf('dm|')
  let h = `<button class="srv${!S.view.sid ? ' on' : ''}${home.n ? ' unread' : ''}" data-act="home" title="Direkt Mesajlar">💬${home.m ? `<span class="badge">${home.m}</span>` : ''}</button><div class="sep"></div>`
  for (const s of S.servers) {
    const u = unreadOf(s.id + '|')
    h += `<button class="srv${S.view.sid === s.id ? ' on' : ''}${u.n ? ' unread' : ''}" data-act="srv" data-sid="${s.id}" title="${esc(s.name)}">${esc(initials(s.name))}${u.m ? `<span class="badge">${u.m}</span>` : ''}</button>`
  }
  h += '<button class="srv add" data-act="new-srv" title="Sunucu oluştur">＋</button>'
  h += '<button class="srv add" data-act="join-srv" title="Sunucuya katıl" style="font-size:20px">🔗</button>'
  if (installEvt) h += '<button class="srv add" data-act="install" title="Uygulamayı bilgisayara yükle" style="font-size:20px">💻</button>'
  $('#rail').innerHTML = h
}
function voiceUsers(sid, cid) {
  const out = []
  if (S.voice && S.voice.sid === sid && S.voice.cid === cid) {
    out.push({pk: 'me', uid: S.me.uid, n: S.me.name, c: S.me.color, st: stateFor(sid)})
  }
  const c = S.conns[sid]
  if (c) for (const [pid, p] of Object.entries(c.peers)) if (p.st.v === cid) out.push({pk: sid + ':' + pid, uid: p.uid, n: p.n, c: p.c, st: p.st})
  return out
}
function renderSide() {
  const {sid, cid} = S.view
  const srv = sid && srvById(sid)
  const head = $('#side-h')
  const box = $('#chans')
  if (!srv) {
    head.innerHTML = '<span class="t">Direkt Mesajlar</span>'
    head.dataset.act = ''
    let h = '<div class="cat"><span>Direkt Mesajlar</span></div>'
    const list = [...S.dms]
    // çevrimiçi arkadaşları da göster
    for (const c of Object.values(S.conns)) for (const p of Object.values(c.peers)) if (!list.includes(p.uid) && p.uid !== S.me.uid) list.push(p.uid)
    if (!list.length) h += '<div class="hint" style="padding:8px">Henüz DM yok. Bir sunucuda birinin adına tıklayıp “Mesaj Gönder” diyebilirsin.</div>'
    for (const uid of list) {
      const u = knownUser(uid), on = !!onlineUser(uid)
      const un = S.unread['dm|' + uid]
      h += `<button class="ch${cid === uid ? ' on' : ''}${un?.n ? ' unread' : ''}" data-act="dm" data-uid="${esc(uid)}">${avatar(u.n, u.c, 's24', `<span class="dot${on ? '' : ' off'}"></span>`)}<span class="nm">${esc(u.n)}</span>${un?.m ? `<span class="badge" style="border:0">${un.m}</span>` : ''}</button>`
    }
    box.innerHTML = h
    return
  }
  head.innerHTML = `<span class="t">${esc(srv.name)}</span><span>▾</span>`
  head.dataset.act = 'srv-menu'
  let h = '<div class="cat"><span>Metin Kanalları</span><button data-act="new-ch" data-type="text" title="Kanal oluştur">＋</button></div>'
  for (const c of srv.ch.filter(c => c.type === 'text')) {
    const un = S.unread[keyOf(sid, c.id)]
    h += `<button class="ch${cid === c.id && !S.showStage ? ' on' : ''}${un?.n ? ' unread' : ''}" data-act="ch" data-cid="${c.id}"><span class="hash">#</span><span class="nm">${esc(c.name)}</span>${un?.m ? `<span class="badge" style="border:0">${un.m}</span>` : ''}<span class="x" data-act="ch-menu" data-cid="${c.id}" title="Kanal ayarları">⚙</span></button>`
  }
  h += '<div class="cat"><span>Ses Kanalları</span><button data-act="new-ch" data-type="voice" title="Kanal oluştur">＋</button></div>'
  for (const c of srv.ch.filter(c => c.type === 'voice')) {
    const here = S.voice && S.voice.sid === sid && S.voice.cid === c.id
    h += `<button class="ch${here && S.showStage ? ' on' : ''}" data-act="vch" data-cid="${c.id}"><span class="hash">🔊</span><span class="nm">${esc(c.name)}</span><span class="x" data-act="ch-menu" data-cid="${c.id}" title="Kanal ayarları">⚙</span></button>`
    const us = voiceUsers(sid, c.id)
    if (us.length) {
      h += '<div class="vusers">'
      for (const u of us) {
        h += `<div class="vu" data-act="prof" data-uid="${esc(u.uid)}">${avatar(u.n, u.c, 's24' + (u.st.spk && !u.st.m ? ' spk' : ''), '', `data-pk="${u.pk}"`)}<span class="nm">${esc(u.n)}</span>${u.st.scr ? '<span class="live">CANLI</span>' : ''}${u.st.cam ? '<span class="ico">📷</span>' : ''}${u.st.d ? '<span class="ico">🔇</span>' : u.st.m ? '<span class="ico">🎙️̸</span>' : ''}</div>`
      }
      h += '</div>'
    }
  }
  box.innerHTML = h
}
function renderVbar() {
  const el = $('#vbar')
  const v = S.voice
  if (!v) { el.className = ''; el.innerHTML = ''; return }
  const srv = srvById(v.sid)
  const ch = srv?.ch.find(c => c.id === v.cid)
  const n = voicePeers().length
  el.className = 'on'
  el.innerHTML = `<div class="vb-top"><div class="vb-info"><div class="vb-st">📶 Ses Bağlandı</div><div class="vb-ch" data-act="vch" data-sid="${v.sid}" data-cid="${v.cid}" style="cursor:pointer">${esc(ch?.name || '')} / ${esc(srv?.name || '')} · ${n + 1} kişi</div></div><button class="ic-btn" data-act="leave-voice" title="Bağlantıyı kes">📞</button></div>
  <div class="vb-btns"><button class="${v.cam ? 'on' : ''}" data-act="cam" title="Kamera">📷</button><button class="${v.scr ? 'on' : ''}" data-act="screen" title="Ekran paylaş">🖥️</button><button data-act="vch" data-sid="${v.sid}" data-cid="${v.cid}" title="Sesli odayı aç">⤢</button></div>`
}
function renderMe() {
  const me = S.me
  const sub = S.voice ? (S.st.d ? 'Sağırlaştırıldı' : S.st.m ? 'Susturuldu' : S.settings.ptt ? 'Bas-konuş: ' + keyName(S.settings.pttKey) : 'Çevrimiçi') : 'Çevrimiçi'
  $('#mepanel').innerHTML = `<div class="who" data-act="prof" data-uid="${esc(me.uid)}">${avatar(me.name, me.color, '', '<span class="dot"></span>', 'data-pk="me"')}<div style="min-width:0"><div class="nm">${esc(me.name)}</div><div class="sub">${sub}</div></div></div>
  <button class="ic-btn${S.st.m ? ' off' : ''}" data-act="mute" title="Mikrofonu kapat/aç">🎙️</button>
  <button class="ic-btn${S.st.d ? ' off' : ''}" data-act="deafen" title="Sağırlaştır">🎧</button>
  <button class="ic-btn" data-act="settings" title="Ayarlar">⚙️</button>`
}
function renderHead() {
  const {sid, cid} = S.view
  const el = $('#main-h')
  let t = ''
  if (S.showStage && S.voice) {
    const ch = srvById(S.voice.sid)?.ch.find(c => c.id === S.voice.cid)
    t = `<span class="hash">🔊</span><span class="t">${esc(ch?.name || '')}</span>`
  } else if (!sid) {
    if (cid) { const u = knownUser(cid); t = `<span class="hash">@</span><span class="t">${esc(u.n)}</span>` } else t = '<span class="t">Ana Sayfa</span>'
  } else {
    const ch = srvById(sid)?.ch.find(c => c.id === cid)
    t = `<span class="hash">#</span><span class="t">${esc(ch?.name || '')}</span>`
  }
  let conn = ''
  if (sid && S.conns[sid]) {
    const n = Object.keys(S.conns[sid].peers).length
    conn = n ? `<span class="conn ok"><i></i>${n + 1} çevrimiçi</span>` : '<span class="conn" title="Sunucudaki diğer kişiler aranıyor"><i></i>Eş aranıyor…</span>'
  }
  el.innerHTML = `<button class="ic-btn" id="menu-btn" data-act="nav" title="Menü">☰</button>${t}<span class="sp"></span>${conn}${sid ? '<button class="ic-btn" data-act="invite" title="Arkadaş davet et">📨</button><button class="ic-btn" data-act="toggle-members" title="Üye listesi">👥</button>' : ''}`
}
function renderMembers() {
  const el = $('#members')
  const sid = S.view.sid
  const srv = sid && srvById(sid)
  if (!srv || S.showStage) { el.className = 'hide'; el.innerHTML = ''; return }
  el.className = S.settings.members ? '' : 'hide'
  if (S.mobileMembers) el.className = 'show-m'
  const c = S.conns[sid]
  const online = new Map([[S.me.uid, {uid: S.me.uid, n: S.me.name, c: S.me.color, st: stateFor(sid)}]])
  if (c) for (const p of Object.values(c.peers)) if (!online.has(p.uid)) online.set(p.uid, p)
  const off = Object.entries(srv.mem || {}).filter(([u]) => !online.has(u)).sort((a, b) => b[1].seen - a[1].seen).slice(0, 100)
  const row = (uid, n, col, sub, on) => `<div class="mem${on ? '' : ' off'}" data-act="prof" data-uid="${esc(uid)}">${avatar(n, col, '', `<span class="dot${on ? '' : ' off'}"></span>`)}<div style="min-width:0"><div class="nm" style="color:${on ? col : ''}">${esc(n)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`
  let h = `<div class="cat"><span>Çevrimiçi — ${online.size}</span></div>`
  for (const p of online.values()) {
    const vc = p.st?.v && srv.ch.find(x => x.id === p.st.v)
    h += row(p.uid, p.n, p.c, vc ? `🔊 ${esc(vc.name)}${p.st.scr ? ' · <span class="live">CANLI</span>' : ''}` : '', true)
  }
  if (off.length) {
    h += `<div class="cat"><span>Çevrimdışı — ${off.length}</span></div>`
    for (const [uid, u] of off) h += row(uid, u.n, u.c, '', false)
  }
  el.innerHTML = h
}
function homeHtml() {
  return `<div class="welcome" style="max-width:520px;margin:40px auto;text-align:center">
    <div class="big" style="margin:0 auto;background:var(--accent)">💬</div>
    <h1>Kanka Chat'e hoş geldin, ${esc(S.me.name)}!</h1>
    <p>Arkadaşlarınla yazılı, sesli ve görüntülü sohbet et, ekranını paylaş. Sunucu gerektirmez: her şey doğrudan cihazlarınız arasında, şifreli akar.</p>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:20px;flex-wrap:wrap">
      <button class="btn" data-act="new-srv">Sunucu Oluştur</button>
      <button class="btn green" data-act="join-srv">Sunucuya Katıl</button>
    </div></div>`
}
function renderMain() {
  renderHead()
  const stage = S.showStage && S.voice
  $('#chat').hidden = !!stage
  $('#stage').hidden = !stage
  $('#composer-wrap').hidden = !S.view.cid
  if (stage) renderStage(); else { clearStage(); renderMsgs() }
  renderMembers()
  renderTyping()
  const inp = $('#input')
  if (S.view.cid) {
    const {sid, cid} = S.view
    inp.placeholder = sid ? '#' + (srvById(sid)?.ch.find(c => c.id === cid)?.name || '') + ' kanalına mesaj gönder' : '@' + knownUser(cid).n + ' kişisine mesaj gönder'
  }
}
function updateTitle() {
  let n = 0
  for (const u of Object.values(S.unread)) n += u.m
  document.title = (n ? `(${n}) ` : '') + 'Kanka Chat'
}

// ======================= gezinme =======================
function go(sid, cid) {
  if (sid && !srvById(sid)) sid = null
  if (sid && !cid) cid = S.lastCh[sid] || firstText(srvById(sid))
  if (sid && cid && !srvById(sid).ch.some(c => c.id === cid && c.type === 'text')) cid = firstText(srvById(sid))
  S.view = {sid: sid || null, cid: cid || null}
  S.showStage = false
  S.editing = null
  setReply(null)
  if (sid) { S.lastCh[sid] = cid; LS.set('kd_lastch', S.lastCh) }
  LS.set('kd_view', S.view)
  const key = curKey()
  if (key && S.unread[key]) { delete S.unread[key]; LS.set('kd_unread', S.unread) }
  if (key) S.lim[key] = PAGE
  S.forceBottom = true
  S.renderedKey = null
  document.body.classList.remove('nav-open')
  invAll()
  if (key && matchMedia('(pointer:fine)').matches) setTimeout(() => $('#input').focus(), 0)
}
function openStage() {
  if (!S.voice) return
  if (S.view.sid !== S.voice.sid) { S.view = {sid: S.voice.sid, cid: S.lastCh[S.voice.sid] || firstText(srvById(S.voice.sid))} }
  S.showStage = true
  document.body.classList.remove('nav-open')
  invAll()
}

// ======================= ses / görüntü =======================
const Q = {
  low: {cw: 320, ch: 180, cf: 15, cb: 250e3},
  med: {cw: 640, ch: 360, cf: 24, cb: 600e3},
  high: {cw: 1280, ch: 720, cf: 30, cb: 1.5e6}
}
let AC = null
function actx() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)() } catch { return null } }
  if (AC.state === 'suspended') AC.resume().catch(() => {})
  return AC
}
function beep(kind) {
  if (!S.settings.sounds) return
  const ac = actx()
  if (!ac || ac.state !== 'running') return
  const f = {join: [520, 780], leave: [780, 520], msg: [880, 1100], mute: [500, 350], unmute: [350, 500]}[kind] || [600, 600]
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f[0], t)
  o.frequency.linearRampToValueAtTime(f[1], t + 0.12)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.1, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
  o.connect(g).connect(ac.destination)
  o.start(t)
  o.stop(t + 0.26)
}
function getMic() {
  const s = S.settings
  return navigator.mediaDevices.getUserMedia({
    audio: {deviceId: s.mic ? {ideal: s.mic} : undefined, echoCancellation: s.ec, noiseSuppression: s.ns, autoGainControl: s.agc, channelCount: 1}
  })
}
function voicePeers() {
  const v = S.voice
  if (!v) return []
  const c = S.conns[v.sid]
  return c ? Object.keys(c.peers).filter(pid => c.peers[pid].st.v === v.cid) : []
}
async function joinVoice(sid, cid) {
  if (S.voice && S.voice.sid === sid && S.voice.cid === cid) { openStage(); return }
  if (S.joining) return
  S.joining = true
  try {
    if (S.voice) leaveVoice(true)
    actx()
    let mic = null
    if (navigator.mediaDevices?.getUserMedia) {
      try { mic = await getMic() } catch (e) { toast('Mikrofona erişilemedi (' + (e.name || e.message) + ') — yalnızca dinleyebilirsin.') }
    } else toast('Bu tarayıcı mikrofon erişimini desteklemiyor (HTTPS gerekli).')
    S.voice = {sid, cid, mic, cam: null, scr: null, scrPreview: null, sent: {}, remote: {}, watching: new Set(), watchers: new Set(), levels: {}, lvSent: {}, spk: false}
    applyMic()
    startVad()
    S.conns[sid]?.a.st.send(stateFor(sid))
    for (const pid of voicePeers()) syncMedia(pid)
    beep('join')
    S.focus = null
    openStage()
  } finally { S.joining = false }
}
function leaveVoice(silent) {
  const v = S.voice
  if (!v) return
  const c = S.conns[v.sid]
  for (const pid of Object.keys(v.sent)) {
    for (const s of Object.values(v.sent[pid])) try { c?.room.removeStream(s, {target: pid}) } catch {}
  }
  stopVad()
  for (const s of [v.mic, v.cam, v.scr, v.scrPreview]) s?.getTracks().forEach(t => t.stop())
  for (const pid of Object.keys(v.remote)) dropRemote(pid)
  S.voice = null
  clearStage(true)
  c?.a.st.send(stateFor(v.sid))
  if (!silent) beep('leave')
  S.showStage = false
  invAll()
}
// Bir eşe hangi akışları göndermemiz gerektiğini hesaplar ve farkı uygular.
function syncMedia(pid) {
  const v = S.voice
  if (!v) return
  const c = S.conns[v.sid]
  if (!c) return
  const p = c.peers[pid]
  const inV = !!p && p.st.v === v.cid
  const want = {
    mic: inV ? v.mic : null,
    cam: inV ? v.cam : null,
    scr: inV && v.watchers.has(pid) ? v.scr : null
  }
  const sent = v.sent[pid] ||= {}
  let added = false
  for (const k of ['mic', 'cam', 'scr']) {
    if (sent[k] && sent[k] !== want[k]) {
      try { c.room.removeStream(sent[k], {target: pid}) } catch {}
      delete sent[k]
    }
    if (want[k] && !sent[k]) {
      sent[k] = want[k]
      added = true
      try {
        Promise.all(c.room.addStream(want[k], {target: pid, metadata: {k}})).then(() => tune(pid)).catch(() => {})
      } catch {}
    }
  }
  if (!Object.keys(sent).length) delete v.sent[pid]
  if (added) setTimeout(() => tune(pid), 1500)
}
function syncAllMedia() {
  const v = S.voice
  if (!v) return
  for (const pid of new Set([...voicePeers(), ...Object.keys(v.sent)])) syncMedia(pid)
}
// Gönderilen akışlar için bit hızı / kare hızı / öncelik ayarı: CPU ve bant genişliği tasarrufu.
function applyParams(sd, mutate) {
  const attempt = withDeg => {
    const p = sd.getParameters()
    if (!p.encodings || !p.encodings.length) return Promise.resolve()
    mutate(p, withDeg)
    return sd.setParameters(p)
  }
  try { attempt(true).catch(() => attempt(false)).catch(() => {}) } catch {}
}
// Tüm izleyiciler için ekran yayını planı (çözünürlük, FPS, bit hızı). Her izleyici ayrı bir kodlayıcı
// demek; toplam piksel hızı bütçeyi aşarsa önce FPS, sonra çözünürlük kademeli düşürülür.
// Yazılım (işlemci) kodlaması donanıma göre kabaca 6 kat pahalı sayılır.
const LOAD_BUDGET = 1.0e9
function screenPlans() {
  const v = S.voice, s = S.settings
  const t = v?.scr?.getVideoTracks()[0]
  if (!t) return {}
  const st = t.getSettings ? t.getSettings() : {}
  const srcH = st.height || 1080
  const srcW = st.width || Math.round(srcH * 16 / 9)
  const maxFps = Math.min(scrFps(), Math.round(st.frameRate || 1000))
  const plans = {}
  for (const pid of v.watchers) {
    const L = v.levels[pid] || {lv: 'full', h: 0}
    const codec = pickCodec(S.conns[v.sid]?.peers[pid]?.hw)
    let fps = maxFps
    let h = Math.min(srcH, L.h || srcH)
    if (L.lv === 'mid') fps = Math.min(fps, 60)
    if (L.lv === 'small') { fps = Math.min(fps, 30); h = Math.min(h, 360) }
    if (L.lv === 'low') { fps = Math.min(fps, 15); h = Math.min(h, 360) }
    plans[pid] = {active: L.lv !== 'off', fps, h, codec, hw: isHwCodec(codec), limited: false}
  }
  const act = Object.values(plans).filter(p => p.active)
  const load = () => act.reduce((a, p) => a + srcW * srcH * (p.h / srcH) ** 2 * p.fps * (p.hw ? 1 : 6), 0)
  const steps = [p => { if (p.fps > 60) p.fps = 60 }, p => { if (p.h > 1440) p.h = 1440 }, p => { if (p.h > 1080) p.h = 1080 },
    p => { if (p.fps > 30) p.fps = 30 }, p => { if (p.h > 720) p.h = 720 }]
  for (const step of steps) {
    if (load() <= LOAD_BUDGET) break
    for (const p of act) { const b = p.fps + p.h; step(p); if (p.fps + p.h !== b) p.limited = true }
  }
  for (const p of Object.values(plans)) {
    p.scale = Math.max(1, srcH / p.h)
    p.br = screenBitrate(srcW / p.scale, srcH / p.scale, p.fps, p.codec, s.smode === 'motion')
  }
  return plans
}
function tune(pid) {
  const v = S.voice
  if (!v) return
  const pc = S.conns[v.sid]?.room.getPeers()[pid]
  if (!pc) return
  const q = Q[S.settings.vq] || Q.med
  const n = Math.max(1, voicePeers().length)
  const scrV = v.scr?.getVideoTracks()[0] || null
  const scrA = v.scr?.getAudioTracks() || []
  for (const sd of pc.getSenders()) {
    const t = sd.track
    if (!t) continue
    if (t.kind === 'audio') {
      const isScr = scrA.includes(t)
      applyParams(sd, p => Object.assign(p.encodings[0], {maxBitrate: isScr ? 192000 : 64000, priority: isScr ? 'medium' : 'high', networkPriority: isScr ? 'medium' : 'high'}))
    } else if (t === scrV) {
      const plan = screenPlans()[pid]
      if (!plan) continue
      applyParams(sd, (p, deg) => {
        Object.assign(p.encodings[0], {active: plan.active, maxBitrate: plan.br, maxFramerate: plan.fps, scaleResolutionDownBy: plan.scale, priority: 'medium', networkPriority: 'medium'})
        if (deg) p.degradationPreference = S.settings.smode === 'motion' ? 'maintain-framerate' : 'maintain-resolution'
      })
    } else {
      applyParams(sd, p => Object.assign(p.encodings[0], {maxBitrate: Math.max(150e3, Math.round(q.cb / Math.sqrt(n))), maxFramerate: q.cf, priority: 'low', networkPriority: 'low'}))
    }
  }
}
function onStream(c, pid, stream, meta) {
  const v = S.voice
  const k = meta && meta.k
  if (!v || v.sid !== c.sid || !['mic', 'cam', 'scr'].includes(k)) return
  const r = v.remote[pid] ||= {}
  r[k] = stream
  const drop = () => { if (r[k] === stream) { delete r[k]; if (k === 'scr') dropScreenAudio(pid); inv('stage') } }
  stream.addEventListener('removetrack', () => { if (!stream.getTracks().length) drop() })
  stream.getTracks().forEach(t => t.addEventListener('ended', drop))
  if (k === 'scr') attachScreenAudio(pid, stream)
  if (k === 'mic') {
    let a = S.audios[pid]
    if (!a) {
      a = S.audios[pid] = document.createElement('audio')
      a.autoplay = true
      $('#audios').appendChild(a)
    }
    a.srcObject = stream
    applyAudio()
    a.play().catch(() => toast('Sesi duymak için sayfaya bir kez tıkla.'))
  }
  inv('stage')
}
// Yayın (oyun) sesi görüntüden bağımsız çalar: izleyici sohbete geçse de, görüntü kodlaması dursa da ses devam eder
function attachScreenAudio(pid, stream) {
  const update = () => {
    const tracks = stream.getAudioTracks()
    if (!tracks.length) { dropScreenAudio(pid); return }
    let a = S.saudios[pid]
    if (!a) {
      a = S.saudios[pid] = document.createElement('audio')
      a.autoplay = true
      $('#audios').appendChild(a)
    }
    const cur = a.srcObject?.getAudioTracks() || []
    if (cur.length !== tracks.length || cur.some((t, i) => t !== tracks[i])) a.srcObject = new MediaStream(tracks)
    applyAudio()
    a.play().catch(() => {})
  }
  update()
  stream.addEventListener('addtrack', update)
  stream.addEventListener('removetrack', update)
}
function dropScreenAudio(pid) {
  const a = S.saudios[pid]
  if (a) { a.srcObject = null; a.remove(); delete S.saudios[pid] }
}
function dropRemote(pid) {
  const v = S.voice
  if (v) delete v.remote[pid]
  const a = S.audios[pid]
  if (a) { a.srcObject = null; a.remove(); delete S.audios[pid] }
  dropScreenAudio(pid)
  for (const key of [pid + ':u', pid + ':s']) {
    const el = S.tileEls.get(key)
    if (el) { const vid = el.querySelector('video'); if (vid) vid.srcObject = null; el.remove(); S.tileEls.delete(key) }
  }
  inv('stage')
}
function uidOfPid(pid) {
  const v = S.voice
  return v && S.conns[v.sid]?.peers[pid]?.uid
}
function volOf(uid) { const x = S.vol[uid]; return typeof x === 'number' ? Math.min(1, Math.max(0, x)) : 1 }
const svolOf = uid => { const x = S.svol[uid]; return typeof x === 'number' ? Math.min(1, Math.max(0, x)) : 1 }
function applyAudio() {
  for (const [pid, a] of Object.entries(S.audios)) {
    a.muted = !!S.st.d
    a.volume = volOf(uidOfPid(pid))
  }
  for (const [pid, a] of Object.entries(S.saudios)) {
    a.muted = !!S.st.d
    a.volume = svolOf(uidOfPid(pid))
  }
}
function applyMic() {
  const v = S.voice
  const t = v?.mic?.getAudioTracks()[0]
  if (t) t.enabled = !S.st.m && !S.st.d && (!S.settings.ptt || S.pttDown)
}
function setMute(m) {
  S.st.m = m
  if (!m && S.st.d) S.st.d = false
  LS.set('kd_st', S.st)
  applyMic()
  applyAudio()
  beep(m ? 'mute' : 'unmute')
  sendState()
  inv('me', 'side', 'stage')
}
function setDeaf(d) {
  S.st.d = d
  LS.set('kd_st', S.st)
  applyMic()
  applyAudio()
  beep(d ? 'mute' : 'unmute')
  sendState()
  inv('me', 'side', 'stage')
}
function sendState() {
  if (S.voice) S.conns[S.voice.sid]?.a.st.send(stateFor(S.voice.sid))
}

// Konuşma algılama: yalnızca kendi mikrofonumuz analiz edilir (düşük maliyet),
// sonuç diğerlerine durum olarak gönderilir.
let vad = null
function makeMeter(stream) {
  const ac = actx()
  if (!ac || !stream?.getAudioTracks().length) return null
  const src = ac.createMediaStreamSource(stream)
  const an = ac.createAnalyser()
  an.fftSize = 512
  src.connect(an)
  const buf = new Uint8Array(an.fftSize)
  return {
    level() {
      an.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i += 2) { const x = buf[i] - 128; sum += x * x }
      return Math.sqrt(sum / (buf.length / 2))
    },
    stop() { try { src.disconnect() } catch {} }
  }
}
function startVad() {
  stopVad()
  const v = S.voice
  if (!v?.mic) return
  const meter = makeMeter(v.mic)
  if (!meter) return
  let last = 0
  const iv = setInterval(() => {
    if (!S.voice) return
    const t = v.mic.getAudioTracks()[0]
    const lvl = t?.enabled ? meter.level() : 0
    S.level = lvl
    const nw = performance.now()
    if (lvl > S.settings.sens) last = nw
    const spk = nw - last < 300
    if (spk !== v.spk) { v.spk = spk; sendState(); updateSpeaking() }
  }, 100)
  vad = {meter, iv}
}
function stopVad() {
  if (!vad) return
  clearInterval(vad.iv)
  vad.meter.stop()
  vad = null
}
function isSpeaking(pk) {
  if (pk === 'me') return !!(S.voice?.spk && !S.st.m)
  const [sid, pid] = pk.split(':')
  const p = S.conns[sid]?.peers[pid]
  return !!(p && p.st.spk && !p.st.m)
}
function updateSpeaking() {
  for (const el of $$('[data-pk]')) el.classList.toggle('spk', isSpeaking(el.dataset.pk))
}

async function toggleCam() {
  const v = S.voice
  if (!v) return
  if (v.cam) {
    v.cam.getTracks().forEach(t => t.stop())
    v.cam = null
  } else {
    const q = Q[S.settings.vq] || Q.med
    try {
      v.cam = await navigator.mediaDevices.getUserMedia({
        video: {deviceId: S.settings.cam ? {ideal: S.settings.cam} : undefined, width: {ideal: q.cw}, height: {ideal: q.ch}, frameRate: {ideal: q.cf, max: q.cf}}
      })
      const t = v.cam.getVideoTracks()[0]
      if (t) { t.contentHint = 'motion'; t.addEventListener('ended', () => { if (S.voice?.cam) toggleCam() }) }
    } catch (e) {
      toast('Kameraya erişilemedi: ' + (e.name || e.message))
      return
    }
    if (S.voice !== v) { v.cam.getTracks().forEach(t => t.stop()); return }
  }
  syncAllMedia()
  sendState()
  inv('vbar', 'side', 'stage')
}
// ---------- ekran paylaşımı ----------
const LEVELS = ['full', 'mid', 'small', 'low', 'off']
const scrFps = () => S.settings.sfps || (HW.enc.length ? 120 : 60)
function screenConstraints() {
  const h = S.settings.sres
  const fps = scrFps()
  // resizeMode açıkça verilmeli: Chrome applyConstraints'te varsayılanı 'none' yapıp boyut sınırını yok sayıyor
  const c = {frameRate: {ideal: fps, max: fps}, resizeMode: 'crop-and-scale'}
  // 0 = kaynak çözünürlük: ekran neyse o (1440p, 4K…), hiç küçültme yok
  if (h) Object.assign(c, {height: {max: h}, width: {max: Math.round(h * 2.4)}})
  return c
}
const switchRow = (name, on, label) => `<label class="row"><span>${label}</span><span class="sw"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><i></i></span></label>`
function goLiveModal() {
  const v = S.voice
  if (!v) return
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('Bu tarayıcı ekran paylaşımını desteklemiyor (masaüstü Chrome/Edge/Firefox kullan).')
  const s = S.settings
  const live = !!v.scr
  const pick = {res: s.sres, fps: scrFps(), mode: s.smode}
  const seg = (name, items) => `<div class="seg" data-seg="${name}">${items.map(([val, label, sub]) => `<button type="button" data-v="${val}" class="${String(val) === String(pick[name]) ? 'on' : ''}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div>`
  const hw = HW.enc.length
    ? `✅ Donanım hızlandırma açık (${HW.enc.map(m => m.split('/')[1]).join(', ')}): yayın ekran kartında kodlanır, işlemci yorulmaz.`
    : '⚠️ Bu cihazda donanım kodlayıcı bulunamadı; yayın işlemcide kodlanır. Takılma olursa 60 FPS seç.'
  modal(`<div class="mh"><h2>${live ? 'Yayın kalitesi' : 'Ekranını paylaş'}</h2><p>${live ? 'Değişiklikler yayını kesmeden uygulanır.' : 'Paylaşacağın ekranı, pencereyi veya sekmeyi bir sonraki adımda seçeceksin.'}</p></div>
    <div class="mb">
      <div class="field"><label>Çözünürlük</label>${seg('res', [[0, 'Kaynak', 'en net'], [2160, '4K'], [1440, '1440p'], [1080, '1080p'], [720, '720p']])}</div>
      <div class="field"><label>Kare hızı</label>${seg('fps', [[30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS']])}</div>
      <div class="field"><label>İçerik türü</label>${seg('mode', [['motion', '🎮 Oyun / Video', 'akıcılık öncelikli'], ['detail', '📝 Yazı / Kod', 'netlik öncelikli']])}</div>
      ${live ? '' : switchRow('saudio', s.saudio, '🔊 Oyun / bilgisayar sesini de paylaş')}
      ${live ? '' : '<div class="hint" style="margin-top:0">Oyun sesi için açılan pencerede <b>“Tüm ekran”</b> sekmesini seç ve alttaki <b>“Sistem sesini de paylaş”</b> kutusunu işaretle (Windows, Chrome/Edge). Tarayıcı sekmesi paylaşırken “Sekme sesini de paylaş”ı işaretle. Tek bir pencere paylaşılırken tarayıcılar ses vermez.</div>'}
      <div class="hint">${hw}<br>“Kaynak”, ekranın kendi çözünürlüğüdür (ör. 1440p, 4K) ve en net görüntüyü verir. Her izleyiciye, ekranında gösterebileceğinden daha büyük görüntü gönderilmez; kimse izlemiyorsa hiç kodlama yapılmaz. 120 FPS'i görmek için izleyicinin ekranı 120 Hz olmalı.</div>
    </div>
    <div class="mf">${live ? '<button class="btn red" id="gl-stop">Yayını durdur</button>' : '<button class="btn sec" id="gl-cancel">Vazgeç</button>'}<button class="btn" id="gl-go">${live ? 'Uygula' : 'Yayına başla'}</button></div>`, root => {
    root.addEventListener('click', e => {
      const b = e.target.closest('.seg button')
      if (!b) return
      const segEl = b.parentElement
      segEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
      const key = segEl.dataset.seg
      pick[key] = key === 'mode' ? b.dataset.v : +b.dataset.v
    })
    root.querySelector('#gl-cancel')?.addEventListener('click', closeModal)
    root.querySelector('#gl-stop')?.addEventListener('click', () => { closeModal(); stopScreen() })
    root.querySelector('#gl-go').addEventListener('click', () => {
      Object.assign(s, {sres: pick.res, sfps: pick.fps, smode: pick.mode})
      const au = root.querySelector('input[name=saudio]')
      if (au) s.saudio = au.checked
      saveSettings()
      closeModal()
      // getDisplayMedia, tıklamanın içinde (kullanıcı hareketiyle) çağrılmalı
      if (live) applyScreenSettings(); else startScreen()
    })
  })
}
async function startScreen() {
  const v = S.voice
  if (!v || v.scr) return
  const s = S.settings
  const base = {
    video: screenConstraints(),
    audio: s.saudio ? {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000,
      // Sohbetteki arkadaşlarının sesleri yayına geri karışmasın (destekleyen tarayıcılarda)
      restrictOwnAudio: true, suppressLocalAudioPlayback: false
    } : false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include'
  }
  const extra = s.saudio ? {systemAudio: 'include', windowAudio: 'system'} : {systemAudio: 'exclude'}
  let stream
  try {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({...base, ...extra})
    } catch (e) {
      // Eski tarayıcılar bilinmeyen bir seçeneğe TypeError verebilir: temel seçeneklerle tekrar dene
      if (e.name !== 'TypeError') throw e
      stream = await navigator.mediaDevices.getDisplayMedia({...base, systemAudio: extra.systemAudio})
    }
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Ekran paylaşılamadı: ' + (e.name || e.message))
    return
  }
  const t = stream.getVideoTracks()[0]
  if (S.voice !== v || v.scr || !t) { stream.getTracks().forEach(x => x.stop()); return }
  t.contentHint = s.smode === 'motion' ? 'motion' : 'detail'
  t.addEventListener('ended', stopScreen)
  const at = stream.getAudioTracks()[0]
  if (at) at.contentHint = 'music'
  else if (s.saudio) {
    toast('Oyun sesi alınamadı. Ses için paylaşırken “Tüm ekran”ı seçip “Sistem sesini de paylaş” kutusunu işaretle (veya bir sekme paylaşıp “Sekme sesini de paylaş”ı işaretle).', 9000)
  }
  // Kendi önizlememiz düşük FPS/çözünürlüklü bir kopya: tam kaliteyi kendine göstermek boşa GPU harcar
  const pt = t.clone()
  pt.applyConstraints({frameRate: {max: 15}, height: {max: 540}, width: {max: 1296}, resizeMode: 'crop-and-scale'}).catch(() => {})
  v.scrPreview = new MediaStream([pt])
  v.scr = stream
  v.watchers = new Set()
  v.levels = {}
  sendState()
  inv('vbar', 'side', 'stage')
}
function applyScreenSettings() {
  const t = S.voice?.scr?.getVideoTracks()[0]
  if (!t) return
  t.contentHint = S.settings.smode === 'motion' ? 'motion' : 'detail'
  t.applyConstraints(screenConstraints())
    .then(() => toast('Yayın kalitesi güncellendi.'))
    .catch(() => toast('Bu kalite ayarı ekran kaynağına uygulanamadı.'))
    .finally(retuneScreen)
}
function retuneScreen() {
  const v = S.voice
  if (v) for (const pid of v.watchers) tune(pid)
}
function stopScreen() {
  const v = S.voice
  if (!v?.scr) return
  v.scr.getTracks().forEach(t => t.stop())
  v.scrPreview?.getTracks().forEach(t => t.stop())
  v.scr = null
  v.scrPreview = null
  v.watchers = new Set()
  v.levels = {}
  syncAllMedia()
  sendState()
  inv('vbar', 'side', 'stage')
}
// Yayıncı tarafı: izleyicinin istediği kalite seviyesini kaydet ve kodlayıcıyı ayarla
// Yayıncı tarafı: izleyicinin istediği kalite seviyesini kaydet ve kodlayıcıları ayarla
function onWatch(c, d, pid) {
  const v = S.voice
  if (!v || v.sid !== c.sid) return
  if (d && d.on && v.scr) {
    v.watchers.add(pid)
    v.levels[pid] = {lv: LEVELS.includes(d.lv) ? d.lv : 'full', h: Math.min(4320, Math.max(0, Math.round(+d.h) || 0))}
  } else {
    v.watchers.delete(pid)
    delete v.levels[pid]
  }
  if (!(v.watchers.has(pid) && v.sent[pid]?.scr)) syncMedia(pid)
  // Yük bütçesi tüm izleyicilerde ortak: hepsini yeniden ayarla
  retuneScreen()
  inv('stage')
}
function setWatching(pid, on) {
  const v = S.voice
  if (!v) return
  const h = stepUp(screenPx())
  if (on) {
    v.watching.add(pid)
    v.lvSent[pid] = 'full' + h
    S.focus = pid + ':s'
  } else {
    v.watching.delete(pid)
    delete v.lvSent[pid]
    if (v.remote[pid]) delete v.remote[pid].scr
    dropScreenAudio(pid)
    if (S.focus === pid + ':s') S.focus = null
  }
  S.conns[v.sid]?.a.watch.send({on: !!on, lv: 'full', h}, {target: pid})
  inv('stage')
}
// Yayının ekranda ne kadar büyük göründüğüne göre yayıncıdan uygun kaliteyi iste:
// görünmüyorsa hiç kodlanmasın, küçük kutucuksa hafif sürüm gelsin.
// Yayının ekranda kaç piksel yükseklikte göründüğüne göre yayıncıdan uygun kaliteyi iste:
// görünmüyorsa hiç kodlanmasın, ekranda gösterilebilecekten büyük görüntü gönderilmesin.
const STEPS = [360, 540, 720, 1080, 1440, 2160, 4320]
const stepUp = px => STEPS.find(x => x >= px) || 4320
const screenPx = () => Math.round((window.screen?.height || 1080) * (window.devicePixelRatio || 1))
function watchLevel(pid) {
  const key = pid + ':s'
  const el = S.tileEls.get(key)
  const vid = el?.querySelector('video')
  if (vid && document.pictureInPictureElement === vid) return {lv: 'full', h: stepUp(screenPx())}
  if (!el || !el.isConnected || !S.showStage || document.hidden) return {lv: 'off', h: 0}
  if (document.fullscreenElement === el) return {lv: 'full', h: stepUp(screenPx())}
  // Netlik için kutucuğun piksel yüksekliğinin üstünde çözünürlük iste (yazılar keskin kalsın)
  const h = el.clientHeight * (window.devicePixelRatio || 1)
  if (S.focus === key) return {lv: 'full', h: stepUp(h * 2)}
  if (el.closest('.strip')) return {lv: 'low', h: 360}
  return {lv: h >= 700 ? 'full' : h >= 300 ? 'mid' : 'small', h: stepUp(h * 1.5)}
}
function updateWatchLevels() {
  const v = S.voice
  const c = v && S.conns[v.sid]
  if (!c) return
  for (const pid of v.watching) {
    const {lv, h} = watchLevel(pid)
    const sig = lv + h
    if (v.lvSent[pid] !== sig) {
      v.lvSent[pid] = sig
      c.a.watch.send({on: true, lv, h}, {target: pid})
    }
  }
}
// ---------- canlı yayın istatistikleri ----------
let statsT = 0
function startStats() { if (!statsT) statsT = setInterval(pollStats, 2000) }
function stopStats() { clearInterval(statsT); statsT = 0 }
function setQb(el, txt, warn) {
  const q = el?.querySelector('.qb')
  if (!q) return
  q.hidden = !txt
  q.textContent = txt
  q.classList.toggle('warn', !!warn)
}
const mbps = b => (b / 1e6).toFixed(1) + ' Mbps'
async function pollStats() {
  const v = S.voice
  if (!v || !S.showStage || (!v.scr && !v.watching.size)) return stopStats()
  if (document.hidden) return
  const c = S.conns[v.sid]
  if (!c) return
  const peers = c.room.getPeers()
  for (const pid of v.watching) {
    const el = S.tileEls.get(pid + ':s')
    const tr = v.remote[pid]?.scr?.getVideoTracks()[0]
    if (!el || !tr) continue
    const s = await videoStats(peers[pid], tr, 'in')
    setQb(el, s && s.h ? `${s.h}p · ${s.fps} FPS · ${s.codec}${s.hw ? ' (GPU)' : ''} · ${mbps(s.br)}` : '')
  }
  const me = S.tileEls.get('me:s')
  const t = v.scr?.getVideoTracks()[0]
  if (me && t) {
    const st = t.getSettings()
    const ws = [...v.watchers]
    if (!ws.length) {
      setQb(me, `${st.height || '?'}p · ${Math.round(st.frameRate || 0)} FPS hazır · izleyen yok, kodlama yapılmıyor`)
    } else {
      const all = (await Promise.all(ws.map(pid => videoStats(peers[pid], t, 'out')))).filter(Boolean)
      const top = all.slice().sort((a, b) => b.fps - a.fps)[0]
      let txt = top ? `${top.h || st.height}p · ${top.fps} FPS · ${top.codec}${top.hw ? ' (GPU)' : ''} · ${ws.length} izleyici` : `${ws.length} izleyici`
      if (Object.values(screenPlans()).some(p => p.limited)) txt += ' · yük dengeleniyor'
      const cpu = all.some(x => x.lim === 'cpu'), net = all.some(x => x.lim === 'bandwidth')
      if (cpu) txt += ' · ⚠️ İşlemci yetişemiyor, FPS veya çözünürlüğü düşür'
      else if (net) txt += ' · ⚠️ İnternet yetmiyor, kalite otomatik düşürüldü'
      setQb(me, txt, cpu || net)
    }
  }
}

// ---------- sahne (ses odası görünümü) ----------
function stageTiles() {
  const v = S.voice
  const c = S.conns[v.sid]
  const tiles = [{key: 'me:u', pk: 'me', kind: 'u', n: S.me.name, c: S.me.color, stream: v.cam, mine: true, m: S.st.m || !v.mic, d: S.st.d}]
  if (v.scr) tiles.push({key: 'me:s', kind: 's', n: S.me.name, c: S.me.color, stream: v.scrPreview || v.scr, mine: true})
  for (const pid of voicePeers()) {
    const p = c.peers[pid], r = v.remote[pid] || {}
    tiles.push({key: pid + ':u', pk: c.sid + ':' + pid, kind: 'u', n: p.n, c: p.c, stream: p.st.cam ? r.cam || null : null, m: p.st.m, d: p.st.d})
    if (p.st.scr) tiles.push({key: pid + ':s', pid, kind: 's', n: p.n, c: p.c, stream: v.watching.has(pid) ? r.scr || null : null, watching: v.watching.has(pid)})
  }
  return tiles
}
function tileEl(t) {
  let el = S.tileEls.get(t.key)
  if (!el) {
    el = document.createElement('div')
    el.className = 'tile'
    el.dataset.key = t.key
    el.dataset.act = 'tile'
    el.innerHTML = '<div class="ph"></div><div class="qb" hidden></div><div class="lbl"></div><div class="tbtns"><button data-act="unwatch" title="İzlemeyi bırak">✕</button><button data-act="pip" title="Resim içinde resim">⧉</button><button data-act="fs" title="Tam ekran">⛶</button></div>'
    S.tileEls.set(t.key, el)
  }
  const ph = el.querySelector('.ph'), lbl = el.querySelector('.lbl')
  let vid = el.querySelector('video')
  const hasVideo = !!(t.stream && t.stream.getVideoTracks().length)
  if (hasVideo) {
    if (!vid) {
      vid = document.createElement('video')
      vid.autoplay = true
      vid.playsInline = true
      vid.disableRemotePlayback = true
      el.prepend(vid)
    }
    vid.muted = true
    if (vid.srcObject !== t.stream) vid.srcObject = t.stream
    vid.className = t.kind === 'u' ? 'cam' + (t.mine ? ' mirror' : '') : ''
    ph.hidden = true
  } else {
    if (vid) { vid.srcObject = null; vid.remove() }
    ph.hidden = false
    setQb(el, '')
    let sig, html
    if (t.kind === 'u') {
      sig = 'u' + t.n + t.c
      html = avatar(t.n, t.c, 's80')
    } else if (t.mine) {
      sig = 'sm'
      html = '<div class="scrinfo">🖥️<div>Ekranını paylaşıyorsun</div></div>'
    } else if (t.watching) {
      sig = 'sw'
      html = '<div class="scrinfo">⏳<div>Yayın yükleniyor…</div></div>'
    } else {
      sig = 'sx' + t.n
      html = `<div class="scrinfo"><span class="live">CANLI</span><div>${esc(t.n)} ekranını paylaşıyor</div><button class="watch" data-act="watch" data-pid="${esc(t.pid)}">Yayını İzle</button></div>`
    }
    if (ph.dataset.sig !== sig) { ph.dataset.sig = sig; ph.innerHTML = html }
  }
  const [unw, pip] = el.querySelectorAll('.tbtns button')
  unw.hidden = !(t.kind === 's' && !t.mine && t.watching)
  pip.hidden = !(hasVideo && !t.mine && document.pictureInPictureEnabled)
  const icons = t.kind === 's' ? '<span class="live">CANLI</span> ' : t.d ? '🔇 ' : t.m ? '🎙️̸ ' : ''
  const ltxt = icons + esc(t.n) + (t.kind === 's' ? ' — ekran' : '') + (t.mine && t.kind === 'u' ? ' (sen)' : '')
  if (lbl.dataset.sig !== ltxt) { lbl.dataset.sig = ltxt; lbl.innerHTML = ltxt }
  if (t.kind === 'u') { el.dataset.pk = t.pk; el.classList.toggle('spk', isSpeaking(t.pk)) } else delete el.dataset.pk
  return el
}
function clearStage(force) {
  const st = $('#stage')
  const pip = document.pictureInPictureElement
  if (pip && st.contains(pip)) {
    // Resim içinde resim açıkken yayını kapatma; sohbete geçince de izlemeye devam edilebilsin
    if (!force) { updateWatchLevels(); return }
    document.exitPictureInPicture?.().catch(() => {})
  }
  for (const el of S.tileEls.values()) { const v = el.querySelector('video'); if (v) v.srcObject = null }
  S.tileEls.clear()
  st.innerHTML = ''
  stopStats()
  updateWatchLevels()
}
function renderStage() {
  const st = $('#stage')
  if (!S.showStage || !S.voice) return
  if (!st.firstChild) {
    st.innerHTML = '<div class="stage-h"></div><div class="area"></div><div class="ctrl"></div>'
  }
  const tiles = stageTiles()
  const keys = new Set(tiles.map(t => t.key))
  for (const [k, el] of S.tileEls) if (!keys.has(k)) { const v = el.querySelector('video'); if (v) v.srcObject = null; el.remove(); S.tileEls.delete(k) }
  if (S.focus && !keys.has(S.focus)) S.focus = null
  const area = st.querySelector('.area')
  const els = tiles.map(tileEl)
  if (S.focus) {
    if (!area.classList.contains('focus-wrap')) { area.className = 'area focus-wrap'; area.innerHTML = '<div class="big"></div><div class="strip"></div>'; area.style.removeProperty('--cols') }
    const big = area.querySelector('.big'), strip = area.querySelector('.strip')
    const fe = S.tileEls.get(S.focus)
    if (fe.parentNode !== big) big.replaceChildren(fe)
    const rest = els.filter(e => e !== fe)
    if (rest.some((e, i) => strip.children[i] !== e) || strip.children.length !== rest.length) strip.replaceChildren(...rest)
  } else {
    if (!area.classList.contains('grid')) { area.className = 'area grid'; area.innerHTML = '' }
    const n = els.length
    const w = st.clientWidth || 800
    area.style.setProperty('--cols', n <= 1 ? 1 : n <= 4 && w > 700 ? 2 : Math.min(4, Math.ceil(Math.sqrt(n))))
    if (els.some((e, i) => area.children[i] !== e) || area.children.length !== n) area.replaceChildren(...els)
  }
  // DOM'da taşınan videolar duraklar; yeniden başlat
  for (const v of area.querySelectorAll('video')) if (v.paused) v.play().catch(() => {})
  const v = S.voice
  const ch = srvById(v.sid)?.ch.find(c => c.id === v.cid)
  st.querySelector('.stage-h').textContent = `🔊 ${ch?.name || ''} · ${tiles.filter(t => t.kind === 'u').length} kişi${S.focus ? ' · küçültmek için büyük kutucuğa tıkla' : ' · büyütmek için bir kutucuğa tıkla'}`
  const ctrl = `<button class="${S.st.m ? 'off' : ''}" data-act="mute" title="Mikrofon">🎙️</button>
    <button class="${S.st.d ? 'off' : ''}" data-act="deafen" title="Sağırlaştır">🎧</button>
    <button class="${v.cam ? 'on' : ''}" data-act="cam" title="Kamera">📷</button>
    <button class="${v.scr ? 'on' : ''}" data-act="screen" title="${v.scr ? 'Yayın kalitesi / durdur' : 'Ekran paylaş'}">🖥️</button>
    <button data-act="settings" data-tab="video" title="Ses/Görüntü ayarları">⚙️</button>
    <button class="hang" data-act="leave-voice" title="Bağlantıyı kes">📞</button>`
  const ce = st.querySelector('.ctrl')
  if (ce.dataset.sig !== ctrl) { ce.dataset.sig = ctrl; ce.innerHTML = ctrl }
  if (v.scr || v.watching.size) startStats()
  // Yerleşim oturduktan sonra kalite seviyelerini bildir
  requestAnimationFrame(updateWatchLevels)
}

// ======================= modallar / popoverlar =======================
function modal(html, onMount) {
  const o = $('#overlay')
  o.innerHTML = `<div class="modal" role="dialog">${html}</div>`
  o.hidden = false
  onMount?.(o.firstChild)
  const f = o.querySelector('input:not([type=checkbox]):not([type=range]), textarea')
  if (f) setTimeout(() => f.focus(), 30)
}
function closeModal() {
  const o = $('#overlay')
  if (o.hidden) return
  S.modalCleanup?.()
  S.modalCleanup = null
  o.hidden = true
  o.innerHTML = ''
}
function pop(html, anchor) {
  const p = $('#pop')
  p.innerHTML = html
  p.hidden = false
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : {left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y}
  const pw = p.offsetWidth, ph = p.offsetHeight
  let x = Math.min(r.left, innerWidth - pw - 8)
  let y = r.bottom + 6
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6)
  p.style.left = Math.max(8, x) + 'px'
  p.style.top = y + 'px'
}
const closePop = () => { const p = $('#pop'); p.hidden = true; p.innerHTML = ''; S.popFor = null }
function toast(t, ms = 4000) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = t
  $('#toasts').appendChild(el)
  setTimeout(() => el.remove(), ms)
}
function notify(title, body) {
  if (!document.hidden || !S.settings.notif || !('Notification' in window) || Notification.permission !== 'granted') return
  try { new Notification(title, {body: clamp(body, 140), tag: 'kanka', silent: true}) } catch {}
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopyalandı!') } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); toast('Kopyalandı!') } catch { toast('Kopyalanamadı, elle seç.') }
    ta.remove()
  }
}
const colorPicker = sel => `<div class="colors">${COLORS.map(c => `<button type="button" style="background:${c}" class="${c === sel ? 'on' : ''}" data-color="${c}"></button>`).join('')}</div>`
function bindColors(root, cb) {
  root.querySelector('.colors').addEventListener('click', e => {
    const b = e.target.closest('[data-color]')
    if (!b) return
    root.querySelectorAll('.colors button').forEach(x => x.classList.toggle('on', x === b))
    cb(b.dataset.color)
  })
}

function onboarding() {
  let color = COLORS[Math.floor(Math.random() * COLORS.length)]
  modal(`<div class="mh"><h2>Kanka Chat'e hoş geldin!</h2><p>Arkadaşlarının seni göreceği adı seç. Hesap yok, şifre yok.</p></div>
    <form class="mb" id="ob"><div class="field"><label>Kullanıcı adı</label><input class="inp" name="n" maxlength="32" placeholder="ör. Ali"></div>
    <div class="field"><label>Renk</label>${colorPicker(color)}</div><button class="btn full">Devam et</button>
    <details class="restore"><summary>Başka bir bilgisayarda hesabın mı var?</summary>
      <div class="field"><label>Hesap yedek kodu</label><input class="inp" name="code" placeholder="KANKA1-…"></div>
      <div class="hint">Diğer bilgisayarda ⚙️ Ayarlar → Profil → “Hesap yedeği”nden kopyala. Adın, kimliğin ve sunucuların buraya gelir.</div>
      <button type="button" class="btn green full" id="ob-restore">Hesabımı getir</button>
    </details></form>`, root => {
    bindColors(root, c => { color = c })
    const f = root.querySelector('#ob')
    root.querySelector('#ob-restore').addEventListener('click', () => {
      const acc = parseAccountCode(f.code.value)
      if (!acc) { toast('Yedek kodu geçersiz. Kodun tamamını kopyaladığından emin ol.'); return }
      applyAccount(acc)
      closeModal()
      boot()
      toast(`Tekrar hoş geldin, ${acc.name}!`)
    })
    f.addEventListener('submit', e => {
      e.preventDefault()
      const n = clamp(f.n.value.trim(), 32)
      if (!n) { f.n.focus(); return }
      S.me = {uid: rid(16), name: n, color}
      LS.set('kd_me', S.me)
      closeModal()
      boot()
    })
  })
}
function newServerModal() {
  modal(`<div class="mh"><h2>Sunucunu oluştur</h2><p>Sunucun, sen ve arkadaşlarının takıldığı yer. Kendi sunucunu oluştur ve konuşmaya başla.</p></div>
    <form class="mb" id="ns"><div class="field"><label>Sunucu adı</label><input class="inp" name="n" maxlength="50" required value="${esc(S.me.name)} sunucusu"></div>
    <button class="btn full">Oluştur</button></form>
    <div class="mf" style="justify-content:center"><button class="btn sec" data-act="join-srv">Zaten bir davetin mi var? Sunucuya katıl</button></div>`, root => {
    root.querySelector('#ns').addEventListener('submit', e => {
      e.preventDefault()
      const name = clamp(e.target.n.value.trim(), 50) || 'Sunucu'
      const srv = {
        id: rid(10), key: rid(20), name, owner: S.me.uid, ver: now(), mem: {},
        ch: [{id: rid(6), name: 'genel', type: 'text'}, {id: rid(6), name: 'medya', type: 'text'}, {id: rid(6), name: 'Genel', type: 'voice'}, {id: rid(6), name: 'Oyun', type: 'voice'}]
      }
      S.servers.push(srv)
      saveServers()
      connect(srv)
      closeModal()
      go(srv.id)
      setTimeout(() => inviteModal(srv), 200)
    })
  })
}
function parseInvite(str) {
  str = String(str || '').trim()
  const m = str.match(/(?:[#?&]j=)?([a-z0-9]{6,20})\.([a-z0-9]{12,40})(?:\.([^\s&#]*))?/)
  if (!m) return null
  let name = ''
  try { name = decodeURIComponent(m[3] || '') } catch {}
  return {id: m[1], key: m[2], name: clamp(name, 50)}
}
function joinServer(inv) {
  let srv = srvById(inv.id)
  if (!srv) {
    srv = {id: inv.id, key: inv.key, name: inv.name || 'Yeni Sunucu', owner: '', ver: 0, mem: {}, ch: []}
    S.servers.push(srv)
    saveServers()
    toast('Sunucuya katıldın! Diğer üyeler bulunuyor…')
  }
  connect(srv)
  go(srv.id)
}
function joinServerModal(prefill = '') {
  modal(`<div class="mh"><h2>Bir sunucuya katıl</h2><p>Arkadaşının gönderdiği davet linkini veya kodunu yapıştır.</p></div>
    <form class="mb" id="js"><div class="field"><label>Davet linki veya kodu</label><input class="inp" name="c" required placeholder="https://…#j=abc123.xyz… veya abc123.xyz…" value="${esc(prefill)}"></div>
    <button class="btn full green">Katıl</button></form>`, root => {
    root.querySelector('#js').addEventListener('submit', e => {
      e.preventDefault()
      const inv = parseInvite(e.target.c.value)
      if (!inv) { toast('Geçersiz davet kodu.'); return }
      closeModal()
      joinServer(inv)
    })
  })
}
function inviteCode(srv) { return `${srv.id}.${srv.key}.${encodeURIComponent(srv.name)}` }
function inviteLink(srv) { return location.href.split('#')[0] + '#j=' + inviteCode(srv) }
function inviteModal(srv) {
  const framed = window.top !== window.self
  modal(`<div class="mh"><h2>Arkadaşlarını davet et</h2><p>${esc(srv.name)}</p></div><div class="mb">
    ${framed ? '' : `<div class="field"><label>Davet linki</label><div class="copy"><input class="inp" readonly value="${esc(inviteLink(srv))}"><button class="btn" data-copy="link">Kopyala</button></div></div>`}
    <div class="field"><label>Davet kodu</label><div class="copy"><input class="inp" readonly value="${esc(inviteCode(srv))}"><button class="btn" data-copy="code">Kopyala</button></div>
    <div class="hint">${framed ? 'Arkadaşın bu sayfayı açıp sol taraftaki 🔗 “Sunucuya katıl” butonuna bu kodu yapıştırsın.' : 'Linki açan arkadaşın doğrudan sunucuya katılır. Ya da 🔗 “Sunucuya katıl” butonuna kodu yapıştırabilir.'} Kod, sunucunun şifresidir — yalnızca güvendiğin kişilerle paylaş.</div></div></div>`, root => {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]')
      if (b) copy(b.dataset.copy === 'link' ? inviteLink(srv) : inviteCode(srv))
    })
  })
}
function channelModal(srv, type, ch) {
  modal(`<div class="mh"><h2>${ch ? 'Kanalı düzenle' : type === 'voice' ? 'Ses kanalı oluştur' : 'Metin kanalı oluştur'}</h2></div>
    <form class="mb" id="cf"><div class="field"><label>Kanal adı</label><input class="inp" name="n" maxlength="40" required value="${esc(ch?.name || '')}" placeholder="${type === 'voice' ? 'Sohbet' : 'yeni-kanal'}"></div>
    <div style="display:flex;gap:8px;justify-content:space-between">${ch ? '<button type="button" class="btn red" data-del="1">Kanalı sil</button>' : '<span></span>'}<button class="btn">${ch ? 'Kaydet' : 'Oluştur'}</button></div></form>`, root => {
    const f = root.querySelector('#cf')
    f.addEventListener('submit', e => {
      e.preventDefault()
      let name = clamp(f.n.value.trim(), 40)
      if (!name) return
      if (type === 'text') name = name.toLowerCase().replace(/\s+/g, '-')
      if (ch) ch.name = name
      else srv.ch.push({id: rid(6), name, type})
      pushMeta(srv)
      closeModal()
    })
    root.querySelector('[data-del]')?.addEventListener('click', () => {
      if (!confirm(`“${ch.name}” kanalı herkes için silinsin mi?`)) return
      srv.ch = srv.ch.filter(x => x !== ch)
      if (S.voice?.sid === srv.id && S.voice.cid === ch.id) leaveVoice()
      if (S.view.sid === srv.id && S.view.cid === ch.id) S.view.cid = firstText(srv)
      pushMeta(srv)
      closeModal()
      go(srv.id, S.view.cid)
    })
  })
}
function renameServerModal(srv) {
  modal(`<div class="mh"><h2>Sunucu ayarları</h2></div><form class="mb" id="rs"><div class="field"><label>Sunucu adı</label><input class="inp" name="n" maxlength="50" required value="${esc(srv.name)}"></div><button class="btn full">Kaydet</button></form>`, root => {
    root.querySelector('#rs').addEventListener('submit', e => {
      e.preventDefault()
      srv.name = clamp(e.target.n.value.trim(), 50) || srv.name
      pushMeta(srv)
      closeModal()
    })
  })
}
function leaveServer(srv) {
  if (!confirm(`“${srv.name}” sunucusundan ayrılmak istediğine emin misin? Davet kodun varsa tekrar katılabilirsin.`)) return
  if (S.voice?.sid === srv.id) leaveVoice()
  disconnect(srv.id)
  S.servers = S.servers.filter(s => s !== srv)
  saveServers()
  for (const c of srv.ch) LS.del('kd_m_' + keyOf(srv.id, c.id))
  for (const k of Object.keys(S.unread)) if (k.startsWith(srv.id + '|')) delete S.unread[k]
  go(null, null)
}

const keyName = code => !code ? '—' : code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Ok ').replace('Backquote', '`')
async function settingsModal(tab = 'profile') {
  const s = S.settings
  let devs = []
  try { devs = await navigator.mediaDevices.enumerateDevices() } catch {}
  const opts = (kind, sel) => '<option value="">Varsayılan</option>' + devs.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default').map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === sel ? ' selected' : ''}>${esc(d.label || (kind === 'audioinput' ? 'Mikrofon ' : 'Kamera ') + (i + 1))}</option>`).join('')
  const sw = (name, on, label) => `<label class="row"><span>${label}</span><span class="sw"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><i></i></span></label>`
  let color = S.me.color
  modal(`<div class="mh"><h2>Ayarlar</h2></div><div class="mb">
    <div class="tabs"><button data-tab="profile">Profil</button><button data-tab="voice">Ses</button><button data-tab="video">Görüntü</button><button data-tab="notif">Bildirimler</button><button data-tab="about">Hakkında</button></div>
    <form id="st">
      <div data-pane="profile">
        <div class="field"><label>Kullanıcı adı</label><input class="inp" name="name" maxlength="32" value="${esc(S.me.name)}"></div>
        <div class="field"><label>Renk</label>${colorPicker(color)}</div>
        <div class="field"><label>Hesap yedeği</label>
          <div class="hint" style="margin:0 0 8px">Hesabın bu bilgisayarda kalıcı olarak saklanır. Başka bir bilgisayara veya tarayıcıya taşımak için bu kodu orada “Başka bir bilgisayarda hesabın mı var?” bölümüne yapıştır. Kod şifre gibidir, kimseyle paylaşma.</div>
          <div class="copy"><input class="inp" readonly id="acc-code"><button type="button" class="btn" id="acc-copy">Kopyala</button></div>
          <div class="copy" style="margin-top:8px"><input class="inp" id="acc-in" placeholder="Başka cihazdan gelen yedek kodu"><button type="button" class="btn sec" id="acc-load" style="border:1px solid var(--line)">Yükle</button></div>
        </div>
        <button type="button" class="btn green" id="inst">💻 Uygulamayı bilgisayara yükle</button>
      </div>
      <div data-pane="voice">
        <div class="field"><label>Mikrofon</label><select class="inp" name="mic">${opts('audioinput', s.mic)}</select></div>
        <div class="field"><label>Giriş hassasiyeti (konuşma algılama eşiği)</label><input type="range" name="sens" min="2" max="40" value="${s.sens}"><div class="meter"><i id="lvl"></i></div><div class="hint" id="lvlhint">${S.voice?.mic ? 'Konuştuğunda çubuk yeşil çizgiyi geçmeli.' : 'Seviyeyi görmek için bir ses kanalına katıl.'}</div></div>
        ${sw('ns', s.ns, 'Gürültü engelleme')}${sw('ec', s.ec, 'Yankı engelleme')}${sw('agc', s.agc, 'Otomatik ses seviyesi')}
        ${sw('ptt', s.ptt, 'Bas-konuş (Push-to-talk)')}
        <div class="row"><span>Bas-konuş tuşu</span><button type="button" class="btn sec" id="pttk" style="border:1px solid var(--line)">${esc(keyName(s.pttKey))}</button></div>
        ${sw('sounds', s.sounds, 'Giriş/çıkış sesleri')}
      </div>
      <div data-pane="video">
        <div class="field"><label>Kamera</label><select class="inp" name="cam">${opts('videoinput', s.cam)}</select></div>
        <div class="field"><label>Kamera kalitesi</label><select class="inp" name="vq">
          <option value="low"${s.vq === 'low' ? ' selected' : ''}>Düşük: en az CPU/internet (180p 15 FPS)</option>
          <option value="med"${s.vq === 'med' ? ' selected' : ''}>Dengeli, önerilen (360p 24 FPS)</option>
          <option value="high"${s.vq === 'high' ? ' selected' : ''}>Yüksek (720p 30 FPS)</option></select></div>
        <div class="hint">Ekran paylaşım kalitesi (çözünürlük, 120 FPS'e kadar kare hızı, içerik türü) paylaşımı başlatırken seçilir.</div>
      </div>
      <div data-pane="notif">
        ${sw('notif', s.notif, 'Masaüstü bildirimleri (DM ve @bahsetmeler)')}
        ${sw('members', s.members, 'Üye listesini göster')}
      </div>
      <div data-pane="about"><p class="hint" style="font-size:14px">Kanka Chat tamamen tarayıcında çalışır. Sunucu yoktur: mesajlar, ses ve görüntü doğrudan cihazlar arasında (WebRTC) uçtan uca şifreli gider. Mesaj geçmişi her kullanıcının tarayıcısında saklanır ve çevrimiçi olan üyeler arasında eşitlenir.</p>
      <p class="hint">Kimliğin: <code>${esc(S.me.uid)}</code></p>
      <button type="button" class="btn red" id="wipe">Tüm yerel verileri sil</button></div>
    </form></div>
    <div class="mf"><button class="btn sec" data-close="1">Kapat</button><button class="btn" id="save">Kaydet</button></div>`, root => {
    const f = root.querySelector('#st')
    const show = t => {
      root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t })
      root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t))
    }
    show(tab)
    root.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab) })
    bindColors(root, c => { color = c })
    let pttKey = s.pttKey
    const kb = root.querySelector('#pttk')
    kb.addEventListener('click', () => {
      kb.textContent = 'Bir tuşa bas…'
      const h = e => { e.preventDefault(); pttKey = e.code; kb.textContent = keyName(pttKey); removeEventListener('keydown', h, true) }
      addEventListener('keydown', h, true)
    })
    const lvl = root.querySelector('#lvl'), sens = f.sens
    const iv = setInterval(() => {
      const l = S.level || 0
      lvl.style.width = Math.min(100, l / 40 * 100) + '%'
      lvl.style.background = l > +sens.value ? 'var(--green)' : 'var(--yellow)'
    }, 100)
    S.modalCleanup = () => clearInterval(iv)
    sens.addEventListener('input', () => { s.sens = +sens.value })
    root.querySelector('[data-close]').addEventListener('click', closeModal)
    root.querySelector('#acc-code').value = accountCode()
    root.querySelector('#acc-copy').addEventListener('click', () => copy(accountCode()))
    const inst = root.querySelector('#inst')
    inst.hidden = matchMedia('(display-mode: standalone)').matches
    inst.addEventListener('click', installApp)
    root.querySelector('#acc-load').addEventListener('click', () => {
      const acc = parseAccountCode(root.querySelector('#acc-in').value)
      if (!acc) { toast('Yedek kodu geçersiz.'); return }
      if (acc.uid !== S.me.uid && !confirm(`Bu bilgisayardaki hesap “${acc.name}” hesabıyla değiştirilsin mi? Sunucuların korunur ve yenileri eklenir.`)) return
      applyAccount(acc)
      flushSave()
      location.reload()
    })
    root.querySelector('#wipe').addEventListener('click', () => {
      if (!confirm('Tüm sunucular, mesajlar ve profilin bu tarayıcıdan silinsin mi?')) return
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('kd_')) localStorage.removeItem(k) } catch {}
      location.reload()
    })
    root.querySelector('#save').addEventListener('click', async () => {
      const prevAudio = [s.mic, s.ns, s.ec, s.agc].join()
      const name = clamp(f.name.value.trim(), 32)
      const profChanged = (name && name !== S.me.name) || color !== S.me.color
      if (name) S.me.name = name
      S.me.color = color
      LS.set('kd_me', S.me)
      Object.assign(s, {
        mic: f.mic.value, cam: f.cam.value, sens: +f.sens.value, ns: f.ns.checked, ec: f.ec.checked, agc: f.agc.checked,
        ptt: f.ptt.checked, pttKey, sounds: f.sounds.checked, vq: f.vq.value, notif: f.notif.checked, members: f.members.checked
      })
      saveSettings()
      if (s.notif && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
      if (profChanged) for (const c of Object.values(S.conns)) c.a.hello.send(helloData(c.sid))
      if (S.voice && prevAudio !== [s.mic, s.ns, s.ec, s.agc].join()) await restartMic()
      applyMic()
      if (S.voice) for (const pid of voicePeers()) tune(pid)
      closeModal()
      invAll()
      toast('Ayarlar kaydedildi.')
    })
  })
}
async function restartMic() {
  const v = S.voice
  if (!v) return
  let mic
  try { mic = await getMic() } catch (e) { toast('Mikrofon değiştirilemedi: ' + (e.name || e.message)); return }
  const old = v.mic
  const c = S.conns[v.sid]
  if (old && c) {
    const ot = old.getAudioTracks()[0], nt = mic.getAudioTracks()[0]
    for (const pid of Object.keys(v.sent)) {
      if (v.sent[pid].mic === old) {
        try { c.room.replaceTrack(ot, nt, {target: pid}) } catch {}
      }
    }
    // replaceTrack akışı değiştirmez; eşlemeyi koru
    old.removeTrack?.(ot)
    old.addTrack?.(nt)
    ot.stop()
    mic.getTracks().forEach(t => { if (t !== nt) t.stop() })
  } else {
    v.mic = mic
    syncAllMedia()
  }
  applyMic()
  startVad()
}

function profilePop(uid, anchor) {
  const isMe = uid === S.me.uid
  const u = isMe ? {n: S.me.name, c: S.me.color} : knownUser(uid)
  const on = isMe || !!onlineUser(uid)
  const vpid = !isMe && S.voice ? voicePeers().find(pid => S.conns[S.voice.sid].peers[pid].uid === uid) : null
  const inVoice = !!vpid
  const streaming = inVoice && S.voice.watching.has(vpid)
  pop(`<div class="prof"><div class="ph">${avatar(u.n, u.c, 's80', `<span class="dot${on ? '' : ' off'}"></span>`)}<div class="pn">${esc(u.n)}</div><div class="uid">${on ? 'Çevrimiçi' : 'Çevrimdışı'}</div></div>
    ${inVoice ? `<div style="padding:0 8px 8px"><div class="lbl2">Kullanıcı ses seviyesi</div><input type="range" min="0" max="100" value="${Math.round(volOf(uid) * 100)}" data-vol="${esc(uid)}"></div>` : ''}
    ${streaming ? `<div style="padding:0 8px 8px"><div class="lbl2">Yayın (oyun) ses seviyesi</div><input type="range" min="0" max="100" value="${Math.round(svolOf(uid) * 100)}" data-svol="1"></div>` : ''}
    <div class="menu">${isMe ? '<button data-act="settings">Profili düzenle</button>' : `<button data-act="dm" data-uid="${esc(uid)}">Mesaj gönder</button>`}</div></div>`, anchor)
  const r = $('#pop input[data-vol]')
  r?.addEventListener('input', () => { S.vol[uid] = r.value / 100; LS.set('kd_vol', S.vol); applyAudio() })
  const sr = $('#pop input[data-svol]')
  sr?.addEventListener('input', () => { S.svol[uid] = sr.value / 100; LS.set('kd_svol', S.svol); applyAudio() })
}
function emojiPop(anchor, cb) {
  pop(`<div class="emojis">${EMOJI.map(e => `<button data-emo="${e}">${e}</button>`).join('')}</div>`, anchor)
  S.emojiCb = cb
}

// ======================= düzenleme / yanıt =======================
function setReply(r) {
  S.reply = r
  const bar = $('#replybar')
  if (!r) { bar.hidden = true; bar.innerHTML = ''; return }
  bar.hidden = false
  bar.innerHTML = `<span><b>${esc(r.n)}</b> kişisine yanıt veriliyor</span><button data-act="cancel-reply" title="İptal">✕</button>`
  $('#input').focus()
}
function startEdit(id) {
  const key = curKey()
  const m = msgs(key)[findIdx(msgs(key), id)]
  const el = document.getElementById('m-' + id)
  if (!m || !el) return
  $$('.msg.editing').forEach(x => { x.classList.remove('editing'); x.querySelector('.editbox')?.remove() })
  S.editing = id
  el.classList.add('editing')
  const box = document.createElement('div')
  box.className = 'editbox'
  box.innerHTML = '<textarea rows="2" maxlength="4000"></textarea><small>Kaydetmek için Enter • İptal için Esc</small>'
  const ta = box.firstChild
  ta.value = m.x
  el.querySelector('.tx')?.after(box) || el.appendChild(box)
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { S.editing = null; refreshMsg(id) }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const x = clamp(ta.value.trim(), 4000)
      S.editing = null
      if (!x && !m.img && !m.f) { refreshMsg(id); return }
      if (x === m.x) { refreshMsg(id); return }
      updateMsg(key, id, mm => { mm.x = x; mm.ed = now() })
    }
  })
}

// ======================= olaylar =======================
function onClick(e) {
  const t = e.target.closest('[data-act]')
  if (document.body.classList.contains('nav-open') && !e.target.closest('#rail,#side,#menu-btn')) { document.body.classList.remove('nav-open'); return }
  const p = $('#pop')
  if (!p.hidden && !e.target.closest('#pop') && !(t && t.dataset.act === 'react-pick')) closePop()
  const emo = e.target.closest('[data-emo]')
  if (emo) { S.emojiCb?.(emo.dataset.emo); closePop(); return }
  if (e.target.id === 'overlay') { closeModal(); return }
  if (!t) return
  const act = t.dataset.act
  const msgEl = t.closest('.msg')
  const mid = msgEl?.dataset.id
  switch (act) {
    case 'home': go(null, S.dms[0] || null); break
    case 'srv': go(t.dataset.sid); break
    case 'new-srv': newServerModal(); break
    case 'install': installApp(); break
    case 'join-srv': joinServerModal(); break
    case 'ch': if (!e.target.closest('[data-act="ch-menu"]')) go(S.view.sid, t.dataset.cid); break
    case 'ch-menu': {
      e.stopPropagation()
      const srv = srvById(S.view.sid)
      const ch = srv?.ch.find(c => c.id === t.dataset.cid)
      if (ch) channelModal(srv, ch.type, ch)
      break
    }
    case 'vch': {
      if (e.target.closest('[data-act="ch-menu"]')) break
      const sid = t.dataset.sid || S.view.sid
      const cid = t.dataset.cid
      if (S.voice && S.voice.sid === sid && S.voice.cid === cid) openStage(); else joinVoice(sid, cid)
      break
    }
    case 'new-ch': { const srv = srvById(S.view.sid); if (srv) channelModal(srv, t.dataset.type); break }
    case 'srv-menu': {
      const srv = srvById(S.view.sid)
      if (!srv) break
      pop(`<div class="menu" style="width:200px"><button data-act="invite">👤＋ Davet et</button><button data-act="new-ch" data-type="text"># Metin kanalı oluştur</button><button data-act="new-ch" data-type="voice">🔊 Ses kanalı oluştur</button><button data-act="rename-srv">⚙️ Sunucu ayarları</button><button data-act="leave-srv" class="danger">🚪 Sunucudan ayrıl</button></div>`, t)
      return
    }
    case 'invite': { const srv = srvById(S.view.sid); if (srv) inviteModal(srv); break }
    case 'rename-srv': { const srv = srvById(S.view.sid); if (srv) renameServerModal(srv); break }
    case 'leave-srv': { const srv = srvById(S.view.sid); if (srv) leaveServer(srv); break }
    case 'dm': {
      const uid = t.dataset.uid
      if (!uid || uid === S.me.uid) break
      closePop()
      touchDm(uid)
      go(null, uid)
      break
    }
    case 'prof': profilePop(t.dataset.uid, t); return
    case 'settings': closePop(); settingsModal(t.dataset.tab === 'video' ? 'video' : 'profile'); break
    case 'mute': setMute(!S.st.m); break
    case 'deafen': setDeaf(!S.st.d); break
    case 'leave-voice': leaveVoice(); break
    case 'cam': toggleCam(); break
    case 'screen': goLiveModal(); break
    case 'unwatch': { e.stopPropagation(); const k = t.closest('.tile')?.dataset.key; if (k) setWatching(k.slice(0, -2), false); break }
    case 'pip': {
      e.stopPropagation()
      const vid = t.closest('.tile')?.querySelector('video')
      if (vid) (document.pictureInPictureElement === vid ? document.exitPictureInPicture() : vid.requestPictureInPicture()).catch(() => toast('Resim içinde resim açılamadı.'))
      break
    }
    case 'watch': e.stopPropagation(); setWatching(t.dataset.pid, true); break
    case 'tile': {
      const key = t.dataset.key
      if (e.target.closest('[data-act="watch"],[data-act="fs"]')) break
      S.focus = S.focus === key ? null : key
      inv('stage')
      break
    }
    case 'fs': {
      e.stopPropagation()
      const tile = t.closest('.tile')
      if (document.fullscreenElement) document.exitFullscreen?.(); else tile?.requestFullscreen?.().catch(() => {})
      break
    }
    case 'toggle-members':
      if (matchMedia('(max-width:860px)').matches) S.mobileMembers = !S.mobileMembers
      else { S.settings.members = !S.settings.members; saveSettings() }
      inv('members')
      break
    case 'nav': document.body.classList.toggle('nav-open'); break
    case 'more': { const k = curKey(); S.lim[k] = (S.lim[k] || PAGE) + PAGE; renderMsgs(true); break }
    case 'attach': $('#file').click(); break
    case 'emoji': emojiPop(t, emo => { const i = $('#input'); const s = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, s) + emo + i.value.slice(i.selectionEnd ?? s); i.focus(); i.selectionStart = i.selectionEnd = s + emo.length; autoGrow() }); return
    case 'react-pick': emojiPop(t, emo => toggleReact(mid, emo)); return
    case 'react': toggleReact(mid, t.dataset.e); break
    case 'reply': {
      const m = msgs(curKey())[findIdx(msgs(curKey()), mid)]
      if (m) setReply({id: m.id, n: m.n, x: clamp(m.x || (m.img || m.hasImg ? '🖼️ Resim' : m.f ? '📄 ' + m.f.name : ''), 120)})
      break
    }
    case 'cancel-reply': setReply(null); break
    case 'edit': startEdit(mid); break
    case 'del':
      if (confirm('Bu mesaj herkes için silinsin mi?')) updateMsg(curKey(), mid, m => { m.del = 1; m.x = ''; m.img = null; delete m.hasImg; delete m.f; delete m.r })
      break
    case 'jump': {
      const el = document.getElementById('m-' + t.dataset.to)
      if (el) { el.scrollIntoView({block: 'center', behavior: 'smooth'}); el.animate([{background: 'rgba(88,101,242,.3)'}, {background: 'transparent'}], 1500) }
      break
    }
    case 'zoom': {
      const o = $('#overlay')
      o.innerHTML = ''
      const img = document.createElement('img')
      img.className = 'lightbox'
      img.src = t.src
      o.appendChild(img)
      o.hidden = false
      img.addEventListener('click', closeModal)
      break
    }
    case 'spoiler': t.classList.add('show'); break
  }
}
function autoGrow() {
  const i = $('#input')
  i.style.height = 'auto'
  i.style.height = Math.min(i.scrollHeight, innerHeight * 0.4) + 'px'
}
function submit() {
  const i = $('#input')
  const x = clamp(i.value.trim(), 4000)
  if (!x || !curKey()) return
  i.value = ''
  autoGrow()
  postMsg(newMsg({x}))
}
function bind() {
  document.addEventListener('click', onClick)
  const i = $('#input')
  i.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
    else if (e.key === 'Escape' && S.reply) setReply(null)
    else if (e.key === 'ArrowUp' && !i.value) {
      const arr = msgs(curKey() || '')
      for (let k = arr.length - 1; k >= 0 && k > arr.length - 50; k--) if (arr[k].uid === S.me.uid && !arr[k].del && arr[k].x) { e.preventDefault(); startEdit(arr[k].id); break }
    }
  })
  i.addEventListener('input', () => { autoGrow(); if (i.value) sendTyping() })
  i.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) { e.preventDefault(); sendFiles(files) }
  })
  $('#file').addEventListener('change', e => { sendFiles([...e.target.files]); e.target.value = '' })
  let dragN = 0
  addEventListener('dragenter', e => { if (curKey() && e.dataTransfer?.types.includes('Files')) { dragN++; document.body.classList.add('dragging') } })
  addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging') } })
  addEventListener('dragover', e => e.preventDefault())
  addEventListener('drop', e => {
    e.preventDefault()
    dragN = 0
    document.body.classList.remove('dragging')
    if (e.dataTransfer?.files.length && curKey()) sendFiles([...e.dataTransfer.files])
  })
  // Resimler yüklendiğinde alta yapışık kal
  $('#msgs').addEventListener('load', e => {
    if (e.target.tagName === 'IMG') { const b = $('#msgs'); if (b.scrollHeight - b.scrollTop - b.clientHeight < 400) scrollBottom() }
  }, true)
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePop(); closeModal() }
    if (S.settings.ptt && S.voice && e.code === S.settings.pttKey && !e.repeat && !isTyping(e)) { S.pttDown = true; applyMic() }
  })
  addEventListener('keyup', e => {
    if (S.settings.ptt && e.code === S.settings.pttKey) { S.pttDown = false; applyMic() }
  })
  addEventListener('blur', () => { if (S.pttDown) { S.pttDown = false; applyMic() } })
  addEventListener('resize', () => inv('stage'))
  document.addEventListener('fullscreenchange', updateWatchLevels)
  document.addEventListener('enterpictureinpicture', updateWatchLevels, true)
  document.addEventListener('leavepictureinpicture', () => { if (!S.showStage) clearStage(); else updateWatchLevels() }, true)
  document.addEventListener('visibilitychange', () => {
    updateWatchLevels()
    if (!document.hidden) {
      const k = curKey()
      if (k && S.unread[k]) { delete S.unread[k]; inv('rail', 'side') }
    }
  })
  addEventListener('pagehide', () => {
    flushSave()
    saveServers()
    for (const c of Object.values(S.conns)) try { c.room.leave() } catch {}
  })
  addEventListener('hashchange', checkHashInvite)
}
const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
function checkHashInvite() {
  const h = location.hash
  if (!h.includes('j=')) return
  const inv = parseInvite(h)
  history.replaceState(null, '', location.pathname + location.search)
  if (inv && S.me) joinServer(inv)
}

// ======================= hesabın kalıcılığı =======================
// Hesap (kimlik, ad, sunucular) üç yerde tutulur: localStorage, IndexedDB ve çerez.
// Biri silinse bile diğerinden geri yüklenir. Yedek koduyla başka cihaza da taşınabilir.
// (Durum fonksiyon özelliklerinde tutulur: LS.set modül yüklenirken de güvenle çağrılabilsin)
function idb() {
  if (!idb.p) {
    idb.p = new Promise(res => {
      try {
        const r = indexedDB.open('kanka-chat', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('kv')
        r.onsuccess = () => res(r.result)
        r.onerror = () => res(null)
      } catch { res(null) }
    })
  }
  return idb.p
}
function mirror(k, v) {
  idb().then(db => { try { db?.transaction('kv', 'readwrite').objectStore('kv').put(v, k) } catch {} })
  if (k === 'kd_me' || k === 'kd_servers') { clearTimeout(mirror.t); mirror.t = setTimeout(writeAccCookie, 500) }
}
function idbAll() {
  return idb().then(db => new Promise(res => {
    const out = {}
    if (!db) return res(out)
    try {
      const req = db.transaction('kv').objectStore('kv').openCursor()
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue() } else res(out) }
      req.onerror = () => res(out)
    } catch { res(out) }
  }))
}
const b64e = str => { let b = ''; for (const x of new TextEncoder().encode(str)) b += String.fromCharCode(x); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const b64d = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))
function accountCode(maxLen = Infinity) {
  const d = {u: S.me.uid, n: S.me.name, c: S.me.color, s: S.servers.map(x => [x.id, x.key, x.name])}
  let code = 'KANKA1-' + b64e(JSON.stringify(d))
  while (code.length > maxLen && d.s.length) { d.s.pop(); code = 'KANKA1-' + b64e(JSON.stringify(d)) }
  return code
}
function parseAccountCode(str) {
  const m = String(str || '').match(/KANKA1-([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    const d = JSON.parse(b64d(m[1]))
    if (typeof d.u !== 'string' || !/^[a-z0-9]{8,40}$/.test(d.u)) return null
    return {
      uid: d.u, name: clamp(d.n, 32) || 'Kanka', color: isColor(d.c) ? d.c : COLORS[0],
      servers: (Array.isArray(d.s) ? d.s : []).filter(x => Array.isArray(x) && /^[a-z0-9]{6,20}$/.test(x[0]) && /^[a-z0-9]{12,40}$/.test(x[1])).slice(0, 100)
    }
  } catch { return null }
}
function applyAccount(acc) {
  S.me = {uid: acc.uid, name: acc.name, color: acc.color}
  LS.set('kd_me', S.me)
  for (const [id, key, name] of acc.servers) {
    if (!srvById(id)) S.servers.push({id, key, name: clamp(name, 50) || 'Sunucu', owner: '', ver: 0, mem: {}, ch: []})
  }
  saveServers()
}
function writeAccCookie() {
  if (!S.me) return
  try { document.cookie = `kd_acc=${accountCode(3500)}; max-age=${400 * 86400}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}` } catch {}
}
function readAccCookie() {
  try { const m = document.cookie.match(/(?:^|;\s*)kd_acc=([^;]+)/); return m ? parseAccountCode(m[1]) : null } catch { return null }
}
async function restoreAccount() {
  const all = await idbAll()
  if (all.kd_me && typeof all.kd_me.uid === 'string') {
    for (const k of MIRROR) if (all[k] != null) { try { localStorage.setItem(k, JSON.stringify(all[k])) } catch {} }
    S.me = all.kd_me
    if (Array.isArray(all.kd_servers)) S.servers = all.kd_servers
    if (all.kd_set) Object.assign(S.settings, all.kd_set)
    if (Array.isArray(all.kd_dms)) S.dms = all.kd_dms
    if (all.kd_vol) S.vol = all.kd_vol
    if (all.kd_svol) S.svol = all.kd_svol
    if (all.kd_lastch) S.lastCh = all.kd_lastch
    return true
  }
  const acc = readAccCookie()
  if (acc) { applyAccount(acc); return true }
  return false
}
function persistAll() {
  // Tarayıcıdan bu sitenin verilerini kendiliğinden silmemesini iste
  navigator.storage?.persist?.().catch(() => {})
  for (const k of MIRROR) { const v = LS.get(k, null); if (v != null) mirror(k, v) }
}
// Bilgisayara uygulama olarak yükleme (kurulan uygulamaların verisi kalıcı tutulur)
let installEvt = null
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; inv('rail') })
addEventListener('appinstalled', () => { installEvt = null; toast('Kanka Chat bilgisayarına yüklendi; masaüstünden veya başlat menüsünden açabilirsin.'); inv('rail') })
async function installApp() {
  if (!installEvt) { toast('Tarayıcının adres çubuğundaki “Yükle” simgesinden veya menüsünden “Uygulamayı yükle”yi seçebilirsin.'); return }
  const e = installEvt
  installEvt = null
  e.prompt()
  try { await e.userChoice } catch {}
  inv('rail')
}

// ======================= başlangıç =======================
function boot() {
  persistAll()
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {})
  // Donanım codec'lerini tespit et, sonra eşlere bildir
  probeCodecs().then(() => { for (const c of Object.values(S.conns)) c.a.hello.send(helloData(c.sid)) })
  for (const s of S.servers) connect(s)
  if (location.hash.includes('j=')) checkHashInvite()
  else if (S.view.sid && !srvById(S.view.sid)) S.view = {sid: null, cid: null}
  if (!S.view.sid && !S.view.cid && S.servers.length && !location.hash) S.view = {sid: S.servers[0].id, cid: null}
  go(S.view.sid, S.view.cid)
  // Bağlantılar periyodik olarak durum bildirsin: yeni katılan / kaçırılan güncellemeler için
  setInterval(() => {
    if (S.voice) sendState()
    inv('head')
  }, 15000)
}
bind()
;(async () => {
  // localStorage silinmişse hesabı IndexedDB'den veya çerezden geri getir
  if (!S.me) await restoreAccount()
  if (!S.me) onboarding(); else boot()
})()
