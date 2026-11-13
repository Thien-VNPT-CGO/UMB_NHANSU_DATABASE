import React from 'react';
import {
  BadgeCheck,
  BookOpenCheck,
  CalendarClock,
  Clock3,
  CloudUpload,
  Crown,
  Gavel,
  KeyRound,
  Landmark,
  LockKeyhole,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { Capability, ViolationAccount } from '../types';
import { ViewHeader, formatDateTime, initials } from './ui';

interface Props {
  account: ViolationAccount;
}

const CAPABILITY_ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  REGULATIONS_VIEW: BookOpenCheck,
  VIOLATION_CREATE: Gavel,
  VIOLATION_DRAFT: Clock3,
  VIOLATION_APPROVE: BadgeCheck,
  VIOLATION_ADJUST_FINE: Wallet,
  REGULATIONS_MANAGE: Settings2,
  PAYROLL_KPI_SYNC: TrendingDown,
  DRIVE_ARCHIVE: CloudUpload,
  ACCOUNT_SECURITY: KeyRound,
  PERSONAL_SOVEREIGNTY: Crown,
};

function CapabilityCard({ capability, index }: { capability: Capability; index: number }) {
  const Icon = CAPABILITY_ICONS[capability.code] || ShieldCheck;
  return (
    <article className="capability-card">
      <div className="capability-top">
        <span className="capability-icon">
          <Icon size={18} />
        </span>
        <span className="capability-index">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <strong>{capability.name}</strong>
      <p>{capability.description}</p>
      <span className="capability-code">{capability.code}</span>
    </article>
  );
}

export function ProfileView({ account }: Props) {
  const capabilities = account.capabilities || [];

  return (
    <div className="view">
      <ViewHeader
        eyebrow={
          <>
            <UserRound size={13} /> THÔNG TIN CÁ NHÂN
          </>
        }
        title="Hồ sơ thẩm quyền tối cao"
        description="Toàn bộ quyền hạn, dấu ấn phiên làm việc và trạng thái bảo mật của tài khoản điều hành hệ thống vi phạm."
      />

      <section className="profile-hero">
        <div className="profile-identity">
          <div className="profile-avatar">{initials(account.display_name)}</div>
          <div>
            <span className="eyebrow">
              <Crown size={13} /> TÒA ÁN TỐI CAO
            </span>
            <h2>{account.display_name}</h2>
            <p>{account.system_name}</p>
          </div>
        </div>
        <div className="profile-role">
          <span className="profile-role-icon">
            <Landmark size={24} />
          </span>
          <div>
            <span>Chức danh hệ thống</span>
            <strong>Thẩm phán tối cao — Toàn quyền</strong>
          </div>
        </div>
        <div className="profile-seal">
          <ShieldCheck size={20} />
          <span>ĐÃ XÁC THỰC</span>
        </div>
      </section>

      <div className="profile-meta-grid">
        <div className="profile-meta">
          <span>Mã tài khoản</span>
          <strong>{account.account_id}</strong>
        </div>
        <div className="profile-meta">
          <span>Trạng thái PIN</span>
          <strong className={account.must_change_pin ? 'text-amber' : 'text-green'}>
            {account.must_change_pin ? 'Cần đổi PIN' : 'PIN bảo mật'}
          </strong>
        </div>
        <div className="profile-meta">
          <span>
            <Clock3 size={13} /> Đăng nhập gần nhất
          </span>
          <strong>{formatDateTime(account.last_login_at)}</strong>
        </div>
        <div className="profile-meta">
          <span>
            <CalendarClock size={13} /> Ngày tạo tài khoản
          </span>
          <strong>{formatDateTime(account.created_at)}</strong>
        </div>
        <div className="profile-meta">
          <span>
            <LockKeyhole size={13} /> Thời hạn phiên
          </span>
          <strong>12 giờ / phiên</strong>
        </div>
        <div className="profile-meta">
          <span>
            <Sparkles size={13} /> Cập nhật gần nhất
          </span>
          <strong>{formatDateTime(account.updated_at)}</strong>
        </div>
      </div>

      {account.reset_at ? (
        <div className="alert alert-gold">
          <KeyRound size={18} />
          <span>
            Mã PIN đã được cấp lại lúc <strong>{formatDateTime(account.reset_at)}</strong>. Hãy đổi sang mã PIN riêng
            ngay khi đăng nhập.
          </span>
        </div>
      ) : null}

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              <Crown size={13} /> TOÀN QUYỀN HỆ THỐNG
            </span>
            <h2>Thẩm quyền tối cao</h2>
          </div>
          <span className="section-note">{capabilities.length} quyền hạn được cấp</span>
        </div>

        <div className="capability-grid">
          {capabilities.map((capability, index) => (
            <CapabilityCard key={capability.code} capability={capability} index={index} />
          ))}
          {capabilities.length === 0 ? (
            <div className="capability-card">
              <strong>Chưa tải được danh sách quyền hạn</strong>
              <p>Vui lòng tải lại trang để đồng bộ từ máy chủ.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel profile-declaration">
        <div className="profile-declaration-icon">
          <Landmark size={26} />
        </div>
        <div>
          <span className="eyebrow">TUYÊN BỐ THẨM QUYỀN</span>
          <p>
            Tài khoản này nắm toàn bộ quyền điều hành hệ thống kiểm soát &amp; xử lý vi phạm: ban hành và điều chỉnh
            quy chế, ghi nhận lỗi, ấn định mức phạt, duyệt phiếu, lưu trữ PDF trên Google Drive, cấn trừ KPI vào kỳ
            lương và quản trị mã PIN tối cao. Mọi thao tác đều được ghi nhận thời gian và người thực hiện.
          </p>
          <div className="declaration-tags">
            <span className="pill pill-gold">Toàn quyền quy chế</span>
            <span className="pill pill-gold">Toàn quyền phán quyết</span>
            <span className="pill pill-gold">Toàn quyền KPI</span>
            <span className="pill pill-gold">Toàn quyền lưu trữ</span>
            <span className="pill pill-gold">Toàn quyền bảo mật</span>
          </div>
        </div>
      </section>
    </div>
  );
}
