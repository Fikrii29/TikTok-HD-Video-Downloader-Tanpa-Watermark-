document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // ─── State ───────────────────────────────────────────────────────────────
  let currentPlatform = 'tiktok'; // 'tiktok' | 'youtube'

  // ─── Elements ────────────────────────────────────────────────────────────
  const downloadForm   = document.getElementById('downloadForm');
  const videoUrlInput  = document.getElementById('videoUrl');
  const clearBtn       = document.getElementById('clearBtn');
  const loadingState   = document.getElementById('loadingState');
  const loadingText    = document.getElementById('loadingText');
  const errorState     = document.getElementById('errorState');
  const errorMessage   = document.getElementById('errorMessage');
  const errorCloseBtn  = document.getElementById('errorCloseBtn');
  const resultState    = document.getElementById('resultState');
  const ytResultState  = document.getElementById('ytResultState');
  const toast          = document.getElementById('toast');
  const toastMsg       = document.getElementById('toastMsg');

  // TikTok elements
  const videoCover      = document.getElementById('videoCover');
  const playCount       = document.getElementById('playCount');
  const authorAvatar    = document.getElementById('authorAvatar');
  const authorName      = document.getElementById('authorName');
  const authorUsername  = document.getElementById('authorUsername');
  const videoTitle      = document.getElementById('videoTitle');
  const likeCount       = document.getElementById('likeCount');
  const commentCount    = document.getElementById('commentCount');
  const shareCount      = document.getElementById('shareCount');
  const downloadHD      = document.getElementById('downloadHD');
  const downloadWatermark = document.getElementById('downloadWatermark');
  const downloadMP3     = document.getElementById('downloadMP3');
  const downloadOriginal = document.getElementById('downloadOriginal');

  // YouTube elements
  const ytCover         = document.getElementById('ytCover');
  const ytViewCount     = document.getElementById('ytViewCount');
  const ytChannel       = document.getElementById('ytChannel');
  const ytDuration      = document.getElementById('ytDuration');
  const ytTitle         = document.getElementById('ytTitle');
  const ytLikeCount     = document.getElementById('ytLikeCount');
  const ytVideoFormats  = document.getElementById('ytVideoFormats');
  const ytDownloadMP3   = document.getElementById('ytDownloadMP3');

  // ─── Platform Switch ──────────────────────────────────────────────────────
  window.switchPlatform = function(platform) {
    currentPlatform = platform;
    document.getElementById('tabTikTok').classList.toggle('active', platform === 'tiktok');
    document.getElementById('tabYouTube').classList.toggle('active', platform === 'youtube');

    // Update placeholder
    videoUrlInput.placeholder = platform === 'tiktok'
      ? 'Tempel tautan TikTok di sini (misal: https://vt.tiktok.com/...)'
      : 'Tempel tautan YouTube di sini (misal: https://youtu.be/...)';

    // Hide results when switching
    resultState.style.display = 'none';
    ytResultState.style.display = 'none';
    errorState.style.display = 'none';
  };

  // ─── Input helpers ────────────────────────────────────────────────────────
  videoUrlInput.addEventListener('input', () => {
    clearBtn.style.display = videoUrlInput.value.length > 0 ? 'flex' : 'none';

    // Auto-detect platform from URL
    const val = videoUrlInput.value;
    if (/youtube\.com|youtu\.be/.test(val)) {
      switchPlatform('youtube');
    } else if (/tiktok\.com/.test(val)) {
      switchPlatform('tiktok');
    }
  });

  clearBtn.addEventListener('click', () => {
    videoUrlInput.value = '';
    clearBtn.style.display = 'none';
    videoUrlInput.focus();
  });

  errorCloseBtn.addEventListener('click', () => {
    errorState.style.display = 'none';
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1_000)     return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
  }

  function formatDuration(secs) {
    if (!secs) return '--';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${m}:${String(s).padStart(2,'0')}`;
  }

  function showToast(message, isSuccess = true) {
    toastMsg.textContent = message;
    toast.style.display = 'flex';
    toast.style.background = isSuccess
      ? 'rgba(16,185,129,0.95)'
      : 'rgba(239,68,68,0.95)';
    setTimeout(() => toast.classList.add('show'), 50);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.style.display = 'none'; }, 400);
    }, 3000);
  }

  function showError(msg) {
    loadingState.style.display = 'none';
    errorMessage.textContent = msg;
    errorState.style.display = 'flex';
    showToast('Gagal memproses link', false);
  }

  function hideAll() {
    errorState.style.display   = 'none';
    resultState.style.display  = 'none';
    ytResultState.style.display = 'none';
    loadingState.style.display = 'flex';
  }

  // ─── Form Submit ──────────────────────────────────────────────────────────
  downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = videoUrlInput.value.trim();
    if (!url) {
      showToast('Masukkan link yang valid', false);
      return;
    }

    hideAll();

    if (currentPlatform === 'youtube') {
      await handleYouTube(url);
    } else {
      await handleTikTok(url);
    }
  });

  // ─── TikTok Handler ───────────────────────────────────────────────────────
  async function handleTikTok(url) {
    loadingText.textContent = 'Menganalisis video TikTok...';
    try {
      const resp = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
      const resData = await resp.json();

      if (resData.code !== 0 || !resData.data) {
        throw new Error(resData.msg || 'Link TikTok tidak valid.');
      }

      const d = resData.data;

      videoCover.src      = d.cover || '';
      playCount.textContent = formatNumber(d.play_count);

      if (d.author) {
        authorAvatar.src          = d.author.avatar || '';
        authorName.textContent    = d.author.nickname || 'TikTok User';
        authorUsername.textContent = `@${d.author.unique_id || 'anonymous'}`;
      }

      videoTitle.textContent   = d.title || 'Tanpa keterangan.';
      likeCount.textContent    = formatNumber(d.digg_count);
      commentCount.textContent = formatNumber(d.comment_count);
      shareCount.textContent   = formatNumber(d.share_count);

      const id = d.id || Date.now();

      const hdLink = d.hdplay || d.play;
      downloadHD.href = hdLink
        ? `/api/stream?url=${encodeURIComponent(hdLink)}&filename=tiktok_hd_${id}.mp4`
        : '#';
      downloadHD.style.display = hdLink ? 'flex' : 'none';

      downloadWatermark.href = d.play
        ? `/api/stream?url=${encodeURIComponent(d.play)}&filename=tiktok_sd_${id}.mp4`
        : '#';
      downloadWatermark.style.display = d.play ? 'flex' : 'none';

      downloadMP3.href = d.music
        ? `/api/stream?url=${encodeURIComponent(d.music)}&filename=tiktok_audio_${id}.mp3`
        : '#';
      downloadMP3.style.display = d.music ? 'flex' : 'none';

      if (d.wmplay) {
        downloadOriginal.href = `/api/stream?url=${encodeURIComponent(d.wmplay)}&filename=tiktok_wm_${id}.mp4`;
        downloadOriginal.style.display = 'flex';
      } else {
        downloadOriginal.style.display = 'none';
      }

      loadingState.style.display = 'none';
      resultState.style.display  = 'grid';
      showToast('Video TikTok berhasil dianalisis!');
      resultState.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      showError(err.message || 'Gagal menganalisis video TikTok.');
    }
  }

  // ─── YouTube Handler ──────────────────────────────────────────────────────
  async function handleYouTube(url) {
    loadingText.textContent = 'Menganalisis video YouTube (ini mungkin 10–20 detik)...';
    try {
      const resp = await fetch(`/api/youtube/info?url=${encodeURIComponent(url)}`);
      const resData = await resp.json();

      if (!resData.success || !resData.data) {
        throw new Error(resData.msg || 'Gagal menganalisis video YouTube.');
      }

      const d = resData.data;

      ytCover.src             = d.thumbnail || '';
      ytViewCount.textContent = formatNumber(d.view_count);
      ytChannel.textContent   = d.channel || d.uploader || 'YouTube Channel';
      ytDuration.textContent  = `Durasi: ${formatDuration(d.duration)}`;
      ytTitle.textContent     = d.title || 'Tanpa judul';
      ytLikeCount.textContent = formatNumber(d.like_count);

      // Render resolusi tombol MP4
      ytVideoFormats.innerHTML = '';
      const formats = d.formats && d.formats.length > 0
        ? d.formats
        : [{ format_id: 'best', label: 'Best Quality' }];

      formats.forEach((f, i) => {
        const a = document.createElement('a');
        a.href = `/api/youtube/download?url=${encodeURIComponent(url)}&fmt=mp4&quality=${encodeURIComponent(f.format_id)}`;
        a.className = `dl-btn ${i === 0 ? 'dl-primary' : 'dl-secondary'}`;
        a.innerHTML = `
          <div class="dl-btn-content">
            <i data-lucide="download"></i>
            <div class="text-group">
              <span class="main-text">Download MP4 ${f.label}</span>
              <span class="sub-text">Video ${f.label} ${i === 0 ? '(Kualitas Terbaik)' : ''}</span>
            </div>
          </div>
          <span class="badge ${i === 0 ? '' : 'gray'}">${f.label}</span>
        `;
        ytVideoFormats.appendChild(a);
      });

      // MP3
      ytDownloadMP3.href = `/api/youtube/download?url=${encodeURIComponent(url)}&fmt=mp3`;

      // Re-init icons untuk elemen baru
      lucide.createIcons();

      loadingState.style.display   = 'none';
      ytResultState.style.display  = 'grid';
      showToast('Video YouTube berhasil dianalisis!');
      ytResultState.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      showError(err.message || 'Gagal menganalisis video YouTube.');
    }
  }
});
