// Medya ince ayarları: donanım codec seçimi, SDP iyileştirmeleri,
// ekran yayını bit hızı planı ve canlı yayın istatistikleri.

export const CODECS = ['video/AV1', 'video/VP9', 'video/H264', 'video/VP8']
// Yazılımla çözmesi en ucuzdan en pahalıya
const SW_DECODE_ORDER = ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1']
const CODEC_EFF = {'video/AV1': 0.65, 'video/VP9': 0.75, 'video/H264': 1, 'video/VP8': 1.1}
const FORCE = (new URLSearchParams(location.search).get('codec') || '').toUpperCase()

// Bu cihazda donanım (GPU) ile kodlanabilen / çözülebilen codec'ler
export const HW = {enc: [], dec: [], ready: false}

export async function probeCodecs() {
  const mc = navigator.mediaCapabilities
  if (mc?.encodingInfo) {
    const cfg = contentType => ({type: 'webrtc', video: {contentType, width: 1920, height: 1080, bitrate: 8e6, framerate: 60}})
    await Promise.all(CODECS.map(async mime => {
      try { const r = await mc.encodingInfo(cfg(mime)); if (r.supported && r.powerEfficient) HW.enc.push(mime) } catch {}
      try { const r = await mc.decodingInfo(cfg(mime)); if (r.supported && r.powerEfficient) HW.dec.push(mime) } catch {}
    }))
    const byOrder = (a, b) => CODECS.indexOf(a) - CODECS.indexOf(b)
    HW.enc.sort(byOrder)
    HW.dec.sort(byOrder)
  }
  HW.ready = true
}

let sendCaps = null
const canSend = mime => {
  try { sendCaps ||= RTCRtpSender.getCapabilities('video')?.codecs || [] } catch { sendCaps = [] }
  return sendCaps.some(c => c.mimeType.toLowerCase() === mime.toLowerCase())
}

// Karşı tarafın donanımla çözebildiği codec listesine göre en verimli codec'i seç.
// null: tarayıcının varsayılanı.
export function pickCodec(remoteDec) {
  if (FORCE && canSend('video/' + FORCE)) return 'video/' + FORCE
  const enc = HW.enc.filter(canSend)
  if (Array.isArray(remoteDec)) {
    for (const m of enc) if (remoteDec.includes(m)) return m
    for (const m of SW_DECODE_ORDER) if (enc.includes(m)) return m
    return null
  }
  return enc[0] || null
}
export const isHwCodec = mime => !!mime && HW.enc.includes(mime)

function prefsFor(mime) {
  const all = RTCRtpReceiver.getCapabilities('video')?.codecs || []
  const first = all.filter(c => c.mimeType.toLowerCase() === mime.toLowerCase())
  if (!first.length) return null
  return [...first, ...all.filter(c => !first.includes(c))]
}

// Opus'u stereo ve yüksek bit hızına aç (oyun/müzik sesi için), video için
// yüksek başlangıç bit hızı ver (yayın ilk saniyelerde bulanık başlamasın).
export function mungeSdp(sdp) {
  if (!sdp) return sdp
  const lines = sdp.split('\r\n')
  const opus = new Set(), vids = new Set(), hasFmtp = new Set()
  for (const l of lines) {
    let m = l.match(/^a=rtpmap:(\d+) opus\/48000/i)
    if (m) opus.add(m[1])
    m = l.match(/^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i)
    if (m) vids.add(m[1])
    m = l.match(/^a=fmtp:(\d+) /)
    if (m) hasFmtp.add(m[1])
  }
  const out = []
  for (let l of lines) {
    const f = l.match(/^a=fmtp:(\d+) (.*)$/)
    if (f) {
      let params = f[2]
      if (opus.has(f[1])) {
        if (!/stereo=/.test(params)) params += ';stereo=1;sprop-stereo=1'
        if (!/maxaveragebitrate=/.test(params)) params += ';maxaveragebitrate=192000'
      } else if (vids.has(f[1]) && !/x-google-start-bitrate/.test(params)) {
        params += ';x-google-start-bitrate=2000'
      }
      l = `a=fmtp:${f[1]} ${params}`
    }
    out.push(l)
    const r = l.match(/^a=rtpmap:(\d+) /)
    if (r && vids.has(r[1]) && !hasFmtp.has(r[1])) out.push(`a=fmtp:${r[1]} x-google-start-bitrate=2000`)
  }
  return out.join('\r\n')
}

// trystero'ya verilen RTCPeerConnection: video izine codec tercihi uygular ve
// yerel SDP'yi iyileştirir. Herhangi bir adım başarısız olursa varsayılan davranışa döner.
export function makeTunedPC(remoteDecFor) {
  const Native = window.RTCPeerConnection
  if (!Native) return undefined
  return class TunedPC extends Native {
    addTrack(track, ...streams) {
      const sender = super.addTrack(track, ...streams)
      if (track.kind === 'video') {
        try {
          const mime = pickCodec(remoteDecFor(this))
          const tr = this.getTransceivers().find(t => t.sender === sender)
          const prefs = mime && prefsFor(mime)
          if (prefs && tr?.setCodecPreferences) tr.setCodecPreferences(prefs)
        } catch {}
      }
      return sender
    }
    async setLocalDescription(desc) {
      if (desc && desc.type === 'rollback') return super.setLocalDescription(desc)
      let d = desc
      try {
        if (!d) d = /^have-(remote-offer|local-pranswer)$/.test(this.signalingState) ? await this.createAnswer() : await this.createOffer()
        return await super.setLocalDescription({type: d.type, sdp: mungeSdp(d.sdp)})
      } catch (e) {
        if (this.signalingState === 'closed') throw e
        return super.setLocalDescription(desc)
      }
    }
  }
}

// Ekran yayını için hedef bit hızı (çözünürlük, kare hızı, codec verimliliği ve içerik türüne göre)
export function screenBitrate(w, h, fps, mime, motion) {
  const px = Math.max(0.05, (w * h) / (1920 * 1080))
  const br = 4.5e6 * Math.pow(Math.max(5, fps) / 30, 0.6) * Math.pow(px, 0.75) * (motion ? 1.25 : 1) * (CODEC_EFF[mime] || 1)
  return Math.round(Math.min(30e6, Math.max(300e3, br)))
}

// Bir izin anlık video istatistikleri: çözünürlük, FPS, codec, bit hızı, donanım kullanımı, kısıt nedeni
const prev = new WeakMap()
export async function videoStats(pc, track, dir) {
  if (!pc || !track) return null
  let rep
  try { rep = await pc.getStats(track) } catch { return null }
  const type = dir === 'in' ? 'inbound-rtp' : 'outbound-rtp'
  let rtp = null
  const codecs = {}
  rep.forEach(s => {
    if (s.type === type && s.kind === 'video') rtp = s
    else if (s.type === 'codec') codecs[s.id] = s
  })
  if (!rtp) return null
  const bytes = dir === 'in' ? rtp.bytesReceived : rtp.bytesSent
  const map = prev.get(pc) || new Map()
  prev.set(pc, map)
  const last = map.get(rtp.id)
  map.set(rtp.id, {bytes, ts: rtp.timestamp})
  const br = last && rtp.timestamp > last.ts ? ((bytes - last.bytes) * 8) / ((rtp.timestamp - last.ts) / 1000) : 0
  return {
    w: rtp.frameWidth || 0,
    h: rtp.frameHeight || 0,
    fps: Math.round(rtp.framesPerSecond || 0),
    codec: (codecs[rtp.codecId]?.mimeType || '').split('/')[1] || '',
    br,
    hw: dir === 'in' ? rtp.powerEfficientDecoder : rtp.powerEfficientEncoder,
    lim: rtp.qualityLimitationReason || 'none',
    active: rtp.active !== false
  }
}
