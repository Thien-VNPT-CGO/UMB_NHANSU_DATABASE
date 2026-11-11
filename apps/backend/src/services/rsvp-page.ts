/**
 * Trang xác nhận phỏng vấn công khai cho ứng viên (RSVP) — HTML tự chứa, không
 * phụ thuộc build frontend. Ứng viên mở link trong thư mời Zalo là thấy ngay
 * bảng xác nhận, không cần đăng nhập SĐT/PIN.
 *
 * Tách khỏi app.ts để dễ chỉnh giao diện + test render độc lập.
 */

import { proposalSlotTimes } from './interview-slots.service.js';

export const escapeHtml = (s: unknown) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export type RsvpIconName = 'clock' | 'pin' | 'briefcase' | 'calendar' | 'user';

export type RsvpInfoRow = {
  icon: RsvpIconName;
  label: string;
  value: string;
  highlight?: boolean;
};

export type RsvpPageOptions = {
  badge?: string;
  tone?: 'pending' | 'ok' | 'muted';
  info?: RsvpInfoRow[];
};

const rsvpSvg = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const RSVP_ICONS = {
  clock: rsvpSvg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>'),
  pin: rsvpSvg('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.8"/>'),
  briefcase: rsvpSvg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M3 12h18"/>'),
  calendar: rsvpSvg('<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M16 3v4M8 3v4M3.5 10.5h17"/>'),
  user: rsvpSvg('<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="3.6"/>'),
  check: rsvpSvg('<path d="m20 6.5-11 11-5-5"/>'),
  x: rsvpSvg('<path d="M18 6 6 18M6 6l12 12"/>'),
  lock: rsvpSvg('<rect x="4.5" y="10" width="15" height="10" rx="2.5"/><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/>'),
};

export function renderRsvpPage(
  title: string,
  bodyHtml: string,
  ctx: { token: string; name: string; status: string } | null,
  opts?: RsvpPageOptions
): string {
  const tone = opts?.tone || 'muted';
  // "Hôm nay" theo giờ VN — dùng làm min cho ô chọn ngày đề xuất lịch mới.
  const vnToday = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  // Khung giờ được render SẴN ở server (không chờ JS/API) để ứng viên luôn thấy
  // chức năng chọn giờ phỏng vấn, kể cả khi WebView chặn sự kiện change hoặc API
  // khung giờ tạm lỗi. JS chỉ cập nhật trạng thái kín/qua giờ sau đó.
  const slotTimes = proposalSlotTimes();
  const slotButtons = (session: 'SANG' | 'CHIEU') => slotTimes
    .filter((s) => s.session === session)
    .map((s) => `<button type="button" class="slot" data-time="${s.time}" data-session="${s.session}" aria-label="Chọn ${s.time}">${s.time}</button>`)
    .join('');
  const infoHtml = (opts?.info && opts.info.length > 0)
    ? `<div class="info">${opts.info.map((r) => `<div class="row${r.highlight ? ' hl' : ''}"><div class="ico">${RSVP_ICONS[r.icon]}</div><div class="txt"><div class="lab">${escapeHtml(r.label)}</div><div class="val">${escapeHtml(r.value)}</div></div></div>`).join('')}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta name="theme-color" content="#3A0F26" />
<title>${escapeHtml(title)} — Ụm Bò Milk</title>
<style>
*{box-sizing:border-box}
html{height:100%}
body{min-height:100vh;min-height:100dvh;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#160A11;color:#111827;display:flex;align-items:center;justify-content:center;padding:22px 16px;position:relative;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;z-index:-2;background:radial-gradient(900px 500px at 88% -8%,rgba(232,93,146,.38),transparent 60%),radial-gradient(700px 520px at -10% 112%,rgba(190,24,93,.30),transparent 60%),linear-gradient(160deg,#1C0C14 0%,#3A0F26 55%,#1A0A12 100%)}
body::after{content:'';position:fixed;inset:0;z-index:-1;opacity:.45;background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:22px 22px}
.card{width:100%;max-width:460px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.5) inset;animation:up .45s ease-out both}
@keyframes up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.top{height:5px;background:linear-gradient(90deg,#F7A8C4,#E85D92,#B4265B,#E85D92)}
.hero{padding:24px 22px 6px;text-align:center;background:linear-gradient(180deg,#FFF4F8 0%,#FFFCFD 72%,#FFF 100%)}
.brand{display:flex;width:max-content;margin:0 auto;align-items:center;gap:9px;text-align:left}
.mark{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#E85D92,#B4265B);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;box-shadow:0 6px 14px rgba(232,93,146,.35)}
.brand b{display:block;font-size:12.5px;letter-spacing:.14em;color:#B4265B;line-height:1.1;text-align:left}
.brand small{display:block;font-size:9px;letter-spacing:.22em;color:#B08A99;font-weight:700;margin-top:3px;text-align:left}
.pill{display:flex;width:max-content;align-items:center;gap:6px;margin:14px auto 0;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.02em;line-height:1.2}
.pill i{width:6px;height:6px;border-radius:50%;display:block}
.pill.pending{background:#FFF4E5;color:#B45309;border:1px solid #FDE3BF}
.pill.pending i{background:#F59E0B;box-shadow:0 0 0 3px rgba(245,158,11,.18)}
.pill.ok{background:#ECFDF5;color:#047857;border:1px solid #A7F3D0}
.pill.ok i{background:#10B981;box-shadow:0 0 0 3px rgba(16,185,129,.18)}
.pill.muted{background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB}
.pill.muted i{background:#9CA3AF}
h1{font-size:21px;line-height:1.32;font-weight:900;color:#160A11;margin:12px 0 8px;letter-spacing:-.01em}
.lede{font-size:13.5px;line-height:1.7;color:#6B7280}
.lede b{color:#160A11}
.lede i{color:#9F1239;font-style:normal;background:#FFF1F5;border-radius:6px;padding:1px 5px}
.body{padding:4px 20px 22px}
.info{display:flex;flex-direction:column;gap:8px;margin:16px 0 0}
.row{display:flex;gap:11px;align-items:flex-start;padding:11px 12px;border-radius:13px;background:#F8FAFC;border:1px solid #EEF2F7;text-align:left}
.row.hl{background:linear-gradient(135deg,#FFF4F8,#FFFBFD);border-color:#F9D3E1}
.ico{flex:0 0 31px;width:31px;height:31px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#FCE7EF;color:#C22661}
.row.hl .ico{background:linear-gradient(135deg,#E85D92,#B4265B);color:#fff;box-shadow:0 5px 12px rgba(232,93,146,.28)}
.txt{min-width:0;flex:1}
.lab{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9CA3AF;line-height:1.25}
.val{font-size:13.5px;font-weight:700;color:#1F2937;line-height:1.5;margin-top:2px;overflow-wrap:anywhere}
.row.hl .val{color:#8F1D4A;font-weight:800}
.actions{margin-top:16px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border-radius:14px;border:0;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer;margin-top:9px;line-height:1.2;transition:transform .12s ease,box-shadow .12s ease,opacity .12s}
.btn:active{transform:scale(.985)}
.btn:disabled{opacity:.6;cursor:not-allowed;box-shadow:none}
.btn svg{flex:0 0 auto}
.confirm{background:linear-gradient(135deg,#12B981,#059669);color:#fff;box-shadow:0 10px 22px rgba(5,150,105,.30)}
.decline{background:#fff;color:#B91C1C;border:1.5px solid #FCA5A5}
.declineBox{display:none;margin-top:11px;padding:14px;border-radius:14px;background:#FFF7F7;border:1px solid #FECACA;text-align:left}
.declineBox.show{display:block;animation:up .2s ease-out both}
.declineBox label{display:block;font-size:12px;font-weight:800;color:#991B1B;margin-bottom:7px}
textarea{width:100%;padding:11px 12px;border-radius:11px;border:1px solid #FCA5A5;background:#fff;font:inherit;font-size:13.5px;line-height:1.55;color:#111827;resize:vertical;min-height:84px;outline:none}
textarea:focus{border-color:#EF4444;box-shadow:0 0 0 3px rgba(239,68,68,.13)}
.sec{font-size:10.5px;font-weight:900;color:#9F1239;letter-spacing:.06em;text-transform:uppercase;margin:16px 0 8px;padding-top:12px;border-top:1px dashed #FECACA}
.sec .opt{font-weight:700;color:#B45309;letter-spacing:0;text-transform:none}
input[type=date]{width:100%;padding:11px 12px;border-radius:11px;border:1px solid #FCA5A5;background:#fff;font:inherit;font-size:13.5px;color:#111827;outline:none}
input[type=date]:focus{border-color:#EF4444;box-shadow:0 0 0 3px rgba(239,68,68,.13)}
.slotGroup{font-size:10px;font-weight:900;color:#9CA3AF;letter-spacing:.08em;text-transform:uppercase;margin:12px 0 6px}
.slotWrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px}
.slot{padding:8px 4px;border-radius:9px;border:1px solid #FBCFE8;background:#FFF;color:#9F1239;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .12s ease}
.slot.on{background:linear-gradient(135deg,#E85D92,#B4265B);border-color:#B4265B;color:#FFF;box-shadow:0 4px 10px rgba(180,38,91,.25)}
.slot:disabled{background:#F1F5F9;border-color:#E2E8F0;color:#CBD5E1;cursor:not-allowed;text-decoration:line-through;box-shadow:none}
.slotHint{font-size:10.5px;color:#9CA3AF;margin-top:6px;line-height:1.5}
#declineNote{min-height:58px}
.send{background:linear-gradient(135deg,#EF4444,#B91C1C);color:#fff;box-shadow:0 8px 18px rgba(185,28,28,.25)}
.msg{margin-top:12px;font-size:13px;font-weight:700;line-height:1.55;white-space:pre-wrap;text-align:center;color:#374151}
.msg:empty{display:none}
.foot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:18px;padding-top:14px;border-top:1px dashed #E5E7EB;font-size:10.5px;color:#9CA3AF;text-align:center;line-height:1.5}
.foot svg{flex:0 0 auto;color:#C4B5C0}
</style>
</head><body><div class="card"><div class="top"></div>
<div class="hero">
<div class="brand"><span class="mark">Ụ</span><span><b>ỤM BÒ MILK</b><small>TUYỂN DỤNG</small></span></div>
${opts?.badge ? `<div class="pill ${tone}"><i></i>${escapeHtml(opts.badge)}</div>` : ''}
<h1>${escapeHtml(title)}</h1>
<div class="lede">${bodyHtml}</div>
</div>
<div class="body">
${infoHtml}
${ctx ? `<div class="actions"><button class="btn confirm" id="bOk">${RSVP_ICONS.check} Xác nhận tham gia</button><button class="btn decline" id="bNo" type="button">${RSVP_ICONS.x} Từ chối tham gia</button>
<div class="declineBox" id="declineBox"><label for="declineReason">Lý do từ chối (bắt buộc)</label>
<textarea id="declineReason" rows="3" maxlength="500" placeholder="VD: bận việc gia đình, đã tìm được việc khác, lịch không phù hợp..."></textarea>
<div class="sec">Đề xuất lịch mới <span class="opt">(không bắt buộc)</span></div>
<label for="propDate">Chọn ngày tham gia phỏng vấn</label>
<input type="date" id="propDate" min="${vnToday}" />
<div class="slotGroup">Buổi sáng · 08:00 – 11:30</div>
<div class="slotWrap" id="slotSang">${slotButtons('SANG')}</div>
<div class="slotGroup">Buổi chiều · 13:30 – 16:30</div>
<div class="slotWrap" id="slotChieu">${slotButtons('CHIEU')}</div>
<div class="slotHint" id="slotHint">Chọn ngày để xem khung giờ còn trống — khung đã có ứng viên khác đặt sẽ bị gạch, không chọn được.</div>
<label for="declineNote" style="margin-top:12px">Ghi chú (nếu có)</label>
<textarea id="declineNote" rows="2" maxlength="500" placeholder="VD: chỉ rảnh buổi chiều, muốn dời sang tuần sau..."></textarea>
<button class="btn send" id="bSendNo" type="button" disabled>Gửi từ chối</button></div><div class="msg" id="msg"></div></div>
<script>const tk=${JSON.stringify(ctx.token)};
const reasonEl=document.getElementById('declineReason'),sendNo=document.getElementById('bSendNo'),msgEl=document.getElementById('msg'),okBtn=document.getElementById('bOk'),noBtn=document.getElementById('bNo');
const propDate=document.getElementById('propDate'),declineBox=document.getElementById('declineBox'),slotHint=document.getElementById('slotHint'),noteEl=document.getElementById('declineNote');
const slotBtns=Array.prototype.slice.call(document.querySelectorAll('.slot'));
const HINT_IDLE='Chọn ngày để xem khung giờ còn trống — khung đã có ứng viên khác đặt sẽ bị gạch, không chọn được.';
let pickedTime='',loadSeq=0;
function syncSend(){sendNo.disabled=!reasonEl.value.trim();}
async function post(body){const r=await fetch('./rsvp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Lỗi');return j;}
function clearPicked(){pickedTime='';slotBtns.forEach(function(b){b.classList.remove('on');});}
function pickSlot(b){clearPicked();b.classList.add('on');pickedTime=b.getAttribute('data-time');slotHint.textContent='Bạn chọn '+pickedTime+' — HR sẽ xem xét và gửi lại thư mời xác nhận.';}
slotBtns.forEach(function(b){b.addEventListener('click',function(){if(!b.disabled)pickSlot(b);});});
function resetSlots(){clearPicked();slotBtns.forEach(function(b){b.disabled=false;b.removeAttribute('title');});}
function paintSlots(slots){
if(!slots||!slots.length){resetSlots();slotHint.textContent='Không có khung giờ phù hợp ngày này — vui lòng chọn ngày khác.';return;}
const byTime={};slots.forEach(function(s){byTime[s.time]=s;});
slotBtns.forEach(function(b){const s=byTime[b.getAttribute('data-time')];
if(!s){b.disabled=false;b.removeAttribute('title');return;}
b.disabled=!!s.disabled;
if(s.disabled){b.title=s.reason==='TAKEN'?'Khung này đã có ứng viên khác đặt lịch':'Khung này đã qua giờ';}else{b.removeAttribute('title');}});
if(pickedTime&&(!byTime[pickedTime]||byTime[pickedTime].disabled))clearPicked();
else if(pickedTime){const keep=slotBtns.filter(function(b){return b.getAttribute('data-time')===pickedTime;})[0];if(keep)keep.classList.add('on');}}
async function loadSlots(){const d=propDate.value,seq=++loadSeq;
if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){resetSlots();slotHint.textContent=HINT_IDLE;return;}
slotHint.textContent='⏳ Đang tải khung giờ...';
try{const r=await fetch('./rsvp/slots?token='+encodeURIComponent(tk)+'&date='+encodeURIComponent(d));const j=await r.json().catch(()=>({}));if(seq!==loadSeq)return;if(!r.ok)throw new Error(j.error||'Không tải được khung giờ');
const slots=j.slots||[];paintSlots(slots);const free=slots.filter(function(s){return !s.disabled;}).length;
if(pickedTime){slotHint.textContent='Bạn chọn '+pickedTime+' — HR sẽ xem xét và gửi lại thư mời xác nhận.';}
else{slotHint.textContent=free>0?('Còn '+free+' khung trống — chạm vào khung giờ bạn muốn. Khung gạch chéo là đã kín hoặc đã qua giờ.'):'Ngày này đã kín lịch — vui lòng chọn ngày khác.';}}
catch(e){if(seq!==loadSeq)return;resetSlots();slotHint.textContent='⚠️ '+e.message+' — bạn vẫn chọn được khung giờ bên trên, HR sẽ kiểm tra lại khi chốt lịch.';}}
['change','input','blur'].forEach(function(ev){propDate.addEventListener(ev,loadSlots);});
reasonEl.addEventListener('input',syncSend);
okBtn.onclick=async()=>{msgEl.textContent='⏳ Đang gửi...';try{await post({token:tk,decision:'CONFIRM'});msgEl.textContent='🎉 Đã xác nhận tham gia! HR sẽ giữ lịch cho bạn. Hẹn gặp bạn đúng giờ nhé.';okBtn.textContent='✅ Đã xác nhận tham gia';okBtn.disabled=true;noBtn.style.display='none';document.getElementById('declineBox').classList.remove('show');}catch(e){msgEl.textContent='⚠️ '+e.message;}};
noBtn.onclick=()=>{declineBox.classList.toggle('show');if(declineBox.classList.contains('show')){reasonEl.focus();loadSlots();}};
if(/^\d{4}-\d{2}-\d{2}$/.test(propDate.value))loadSlots();
sendNo.onclick=async()=>{const reason=reasonEl.value.trim();if(!reason){msgEl.textContent='⚠️ Vui lòng nhập lý do từ chối trước khi gửi.';return;}
const d=propDate.value;if(pickedTime&&!d){msgEl.textContent='⚠️ Bạn đã chọn khung giờ nhưng chưa chọn ngày — vui lòng chọn ngày phỏng vấn mong muốn.';return;}
if(d&&!pickedTime){msgEl.textContent='⚠️ Bạn đã chọn ngày nhưng chưa chọn khung giờ — chạm vào 1 khung giờ bên trên (hoặc xóa ngày nếu không đề xuất).';return;}
const body={token:tk,decision:'DECLINE',reason};const hasProposal=!!(d&&pickedTime);
if(hasProposal){body.proposedDate=d;body.proposedTime=pickedTime;const n=noteEl.value.trim();if(n)body.proposedNote=n;}
msgEl.textContent='⏳ Đang gửi...';
try{await post(body);msgEl.textContent=hasProposal?'📝 Đã ghi nhận. HR sẽ xem xét đề xuất lịch mới của bạn và gửi lại thư mời — chú ý tin nhắn Zalo trước giờ hẹn 30 phút.':'📝 Đã ghi nhận từ chối. Cảm ơn bạn đã dành thời gian ứng tuyển — HR sẽ xem xét lý do của bạn.';
sendNo.disabled=true;reasonEl.disabled=true;propDate.disabled=true;noteEl.disabled=true;slotBtns.forEach(function(b){b.disabled=true;});okBtn.style.display='none';noBtn.style.display='none';}catch(e){msgEl.textContent='⚠️ '+e.message;}};</script>` : ''}
<div class="foot">${RSVP_ICONS.lock}<span>Trang xác nhận riêng cho ứng viên • Không cần đăng nhập</span></div>
</div>
</div></body></html>`;
}
