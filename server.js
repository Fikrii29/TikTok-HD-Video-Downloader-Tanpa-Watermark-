import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import ytDlp from 'yt-dlp-exec';
import { YOUTUBE_DL_PATH } from './node_modules/yt-dlp-exec/src/constants.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Cookies path ─────────────────────────────────────────────────────────────
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');
const hasCookies   = fs.existsSync(COOKIES_PATH);
console.log('[cookies]', hasCookies ? '✅ cookies.txt ditemukan' : '⚠️  cookies.txt tidak ada');
console.log('[yt-dlp ]', YOUTUBE_DL_PATH);

// ─── Utility ──────────────────────────────────────────────────────────────────

function isTikTok(url)  { return /tiktok\.com|vm\.tiktok\.com/.test(url); }
function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }

function cleanTikTokUrl(url) {
  try { const p = new URL(url); return p.origin + p.pathname; }
  catch { return url; }
}

// Tambahkan --cookies jika file ada
function cookiesArgs() {
  return hasCookies ? ['--cookies', COOKIES_PATH] : [];
}

// ─── TikTok: info via TikWM ───────────────────────────────────────────────────

app.get('/api/download', async (req, res) => {
  let videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ code: -1, msg: 'URL tidak boleh kosong' });

  videoUrl = cleanTikTokUrl(videoUrl);

  try {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`);
    if (!r.ok) throw new Error(`TikWM ${r.status}`);
    return res.json(await r.json());
  } catch (err) {
    console.error('[TikTok]', err.message);
    return res.status(500).json({ code: -500, msg: 'Gagal mengambil data TikTok.', error: err.message });
  }
});

// ─── TikTok: stream proxy ─────────────────────────────────────────────────────

app.get('/api/stream', async (req, res) => {
  const fileUrl  = req.query.url;
  const filename = (req.query.filename || 'tiktok_video.mp4').replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!fileUrl) return res.status(400).send('URL kosong');

  try {
    const upstream = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    if (!upstream.ok) throw new Error(`CDN ${upstream.status}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[Stream]', err.message);
    if (!res.headersSent) res.status(500).send('Gagal: ' + err.message);
  }
});

// ─── YouTube: info ────────────────────────────────────────────────────────────

app.get('/api/youtube/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).json({ success: false, msg: 'URL YouTube tidak valid' });

  try {
    const meta = await ytDlp(videoUrl, {
      dumpJson:   true,
      noPlaylist: true,
      ...(hasCookies && { cookies: COOKIES_PATH }),
      // Tambahan agar tidak diblokir
      addHeader: [
        'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language:en-US,en;q=0.9'
      ]
    });

    const seen = new Set();
    const formats = [];
    for (const f of (meta.formats || []).sort((a,b)=>(b.height||0)-(a.height||0))) {
      if (f.ext === 'mp4' && f.height && !seen.has(f.height)) {
        seen.add(f.height);
        formats.push({ format_id: f.format_id, label: `${f.height}p`, height: f.height });
        if (formats.length >= 5) break;
      }
    }

    return res.json({
      success: true,
      data: {
        id:         meta.id,
        title:      meta.title,
        thumbnail:  meta.thumbnail,
        duration:   meta.duration,
        uploader:   meta.uploader,
        channel:    meta.channel,
        view_count: meta.view_count,
        like_count: meta.like_count,
        formats:    formats.length ? formats : [{ format_id: 'best', label: 'Best' }]
      }
    });
  } catch (err) {
    console.error('[YT info]', err.message);
    const msg = err.message.includes('Sign in')  ? 'YouTube meminta login. Pastikan cookies.txt valid.' :
                err.message.includes('blocked')   ? 'YouTube memblokir request. Perbarui cookies.txt.' :
                err.message.includes('copyright') ? 'Video ini tidak tersedia di wilayah server.' :
                'Gagal menganalisis video YouTube.';
    return res.status(500).json({ success: false, msg });
  }
});

// ─── YouTube: download stream ─────────────────────────────────────────────────

app.get('/api/youtube/download', (req, res) => {
  const videoUrl = req.query.url;
  const fmt      = req.query.fmt     || 'mp4';
  const quality  = req.query.quality || 'best';

  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).send('URL YouTube tidak valid');

  let ytArgs, filename, contentType;

  const baseArgs = [
    '--no-playlist',
    '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    ...cookiesArgs()
  ];

  if (fmt === 'mp3') {
    ytArgs      = [...baseArgs, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', '-', videoUrl];
    filename    = `youtube_audio_${Date.now()}.mp3`;
    contentType = 'audio/mpeg';
  } else {
    const fmtStr = quality !== 'best'
      ? `${quality}+bestaudio[ext=m4a]/${quality}/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`
      : `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
    ytArgs      = [...baseArgs, '-f', fmtStr, '--merge-output-format', 'mp4', '-o', '-', videoUrl];
    filename    = `youtube_video_${Date.now()}.mp4`;
    contentType = 'video/mp4';
  }

  console.log('[YT DL]', fmt, quality, videoUrl);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const child = spawn(YOUTUBE_DL_PATH, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(res);
  child.stderr.on('data', d => process.stderr.write(d));
  child.on('error', err => {
    console.error('[YT spawn]', err.message);
    if (!res.headersSent) res.status(500).send('Error: ' + err.message);
  });
  req.on('close', () => child.kill());
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` TikSave aktif → http://localhost:${PORT}`);
  console.log(`==================================================`);
});
