document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  const downloadForm = document.getElementById('downloadForm');
  const tiktokUrlInput = document.getElementById('tiktokUrl');
  const clearBtn = document.getElementById('clearBtn');
  
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const errorCloseBtn = document.getElementById('errorCloseBtn');
  
  const resultState = document.getElementById('resultState');
  
  // Elements for results
  const videoCover = document.getElementById('videoCover');
  const playCount = document.getElementById('playCount');
  const authorAvatar = document.getElementById('authorAvatar');
  const authorName = document.getElementById('authorName');
  const authorUsername = document.getElementById('authorUsername');
  const videoTitle = document.getElementById('videoTitle');
  const likeCount = document.getElementById('likeCount');
  const commentCount = document.getElementById('commentCount');
  const shareCount = document.getElementById('shareCount');
  
  const downloadHD = document.getElementById('downloadHD');
  const downloadWatermark = document.getElementById('downloadWatermark');
  const downloadMP3 = document.getElementById('downloadMP3');
  const downloadOriginal = document.getElementById('downloadOriginal');

  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  // Input Clear Button visibility toggle
  tiktokUrlInput.addEventListener('input', () => {
    if (tiktokUrlInput.value.length > 0) {
      clearBtn.style.display = 'flex';
    } else {
      clearBtn.style.display = 'none';
    }
  });

  clearBtn.addEventListener('click', () => {
    tiktokUrlInput.value = '';
    clearBtn.style.display = 'none';
    tiktokUrlInput.focus();
  });

  // Close Error card
  errorCloseBtn.addEventListener('click', () => {
    errorState.style.display = 'none';
  });

  // Helper: Format Number (e.g. 1500000 -> 1.5M, 1500 -> 1.5K)
  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
  }

  // Helper: Show Toast
  function showToast(message, isSuccess = true) {
    toastMsg.textContent = message;
    toast.style.display = 'flex';
    if (isSuccess) {
      toast.style.background = 'rgba(16, 185, 129, 0.95)';
    } else {
      toast.style.background = 'rgba(239, 68, 68, 0.95)';
    }
    
    // Trigger CSS animation
    setTimeout(() => {
      toast.classList.add('show');
    }, 50);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.style.display = 'none';
      }, 400);
    }, 3000);
  }

  // Handle Form Submit
  downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = tiktokUrlInput.value.trim();

    if (!url) {
      showToast('Masukkan link TikTok yang valid', false);
      return;
    }

    // Reset views
    errorState.style.display = 'none';
    resultState.style.display = 'none';
    loadingState.style.display = 'flex';

    try {
      const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
      const resData = await response.json();

      if (resData.code !== 0 || !resData.data) {
        throw new Error(resData.msg || 'Gagal menganalisis video. Pastikan link video valid.');
      }

      const tiktokData = resData.data;

      // Populate UI with TikTok data
      videoCover.src = tiktokData.cover || 'placeholder.jpg';
      playCount.textContent = formatNumber(tiktokData.play_count);
      
      // Author info
      if (tiktokData.author) {
        authorAvatar.src = tiktokData.author.avatar || 'placeholder-avatar.jpg';
        authorName.textContent = tiktokData.author.nickname || 'TikTok User';
        authorUsername.textContent = `@${tiktokData.author.unique_id || 'anonymous'}`;
      } else {
        authorAvatar.src = 'placeholder-avatar.jpg';
        authorName.textContent = 'TikTok User';
        authorUsername.textContent = '@anonymous';
      }

      // Metadata & Stats
      videoTitle.textContent = tiktokData.title || 'Tanpa keterangan video.';
      likeCount.textContent = formatNumber(tiktokData.digg_count);
      commentCount.textContent = formatNumber(tiktokData.comment_count);
      shareCount.textContent = formatNumber(tiktokData.share_count);

      // Download Buttons configuration using Server stream proxy (CORS bypass + download attachment naming)
      const id = tiktokData.id || Date.now().toString();
      
      // Video HD (No Watermark)
      const hdLink = tiktokData.hdplay || tiktokData.play;
      if (hdLink) {
        downloadHD.href = `/api/stream?url=${encodeURIComponent(hdLink)}&filename=tiktok_video_hd_${id}.mp4`;
        downloadHD.style.display = 'flex';
      } else {
        downloadHD.style.display = 'none';
      }

      // Video SD (No Watermark)
      const sdLink = tiktokData.play;
      if (sdLink) {
        downloadWatermark.href = `/api/stream?url=${encodeURIComponent(sdLink)}&filename=tiktok_video_${id}.mp4`;
        downloadWatermark.style.display = 'flex';
      } else {
        downloadWatermark.style.display = 'none';
      }

      // MP3 Music
      const musicLink = tiktokData.music;
      if (musicLink) {
        const musicTitle = tiktokData.music_info?.title || 'audio';
        downloadMP3.href = `/api/stream?url=${encodeURIComponent(musicLink)}&filename=tiktok_audio_${id}.mp3`;
        downloadMP3.style.display = 'flex';
      } else {
        downloadMP3.style.display = 'none';
      }

      // Original video with watermark (optional fallback)
      if (tiktokData.wmplay) {
        downloadOriginal.href = `/api/stream?url=${encodeURIComponent(tiktokData.wmplay)}&filename=tiktok_original_wm_${id}.mp4`;
        downloadOriginal.style.display = 'flex';
      } else {
        downloadOriginal.style.display = 'none';
      }

      // Show Results
      loadingState.style.display = 'none';
      resultState.style.display = 'grid';
      showToast('Video berhasil dianalisis!');
      
      // Scroll to result smoothly
      resultState.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
      console.error('Download error:', error);
      loadingState.style.display = 'none';
      errorMessage.textContent = error.message || 'Terjadi kesalahan sistem. Silakan coba lagi.';
      errorState.style.display = 'flex';
      showToast('Gagal memproses link', false);
    }
  });
});
