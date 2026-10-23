import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'ubm_pwa_install_dismissed_until';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as any).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Nút "Cài ứng dụng" chỉ hiện khi trình duyệt phát sự kiện beforeinstallprompt
 * (Chrome/Edge/Android). iOS không có sự kiện này — người dùng vẫn có thể
 * "Thêm vào màn hình chính" qua Safari; manifest + apple-touch-icon đã hỗ trợ.
 */
export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    try {
      const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) return;
    } catch {
      // localStorage có thể bị chặn ở chế độ riêng tư — vẫn cho hiện nút.
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
      try {
        localStorage.removeItem(DISMISS_KEY);
      } catch {
        // bỏ qua
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible || !deferredPrompt) return null;

  const install = async () => {
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setVisible(false);
        setDeferredPrompt(null);
      }
    } catch (err) {
      console.warn('[pwa] install prompt failed:', err);
    }
  };

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
    } catch {
      // bỏ qua
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Cài ứng dụng Ụm Bò Milk"
      style={{
        position: 'fixed',
        right: '14px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 78px)',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        maxWidth: 'calc(100vw - 28px)',
        padding: '8px 8px 8px 12px',
        borderRadius: '14px',
        border: '1px solid #F3D9E3',
        background: '#FFFFFF',
        boxShadow: '0 10px 28px rgba(232, 93, 146, 0.22)',
      }}
    >
      <button
        type="button"
        onClick={install}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          border: 0,
          borderRadius: '10px',
          padding: '9px 12px',
          background: '#E85D92',
          color: '#FFFFFF',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <Download size={16} />
        Cài ứng dụng
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Để sau"
        title="Để sau"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '30px',
          height: '30px',
          border: 0,
          borderRadius: '8px',
          background: 'transparent',
          color: '#9CA3AF',
          cursor: 'pointer',
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
