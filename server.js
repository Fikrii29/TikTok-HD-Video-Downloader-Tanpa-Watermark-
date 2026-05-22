import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Utility ────────────────────────────────────────────────────────────────

function isTikTok(url) {
  return /tiktok\.com|vm\.tiktok\.com/.test(url);
}

function isYouTube(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

function cleanTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname; // Hapus ?is_from_webapp dll
  } catch {
    return url;
  }
}

// ─── TikTok API ─────────────────────────────────────────────────────────────

app.get('/api/download', async (req, res) => {
  let videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ code: -1, msg: 'URL tidak boleh kosong' });
  }

  videoUrl = cleanTikTokUrl(videoUrl);

  try {
    const tikwmApiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`;
    const response = await fetch(tikwmApiUrl);

    if (!response.ok) {
      throw new Error(`TikWM API error: ${response.status}`);
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error('TikTok error:', error);
    return res.status(500).json({
      code: -500,
      msg: 'Gagal mengambil data TikTok. Pastikan link benar.',
      error: error.message
    });
  }
});

// ─── YouTube API (via yt-dlp) ────────────────────────────────────────────────

app.get('/api/youtube/info', async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl || !isYouTube(videoUrl)) {
    return res.status(400).json({ success: false, msg: 'URL YouTube tidak valid' });
  }

  try {
    // Ambil metadata JSON dari yt-dlp
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist "${videoUrl}"`,
      { timeout: 30000 }
    );

    const meta = JSON.parse(stdout);

    // Kumpulkan format yang tersedia
    const formats = (meta.formats || [])
      .filter(f => f.ext === 'mp4' && f.height)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    // Ambil resolusi unik terbaik
    const seen = new Set();
    const videoFormats = [];
    for (const f of formats) {
      const label = `${f.height}p`;
      if (!seen.has(label)) {
        seen.add(label);
        videoFormats.push({ format_id: f.format_id, label, height: f.height });
      }
    }

    return res.json({
      success: true,
      data: {
        id: meta.id,
        title: meta.title,
        thumbnail: meta.thumbnail,
        duration: meta.duration,
        uploader: meta.uploader,
        view_count: meta.view_count,
        like_count: meta.like_count,
        channel: meta.channel,
        formats: videoFormats.slice(0, 5), // max 5 pilihan resolusi
      }
    });
  } catch (error) {
    console.error('YouTube info error:', error.message);
    const msg = error.message.includes('not found') || error.message.includes('command')
      ? 'yt-dlp tidak terinstall. Jalankan: pip install yt-dlp'
      : 'Gagal menganalisis video YouTube.';
    return res.status(500).json({ success: false, msg });
  }
});

// YouTube download stream via yt-dlp
app.get('/api/youtube/download', async (req, res) => {
  const videoUrl = req.query.url;
  const fmt = req.query.fmt || 'mp4'; // 'mp4' atau 'mp3'
  const quality = req.query.quality || 'best'; // format_id atau 'best'

  if (!videoUrl || !isYouTube(videoUrl)) {
    return res.status(400).send('URL YouTube tidak valid');
  }

  let ytdlpArgs;
  let filename;
  let contentType;

  if (fmt === 'mp3') {
    ytdlpArgs = `-x --audio-format mp3 --audio-quality 0 -o -`;
    filename = `youtube_audio_${Date.now()}.mp3`;
    contentType = 'audio/mpeg';
  } else {
    // MP4 video — gunakan format_id jika tersedia, fallback ke best mp4
    const fmtArg = quality !== 'best'
      ? `${quality}+bestaudio[ext=m4a]/${quality}/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`
      : `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]`;
    ytdlpArgs = `-f "${fmtArg}" --merge-output-format mp4 -o -`;
    filename = `youtube_video_${Date.now()}.mp4`;
    contentType = 'video/mp4';
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);

  const cmd = `yt-dlp --no-playlist ${ytdlpArgs} "${videoUrl}"`;
  console.log('[YT CMD]', cmd);

  const child = exec(cmd);

  child.stdout.pipe(res);

  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  child.on('error', (err) => {
    console.error('yt-dlp error:', err);
    if (!res.headersSent) {
      res.status(500).send('yt-dlp error: ' + err.message);
    }
  });

  req.on('close', () => {
    child.kill();
  });
});

// ─── TikTok Stream Proxy ─────────────────────────────────────────────────────

app.get('/api/stream', async (req, res) => {
  const fileUrl = req.query.url;
  let filename = req.query.filename || 'tiktok_video.mp4';

  if (!fileUrl) return res.status(400).send('URL file tidak boleh kosong');

  filename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');

  try {
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });

    if (!response.ok) throw new Error(`CDN error: ${response.status}`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.pipe(res);
    } else {
      res.status(500).send('Respon body kosong');
    }
  } catch (error) {
    console.error('Stream error:', error);
    if (!res.headersSent) res.status(500).send(`Gagal: ${error.message}`);
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` TikSave Server aktif!`);
  console.log(` Buka browser: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
