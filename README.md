# Kanka Chat

**👉 Uygulamayı aç: https://aliaskin.github.io/konu-mauygulamas-/**

Tarayıcıda çalışan, Discord benzeri bir sohbet uygulaması. Kurulum, hesap ya da sunucu gerektirmez.
Mesajlar, ses ve görüntü doğrudan arkadaşlarının cihazlarına (P2P, WebRTC) uçtan uca şifreli gider.

## Özellikler

- **Sunucular ve kanallar**: sunucu oluştur, davet linki/kodu ile arkadaş ekle, metin ve ses kanalları aç, düzenle, sil
- **Yazılı sohbet**: markdown (`**kalın**`, `*italik*`, `` `kod` ``, ```` ``` ```` blokları, `||spoiler||`), @bahsetme, yanıtlama,
  düzenleme (↑ tuşu), silme, emoji tepkileri, “yazıyor…” göstergesi, okunmamış rozetleri
- **Resim ve dosya paylaşımı**: yapıştır, sürükle-bırak veya ＋ butonu (resimler otomatik sıkıştırılır, dosyalar 100 MB'a kadar)
- **Direkt mesajlar (DM)**: üye listesinde birine tıkla → “Mesaj gönder”
- **Sesli sohbet**: gürültü/yankı engelleme, konuşan kişinin yeşil çerçevesi, sustur/sağırlaştır, bas-konuş (push-to-talk),
  kişi başı ses seviyesi, giriş hassasiyeti
- **Görüntülü sohbet**: kamera aç/kapa, tıkla büyüt, tam ekran
- **Ekran paylaşımı**: 720p / 1080p / 1440p, 30 / 60 / **120 FPS**, “Oyun/Video” (akıcılık) veya “Yazı/Kod” (netlik) modu,
  stereo ve yüksek kaliteli bilgisayar sesi, yayın sırasında kesintisiz kalite değiştirme, tam ekran ve resim içinde resim,
  kutucukta canlı kalite göstergesi (çözünürlük · FPS · codec · bit hızı)
- Mobil uyumlu arayüz

## Performans (PC'yi yormaması için)

- Framework yok: saf JavaScript, tek dosya (~155 KB), boşta neredeyse sıfır CPU
- **Donanım kodlama**: tarayıcıya hangi codec'leri ekran kartıyla kodlayıp çözebildiği sorulur (AV1 › VP9 › H.264);
  yayın, hem yayıncının GPU'suyla kodlanabilen hem de izleyicinin GPU'suyla çözülebilen codec ile gönderilir
- Ekran yayını yalnızca **“Yayını İzle”ye basan** kişilere gönderilir (Discord gibi); kimse izlemiyorsa hiç kodlama yapılmaz
- **İzleyiciye göre kalite**: yayın büyük/tam ekransa tam kalite, ızgarada orta boy kutucuksa 720p/60, küçükse 360p/30,
  alt şeritte küçük resimse 360p/15 gönderilir. İzleyici sohbete geçerse veya sekmeyi kapatırsa o kişi için kodlama tamamen durur
  (ses devam eder), geri dönünce anında devam eder
- İzleyici sayısı arttıkça (her izleyici ayrı kodlama demek) yayıncının bilgisayarı yorulmasın diye FPS kademeli olarak sınırlanır
- Yayıncının kendi önizlemesi 15 FPS'lik hafif bir kopyadır; tam kaliteyi kendine göstermek için GPU harcanmaz
- Bit hızı çözünürlük, FPS, codec verimliliği ve içerik türüne göre hesaplanır; ağ ya da işlemci yetmezse tarayıcı otomatik
  düşürür ve kutucukta uyarı gösterilir
- Kamera/ekran için bit hızı ve FPS sınırları; kişi sayısı arttıkça kamera kalitesi otomatik düşer
- Konuşma algılama yalnızca kendi mikrofonunu analiz eder (saniyede 10 kez), başkalarının sesi tekrar işlenmez
- Ses odası görünümü kapalıyken video çözülmez; mesaj listesi sınırlı sayıda öğe çizer
- Ayarlar → Görüntü → **Yayın kalitesi: Düşük** ile en zayıf bilgisayarlarda da çalışır

## Yayınlama (GitHub Pages)

Uygulama GitHub Pages ile `gh-pages` dalından yayınlanır. `src/` altında yapılan her değişiklik
push edildiğinde `.github/workflows/pages.yml` uygulamayı derleyip `gh-pages` dalını otomatik günceller.

HTTPS veren herhangi bir statik barındırma (Netlify, Cloudflare Pages, Vercel…) da olur: tek yapman gereken `docs/index.html` dosyasını yüklemek.

## Nasıl kullanılır

1. Linki aç, kullanıcı adını yaz.
2. Soldaki **＋** ile sunucu oluştur. Açılan pencereden **davet linkini** kopyalayıp arkadaşlarına gönder.
3. Arkadaşların linki açınca sunucuya katılır. Ses kanalına tıklayınca sesli sohbete girersin.
   Alttaki 📷 ve 🖥️ butonları kamerayı ve ekran paylaşımını açar.

## Bilmen gerekenler

- Sunucu olmadığı için mesaj geçmişi herkesin kendi tarayıcısında saklanır ve çevrimiçi olan üyeler arasında eşitlenir.
  Sen yokken yazılan mesajlar, o sırada çevrimiçi olan biri tekrar geldiğinde sana da gelir.
- Eşleşme (birbirini bulma) herkese açık Nostr röleleri üzerinden yapılır; içerik bu rölelerden geçmez.
- Bağlantı doğrudan kurulur. Çok katı ağlarda (bazı mobil operatörler, kurumsal ağlar) iki kişi bağlanamayabilir;
  bu durumda başka bir ağ (ev Wi-Fi'ı) dene.
- Mesh yapı nedeniyle sesli/görüntülü odalar ~8 kişiye kadar en iyi sonucu verir (arkadaş grubu için ideal).
- Davet kodu sunucunun şifresidir; yalnızca güvendiğin kişilerle paylaş.

## Geliştirme

```sh
npm install
npm run build   # src/ → docs/index.html
npx serve docs  # http://localhost:3000
```

Kaynaklar: `src/main.js` (uygulama), `src/media.js` (codec seçimi, SDP ayarları, yayın bit hızı ve istatistikler), `src/style.css` (tema), `src/index.html` (iskelet), `build.mjs` (tek dosyaya paketleme).
Özel Nostr röleleri için: `index.html?relay=wss://röle1,wss://röle2`. Codec'i zorlamak için: `?codec=AV1` (veya `VP9`, `H264`, `VP8`).
