import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId?: string;
  appId: string;
  messagingSenderId?: string;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function initFirebase(config: FirebaseWebConfig): Auth {
  if (!app) app = initializeApp(config);
  if (!auth) auth = getAuth(app);
  return auth;
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export async function signInWithGoogle(): Promise<User> {
  if (!auth) throw new Error('Firebase chưa được cấu hình.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function signOutGoogle(): Promise<void> {
  if (auth) await signOut(auth);
}

export function watchAuth(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export function authErrorVi(code: string): string {
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Bạn đã đóng cửa sổ đăng nhập Google.';
    case 'auth/popup-blocked':
      return 'Trình duyệt chặn cửa sổ đăng nhập. Hãy cho phép popup rồi thử lại.';
    case 'auth/cancelled-popup-request':
      return 'Đã có một phiên đăng nhập khác đang mở.';
    case 'auth/unauthorized-domain':
      return 'Tên miền này chưa được thêm vào Authorized domains của Firebase.';
    case 'auth/network-request-failed':
      return 'Không kết nối được tới Firebase. Kiểm tra mạng rồi thử lại.';
    default:
      return 'Đăng nhập thất bại. Vui lòng thử lại.';
  }
}
