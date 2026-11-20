import { AppError } from '../errors';
import { getWorkspace, updateWorkspace } from '../db/repo';
import { broadcast } from './events';
import type { ZaloPersonalSession } from '../../shared/types';
import { buildGroupTestText } from '../../shared/alert-text';

let zcaModule: any = null;
async function zca(): Promise<any> {
  if (!zcaModule) zcaModule = await import('zca-js');
  return zcaModule;
}

export type PersonalPhase = 'idle' | 'qr_waiting' | 'scanned' | 'connected' | 'expired' | 'failed';

export interface PersonalLoginPublic {
  loginId: string;
  phase: PersonalPhase;
  qrImage: string | null;
  scannedBy?: { avatar: string; display_name: string };
  account?: { displayName: string; avatar: string; ownId: string };
  error?: string;
  startedAt: string;
}

interface PersonalLoginInternal extends PersonalLoginPublic {
  abort?: () => unknown;
}

interface PersonalState {
  api: any;
  session: ZaloPersonalSession | null;
  login: PersonalLoginInternal | null;
  restoring: boolean;
  lastRestoreAttempt: number;
  restoreFailCount: number;
  lastError: string | null;
}

const states = new Map<string, PersonalState>();

function stateOf(ownerUid: string): PersonalState {
  let state = states.get(ownerUid);
  if (!state) {
    state = {
      api: null,
      session: null,
      login: null,
      restoring: false,
      lastRestoreAttempt: 0,
      restoreFailCount: 0,
      lastError: null,
    };
    states.set(ownerUid, state);
  }
  return state;
}

function publicLogin(login: PersonalLoginInternal | null): PersonalLoginPublic | null {
  if (!login) return null;
  return {
    loginId: login.loginId,
    phase: login.phase,
    qrImage: login.qrImage,
    scannedBy: login.scannedBy,
    account: login.account,
    error: login.error,
    startedAt: login.startedAt,
  };
}

function parseCookie(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const text = input.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, 'INVALID_COOKIE', 'Cookie phải là JSON hợp lệ (dán nguyên mảng cookie từ trình duyệt).');
  }
}

async function readOwnAccount(api: any): Promise<{ ownId: string; displayName: string; avatar: string }> {
  let ownId = '';
  let displayName = '';
  let avatar = '';
  try {
    ownId = String(await api.getOwnId());
  } catch {
    // ignore
  }
  try {
    const me = await api.fetchAccountInfo();
    displayName = me?.profile?.display_name || me?.display_name || me?.profile?.zaloName || me?.zaloName || '';
    avatar = me?.profile?.avatar || me?.avatar || '';
  } catch {
    // ignore
  }
  return { ownId, displayName, avatar };
}

async function persistSession(ownerUid: string, session: ZaloPersonalSession): Promise<void> {
  const state = stateOf(ownerUid);
  state.session = session;
  await updateWorkspace(ownerUid, { zaloPersonalSession: session });
  broadcast(ownerUid, 'zalo', { connected: true, account: { displayName: session.displayName, uid: session.uid } });
}

/** Khôi phục phiên đã lưu (cookie + imei). Throttle để không spam Zalo khi cookie hỏng. */
export async function restorePersonal(ownerUid: string, force = false): Promise<boolean> {
  const state = stateOf(ownerUid);
  if (state.api) return true;
  if (state.restoring) return false;
  if (!force && Date.now() - state.lastRestoreAttempt < 30_000) return false;
  state.restoring = true;
  state.lastRestoreAttempt = Date.now();
  try {
    let session = state.session;
    if (!session) {
      const workspace = await getWorkspace(ownerUid);
      session = workspace?.zaloPersonalSession || {};
      state.session = session;
    }
    if (!session?.imei || !session?.cookie || !session?.userAgent) return false;
    const { Zalo } = await zca();
    const zalo = new Zalo({ logging: false, checkUpdate: false });
    const api = await zalo.login({
      imei: session.imei,
      cookie: session.cookie,
      userAgent: session.userAgent,
    });
    state.api = api;
    state.restoreFailCount = 0;
    state.lastError = null;
    if (!session.displayName || !session.uid) {
      const own = await readOwnAccount(api);
      const next: ZaloPersonalSession = {
        ...session,
        uid: own.ownId || session.uid,
        displayName: own.displayName || session.displayName,
        avatar: own.avatar || session.avatar,
      };
      await persistSession(ownerUid, next);
    }
    broadcast(ownerUid, 'zalo', { connected: true });
    return true;
  } catch (e) {
    state.api = null;
    state.restoreFailCount += 1;
    state.lastError = (e as Error).message;
    console.warn(`[zalo-personal] restore ${ownerUid} failed (${state.restoreFailCount}x):`, state.lastError);
    return false;
  } finally {
    state.restoring = false;
  }
}

export async function personalStatus(ownerUid: string) {
  const state = stateOf(ownerUid);
  const workspace = await getWorkspace(ownerUid).catch(() => null);
  const session = state.session || workspace?.zaloPersonalSession || {};
  const hasSavedSession = !!(session.imei && session.cookie && session.userAgent);
  if (!state.api && hasSavedSession) {
    await restorePersonal(ownerUid).catch(() => false);
  }
  return {
    connected: !!state.api,
    hasSavedSession,
    account: state.api
      ? {
          uid: state.session?.uid || '',
          displayName: state.session?.displayName || '',
          avatar: state.session?.avatar || '',
        }
      : null,
    login: publicLogin(state.login),
    restoring: state.restoring,
    restoreFailCount: state.restoreFailCount,
    lastError: state.lastError,
  };
}

export function startQrLogin(ownerUid: string): { loginId: string } {
  const state = stateOf(ownerUid);
  if (state.login && (state.login.phase === 'qr_waiting' || state.login.phase === 'scanned')) {
    return { loginId: state.login.loginId };
  }
  const loginId = `ZQ_${Date.now()}`;
  const login: PersonalLoginInternal = {
    loginId,
    phase: 'qr_waiting',
    qrImage: null,
    startedAt: new Date().toISOString(),
  };
  state.login = login;

  void (async () => {
    try {
      const { Zalo, LoginQRCallbackEventType } = await zca();
      const zalo = new Zalo({ logging: false, checkUpdate: false });
      const patch = (phase: PersonalPhase, extra: Partial<PersonalLoginInternal> = {}) => {
        if (state.login?.loginId !== loginId) return;
        Object.assign(state.login, { phase, ...extra });
        broadcast(ownerUid, 'zalo', { phase, login: publicLogin(state.login) });
      };

      const onEvent = (event: any) => {
        try {
          switch (event.type) {
            case LoginQRCallbackEventType.QRCodeGenerated:
              patch('qr_waiting', { qrImage: event.data?.image || null });
              break;
            case LoginQRCallbackEventType.QRCodeScanned:
              patch('scanned', {
                scannedBy: { avatar: event.data?.avatar || '', display_name: event.data?.display_name || '' },
              });
              break;
            case LoginQRCallbackEventType.QRCodeExpired:
              patch('expired', { error: 'Mã QR đã hết hạn, vui lòng tạo mã mới.' });
              break;
            case LoginQRCallbackEventType.QRCodeDeclined:
              patch('failed', { error: 'Đã từ chối đăng nhập trên điện thoại.' });
              break;
            case LoginQRCallbackEventType.GotLoginInfo: {
              const session: ZaloPersonalSession = {
                imei: event.data?.imei,
                cookie: event.data?.cookie,
                userAgent: event.data?.userAgent,
                savedAt: new Date().toISOString(),
              };
              void persistSession(ownerUid, session).catch((e) => console.warn('[zalo-personal] persist failed:', (e as Error).message));
              break;
            }
            default:
              break;
          }
        } catch (e) {
          console.warn('[zalo-personal] QR event error:', (e as Error).message);
        }
      };

      const api = await zalo.loginQR({}, onEvent);
      if (!api) {
        patch('failed', { error: 'Đăng nhập thất bại.' });
        return;
      }
      state.api = api;
      const own = await readOwnAccount(api);
      const session: ZaloPersonalSession = {
        ...(state.session || {}),
        uid: own.ownId || state.session?.uid,
        displayName: own.displayName || state.session?.displayName,
        avatar: own.avatar || state.session?.avatar,
        savedAt: new Date().toISOString(),
      };
      await persistSession(ownerUid, session);
      patch('connected', { account: { displayName: session.displayName || '', avatar: session.avatar || '', ownId: session.uid || '' } });
    } catch (e) {
      console.warn('[zalo-personal] QR login failed:', (e as Error).message);
      if (state.login?.loginId === loginId) {
        state.login.phase = 'failed';
        state.login.error = (e as Error).message;
        broadcast(ownerUid, 'zalo', { phase: 'failed', error: state.login.error });
      }
    }
  })();

  return { loginId };
}

export function qrStatus(ownerUid: string, loginId: string): PersonalLoginPublic | null {
  const state = stateOf(ownerUid);
  if (state.login?.loginId !== loginId) return null;
  return publicLogin(state.login);
}

export function cancelQrLogin(ownerUid: string, loginId: string): boolean {
  const state = stateOf(ownerUid);
  if (state.login?.loginId !== loginId) return false;
  try {
    state.login.abort?.();
  } catch {
    // ignore
  }
  state.login = null;
  return true;
}

export async function connectWithCookie(
  ownerUid: string,
  input: { cookie: unknown; imei: string; userAgent?: string }
): Promise<{ displayName: string; uid: string; avatar: string }> {
  const cookie = parseCookie(input.cookie);
  const imei = String(input.imei || '').trim();
  const userAgent = String(input.userAgent || '').trim();
  if (!cookie || !imei || !userAgent) {
    throw new AppError(400, 'MISSING_FIELDS', 'Cần đủ cookie, imei và userAgent để đăng nhập Zalo cá nhân.');
  }
  const state = stateOf(ownerUid);
  try {
    const { Zalo } = await zca();
    const api = await new Zalo({ logging: false, checkUpdate: false }).login({ imei, cookie, userAgent });
    state.api = api;
    const own = await readOwnAccount(api);
    const session: ZaloPersonalSession = {
      cookie,
      imei,
      userAgent,
      uid: own.ownId,
      displayName: own.displayName,
      avatar: own.avatar,
      savedAt: new Date().toISOString(),
    };
    await persistSession(ownerUid, session);
    state.login = null;
    return { displayName: own.displayName, uid: own.ownId, avatar: own.avatar };
  } catch (e) {
    throw new AppError(400, 'ZALO_COOKIE_LOGIN_FAILED', `Không đăng nhập được bằng cookie: ${(e as Error).message}`);
  }
}

export async function disconnectPersonal(ownerUid: string): Promise<void> {
  const state = stateOf(ownerUid);
  state.api = null;
  state.session = null;
  state.login = null;
  await updateWorkspace(ownerUid, { zaloPersonalSession: {} });
  broadcast(ownerUid, 'zalo', { connected: false });
}

async function requireApi(ownerUid: string): Promise<any> {
  const state = stateOf(ownerUid);
  if (!state.api) {
    const restored = await restorePersonal(ownerUid, true);
    if (!restored || !state.api) {
      throw new AppError(409, 'ZALO_NOT_CONNECTED', 'Chưa kết nối Zalo cá nhân. Hãy quét QR hoặc đăng nhập bằng cookie.');
    }
  }
  return state.api;
}

function nameOfGroup(info: any, groupId: string): { name: string; avatar: string; memberIds: string[] } {
  const grid = info?.gridInfoMap?.[groupId] || info?.data?.gridInfoMap?.[groupId] || info?.groupInfo?.[groupId] || info;
  return {
    name: String(grid?.name || grid?.groupName || info?.name || groupId),
    avatar: String(grid?.avt || grid?.avatar || ''),
    memberIds: Array.isArray(grid?.memberIds) ? grid.memberIds.map(String) : Array.isArray(info?.memberIds) ? info.memberIds.map(String) : [],
  };
}

export async function listGroups(ownerUid: string): Promise<Array<{ id: string; name: string; avatar: string; memberCount: number }>> {
  const api = await requireApi(ownerUid);
  const raw = await api.getAllGroups();
  let ids: string[] = [];
  if (raw?.gridVerMap && typeof raw.gridVerMap === 'object') {
    ids = Object.keys(raw.gridVerMap);
  } else if (Array.isArray(raw)) {
    ids = raw.map((g: any) => g?.groupId || g?.id).filter(Boolean).map(String);
  } else if (raw && typeof raw === 'object') {
    ids = Object.keys(raw).filter((k) => /^-?\d+$/.test(k));
  }
  ids = [...new Set(ids)].slice(0, 200);

  const details = await Promise.allSettled(ids.map((id) => api.getGroupInfo(id)));
  const groups = ids.map((id, index) => {
    const result = details[index];
    if (result.status === 'fulfilled') {
      const info = result.value;
      const parsed = nameOfGroup(info, id);
      return { id, name: parsed.name, avatar: parsed.avatar, memberCount: parsed.memberIds.length };
    }
    return { id, name: id, avatar: '', memberCount: 0 };
  });
  groups.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return groups;
}

export async function listGroupMembers(
  ownerUid: string,
  groupId: string
): Promise<Array<{ uid: string; name: string; avatar: string }>> {
  const api = await requireApi(ownerUid);
  const info = await api.getGroupInfo(groupId);
  const parsed = nameOfGroup(info, groupId);
  let memberIds = parsed.memberIds;
  if (!memberIds.length && Array.isArray(info?.memberIds)) memberIds = info.memberIds.map(String);
  if (!memberIds.length) return [];

  let detail: any = {};
  try {
    detail = await api.getGroupMembersInfo(memberIds);
  } catch (e) {
    console.warn('[zalo-personal] getGroupMembersInfo failed:', (e as Error).message);
  }
  const map = detail?.changed_members || detail?.members || detail?.data || detail;
  return memberIds.map((uid) => {
    const value = map?.[uid] || (Array.isArray(map) ? map.find((m: any) => String(m?.id || m?.uid) === uid) : null) || {};
    return {
      uid: String(value?.id || value?.uid || uid),
      name: String(value?.dName || value?.zaloName || value?.displayName || value?.display_name || value?.name || uid),
      avatar: String(value?.avatar || value?.avatar_25 || value?.avt || ''),
    };
  });
}

export interface SendGroupResult {
  success: boolean;
  msgId?: string | number;
  detail: string;
}

/** Gửi tin nhắn (có thể kèm mentions) vào nhóm Zalo cá nhân. */
export async function sendGroupMessage(
  ownerUid: string,
  groupId: string,
  content: { msg: string; mentions?: Array<{ pos: number; len: number; uid: string }> }
): Promise<SendGroupResult> {
  try {
    const api = await requireApi(ownerUid);
    const { ThreadType } = await zca();
    const response = await api.sendMessage(content, groupId, ThreadType.Group);
    const msgId = response?.message?.msgId ?? response?.msgId ?? response?.data?.msgId;
    const errorCode = response?.error ?? response?.errorCode;
    if (typeof errorCode === 'number' && errorCode !== 0) {
      return { success: false, detail: `Zalo cá nhân báo lỗi ${errorCode}: ${response?.message || ''}` };
    }
    if (msgId === undefined || msgId === null) {
      // zca-js đôi khi trả object rỗng nhưng tin đã gửi; coi là thành công nếu không ném lỗi.
      return { success: true, detail: 'Đã gửi (không có msgId trả về).' };
    }
    return { success: true, msgId, detail: `msgId=${msgId}` };
  } catch (e) {
    return { success: false, detail: (e as Error).message };
  }
}

export async function sendTestToGroup(ownerUid: string, groupId: string, groupName: string): Promise<SendGroupResult> {
  return sendGroupMessage(ownerUid, groupId, { msg: buildGroupTestText(groupName) });
}
