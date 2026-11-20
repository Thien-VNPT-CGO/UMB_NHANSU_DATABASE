interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleIdentity {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('google-identity-script') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Không tải được Google Identity.')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Không tải được Google Identity. Kiểm tra mạng hoặc chặn trình duyệt.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Vẽ nút "Đăng nhập bằng Google" chuẩn của Google Identity Services. */
export async function mountGoogleButton(
  element: HTMLElement,
  clientId: string,
  onCredential: (credential: string) => void
): Promise<void> {
  await loadScript();
  const identity = window.google?.accounts?.id;
  if (!identity) throw new Error('Google Identity chưa sẵn sàng.');
  identity.initialize({
    client_id: clientId,
    cancel_on_tap_outside: true,
    callback: (response) => {
      if (response.credential) onCredential(response.credential);
    },
  });
  element.innerHTML = '';
  identity.renderButton(element, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    locale: 'vi',
    width: Math.min(360, element.clientWidth || 320),
  });
}
