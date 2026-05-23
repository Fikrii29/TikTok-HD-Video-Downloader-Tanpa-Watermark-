import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { spawn, execSync } from 'child_process';
import ytDlp from 'yt-dlp-exec';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Resolve yt-dlp binary ───────────────────────────────────────────────────
async function ensureBinary() {
  const localBin = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
  fs.mkdirSync(path.dirname(localBin), { recursive: true });

  const isValid = fs.existsSync(localBin) && fs.statSync(localBin).size > 100000;

  if (!isValid) {
    console.log('[yt-dlp] Mendownload binary...');
    try {
      execSync(
        `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${localBin}" && chmod +x "${localBin}"`,
        { timeout: 120000, stdio: 'inherit' }
      );
      console.log('[yt-dlp] ✅ Binary downloaded');
    } catch (e) {
      console.error('[yt-dlp] ❌ Download gagal:', e.message);
    }
  } else {
    try { execSync(`chmod +x "${localBin}"`); } catch {}
    console.log('[yt-dlp] ✅ Binary OK:', localBin);
  }
  return localBin;
}

const YTDLP_BIN    = await ensureBinary();
const COOKIES_PATH = '/etc/secrets/cookies.txt';
const hasCookies   = fs.existsSync(COOKIES_PATH);
console.log('[cookies]', hasCookies ? '✅ ditemukan' : '⚠️  tidak ada');

// ─── Utility ──────────────────────────────────────────────────────────────────
function isTikTok(url)  { return /tiktok\.com|vm\.tiktok\.com/.test(url); }
function isYouTube(url) { return /youtube\.com|youtu\.be/.test(url); }
function cleanTikTokUrl(url) {
  try { const p = new URL(url); return p.origin + p.pathname; } catch { return url; }
}

// Args dasar untuk semua request YouTube
function ytBaseArgs(url) {
  return [
    '--no-playlist',
    '--no-warnings',
    // Bypass 429 & bot detection
    '--extractor-args', 'youtube:player_client=web,mweb',
    '--sleep-requests', '1',
    '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    ...(hasCookies ? ['--cookies', COOKIES_PATH] : []),
    url
  ];
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

// ─── YouTube: info ────────────────────────────────────────────────────────────
app.get('/api/youtube/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !isYouTube(videoUrl))
    return res.status(400).json({ success: false, msg: 'URL YouTube tidak valid' });

  try {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=web,mweb',
      '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      ...(hasCookies ? ['--cookies', COOKIES_PATH] : []),
      videoUrl
    ];

    const result = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(YTDLP_BIN, args);
      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);
      child.on('close', code => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.slice(-500)));
      });
    });

    const meta = JSON.parse(result);

    // Kumpulkan format terbaik — support mp4 DAN webm
    const seen = new Set();
    const formats = [];
    const sorted = (meta.formats || [])
      .filter(f => f.height && (f.ext === 'mp4' || f.ext === 'webm') && f.vcodec !== 'none')
      .sort((a,b) => (b.height||0) - (a.height||0));

    for (const f of sorted) {
      if (!seen.has(f.height)) {
        seen.add(f.height);
        formats.push({ format_id: f.format_id, label: `${f.height}p`, height: f.height, ext: f.ext });
        if (formats.length >= 5) break;
      }
    }

    return res.json({
      success: true,
      data: {
        id: meta.id, title: meta.title, thumbnail: meta.thumbnail,
        duration: meta.duration, uploader: meta.uploader, channel: meta.channel,
        view_count: meta.view_count, like_count: meta.like_count,
        formats: formats.length ? formats : [{ format_id: 'bestvideo+bestaudio', label: 'Best', ext: 'mp4' }]
      }
    });
  } catch (err) {
    console.error('[YT info]', err.message.slice(0, 300));
    const msg = err.message.includes('429')
      ? 'YouTube rate limit. Coba lagi dalam beberapa detik.'
      : 'Gagal menganalisis video YouTube.';
    return res.status(500).json({ success: false, msg });
  }
});

// ─── YouTube: download ────────────────────────────────────────────────────────
app.get('/api/youtube/download', (req, res) => {
  const videoUrl = req.query.url;
  const fmt      = req.query.fmt     || 'mp4';
  const quality  = req.query.quality || 'best';

  if (!videoUrl || !isYouTube(videoUrl)) return res.status(400).send('URL tidak valid');

  const baseArgs = [
    '--no-playlist',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=web,mweb',
    '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    ...(hasCookies ? ['--cookies', COOKIES_PATH] : []),
  ];

  let ytArgs, filename, contentType;

  if (fmt === 'mp3') {
    ytArgs      = [...baseArgs, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', '-', videoUrl];
    filename    = `youtube_audio_${Date.now()}.mp3`;
    contentType = 'audio/mpeg';
  } else {
    // Format fleksibel: coba format_id dulu, fallback ke best
    const fmtStr = quality !== 'best'
      ? `${quality}+bestaudio/${quality}/bestvideo+bestaudio/best`
      : `bestvideo+bestaudio/best`;
    ytArgs      = [...baseArgs, '-f', fmtStr, '--merge-output-format', 'mp4', '-o', '-', videoUrl];
    filename    = `youtube_video_${Date.now()}.mp4`;
    contentType = 'video/mp4';
  }

  console.log('[YT DL]', fmt, quality);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const child = spawn(YTDLP_BIN, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(res);
  child.stderr.on('data', d => process.stderr.write(d));
  child.on('error', err => {
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
