import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ───────────────────────────────────────────────────────────────────
const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'youtube-media-downloader.p.rapidapi.com';

console.log('[RapidAPI]', RAPIDAPI_KEY ? '✅ Key tersedia' : '⚠️  RAPIDAPI_KEY belum diset!');

// ─── Utility ──────────────────────────────────────────────────────────────────
function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }
function cleanTikTokUrl(url) {
  try { const p = new URL(url); return p.origin + p.pathname; } catch { return url; }
}
function getVideoId(url) {
  const m = url.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function rapidHeaders() {
  return {
    'x-rapidapi-key':  RAPIDAPI_KEY,
    'x-rapidapi-host': RAPIDAPI_HOST
  };
}

// ─── TikTok: info ─────────────────────────────────────────────────────────────
app.get('/api/download', async (req, res) => {
  let videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ code: -1, msg: 'URL kosong' });
  videoUrl = cleanTikTokUrl(videoUrl);
  try {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`);
    if (!r.ok) throw new Error(`TikWM ${r.status}`);
    return res.json(await r.json());
  } catch (err) {
    return res.status(500).json({ code: -500, msg: 'Gagal TikTok.', error: err.message });
  }
});

// ─── TikTok: stream proxy ─────────────────────────────────────────────────────
app.get('/api/stream', async (req, res) => {
  const fileUrl  = req.query.url;
  const filename = (req.query.filename || 'tiktok.mp4').replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!fileUrl) return res.status(400).send('URL kosong');
  try {
    const upstream = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tiktok.com/' }
    });
    if (!upstream.ok) throw new Error(`CDN ${upstream.status}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).send('Gagal: ' + err.message);
  }
});

// ─── YouTube: info via RapidAPI ───────────────────────────────────────────────
app.get('/api/youtube/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).json({ success: false, msg: 'URL YouTube tidak valid' });
  if (!RAPIDAPI_KEY)
    return res.status(500).json({ success: false, msg: 'RAPIDAPI_KEY belum diset di Render Environment Variables.' });

  const videoId = getVideoId(videoUrl);
  if (!videoId)
    return res.status(400).json({ success: false, msg: 'Video ID tidak ditemukan.' });

  try {
    const r = await fetch(
      `https://${RAPIDAPI_HOST}/v2/video/details?videoId=${videoId}`,
      { headers: rapidHeaders() }
    );
    const data = await r.json();
    console.log('[YT info] status:', r.status, '| title:', data?.title?.slice(0,50));

    if (!data || r.status !== 200) throw new Error(data?.message || 'Gagal ambil info');

    // Ambil format video yang tersedia
    const formats = [];
    const seen = new Set();
    const streams = data?.videos?.items || [];
    for (const f of streams) {
      const h = f.height || 0;
      const label = h ? `${h}p` : (f.qualityLabel || 'Best');
      if (!seen.has(label) && f.url) {
        seen.add(label);
        formats.push({ format_id: f.itag || label, label, height: h, url: f.url });
      }
      if (formats.length >= 5) break;
    }

    return res.json({
      success: true,
      data: {
        id:         videoId,
        title:      data.title || 'YouTube Video',
        thumbnail:  data.thumbnails?.at(-1)?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        duration:   data.lengthSeconds,
        channel:    data.author?.title || '',
        view_count: data.viewCount,
        like_count: null,
        formats:    formats.length ? formats : [{ format_id: 'best', label: 'Best', height: 0 }]
      }
    });
  } catch (err) {
    console.error('[YT info error]', err.message);
    return res.status(500).json({ success: false, msg: 'Gagal menganalisis video: ' + err.message });
  }
});

// ─── YouTube: get direct download URL (kirim ke browser, bukan proxy) ────────
app.get('/api/youtube/download', async (req, res) => {
  const videoUrl = req.query.url;
  const fmt      = req.query.fmt     || 'mp4';
  const quality  = req.query.quality || 'best';

  if (!videoUrl || !isYouTube(videoUrl)) return res.status(400).json({ error: 'URL tidak valid' });
  if (!RAPIDAPI_KEY) return res.status(500).json({ error: 'RAPIDAPI_KEY belum diset' });

  const videoId = getVideoId(videoUrl);
  if (!videoId) return res.status(400).json({ error: 'Video ID tidak valid' });

  try {
    if (fmt === 'mp3') {
      // ── MP3: ambil link langsung ────────────────────────────────────────
      const r = await fetch(
        `https://${RAPIDAPI_HOST}/v2/video/mp3?videoId=${videoId}&quality=high`,
        { headers: rapidHeaders() }
      );
      const data = await r.json();
      console.log('[YT MP3]', JSON.stringify(data).slice(0, 300));

      const mp3Url = data?.url || data?.downloadUrl || data?.link || data?.audio?.url;
      if (!mp3Url) throw new Error('Link MP3 tidak tersedia');

      // Redirect langsung ke URL — browser yang download
      return res.redirect(mp3Url);

    } else {
      // ── MP4: ambil URL dari video details ──────────────────────────────
      const r = await fetch(
        `https://${RAPIDAPI_HOST}/v2/video/details?videoId=${videoId}`,
        { headers: rapidHeaders() }
      );
      const data = await r.json();
      const streams = data?.videos?.items || [];

      let chosen = streams.find(f => String(f.height) === String(quality) && f.url)
                || streams.find(f => f.height >= 720 && f.url)
                || streams.find(f => f.url)
                || null;

      if (!chosen?.url) throw new Error('Format video tidak tersedia');

      console.log('[YT MP4] Chosen:', chosen.height + 'p');

      // Redirect langsung ke URL — browser yang download
      return res.redirect(chosen.url);
    }
  } catch (err) {
    console.error('[YT DL error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal: ' + err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` TikSave aktif → http://localhost:${PORT}`);
  console.log(`==================================================`);
});

// ─── DEBUG: lihat raw response API ───────────────────────────────────────────
app.get('/api/debug/yt', async (req, res) => {
  const videoId = req.query.id || 'dQw4w9WgXcQ';
  if (!RAPIDAPI_KEY) return res.json({ error: 'No API key' });

  const [details, mp3] = await Promise.all([
    fetch(`https://${RAPIDAPI_HOST}/v2/video/details?videoId=${videoId}`, { headers: rapidHeaders() }).then(r=>r.json()),
    fetch(`https://${RAPIDAPI_HOST}/v2/video/mp3?videoId=${videoId}&quality=high`, { headers: rapidHeaders() }).then(r=>r.json()),
  ]);

  res.json({ details_keys: Object.keys(details), videos_sample: details?.videos?.items?.slice(0,2), audios_sample: details?.audios?.items?.slice(0,2), mp3_response: mp3 });
});
