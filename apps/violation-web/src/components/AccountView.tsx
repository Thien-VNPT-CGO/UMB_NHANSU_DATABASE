import React from 'react';
import {
  BadgeCheck,
  CalendarClock,
  Clock3,
  Crown,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { AuthResult, ViolationAccount } from '../types';
import { ViewHeader, formatDateTime, initials } from './ui';
import { PinChangeView } from './PinChangeView';

interface Props {
  account: ViolationAccount;
  knownPin: string;
  onChanged: (result: AuthResult, newPin: string) => void;
  onReset: (message: string) => void;
  onLogout: () => void;
}

export function AccountView({ account, knownPin, onChanged, onReset, onLogout }: Props) {
  const isAdmin = account.role === 'ADMIN';
  const capabilities = account.capabilities || [];

  return (
    <div className="view account-view">
      <ViewHeader
        eyebrow={
          <>
            <UserRound size={13} /> TÀI KHOẢN &amp; BẢO MẬT
          </>
        }
        title={isAdmin ? 'Hồ sơ thẩm phán tối cao' : 'Hồ sơ nhân viên lập phiếu'}
        description={
          isAdmin
            ? 'Thông tin phiên làm việc, quyền hạn hệ thống và mã PIN bảo vệ cổng điều hành.'
            : 'Thông tin phiên làm việc, quyền lập phiếu vi phạm và mã PIN bảo vệ tài khoản.'
        }
      />

      <div className="account-layout">
        <div className="account-column">
          <section className="panel account-card">
            <div className="account-identity">
              <span className="profile-avatar">{initials(account.display_name)}</span>
              <div>
                <span className="eyebrow">
                  <Crown size={13} /> {isAdmin ? 'TÒA ÁN TỐI CAO' : 'NHÂN VIÊN LẬP PHIẾU'}
                </span>
                <h2>{account.display_name}</h2>
                <p>{account.system_name}</p>
              </div>
              <span className="profile-seal">
                <ShieldCheck size={16} /> Đã xác thực
              </span>
            </div>

            <div className="profile-meta-grid">
              <div className="profile-meta">
                <span>Mã tài khoản</span>
                <strong>{account.account_id}</strong>
              </div>
              <div className="profile-meta">
                <span>
                  <LockKeyhole size={13} /> Trạng thái PIN
                </span>
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
                  <Landmark size={13} /> Chức danh
                </span>
                <strong>{isAdmin ? 'Thẩm phán tối cao' : 'Nhân viên lập phiếu'}</strong>
              </div>
              <div className="profile-meta">
                <span>
                  <BadgeCheck size={13} /> Phiên làm việc
                </span>
                <strong>12 giờ / phiên</strong>
              </div>
            </div>

            {account.reset_at ? (
              <div className="alert alert-gold">
                <LockKeyhole size={18} />
                <span>
                  Mã PIN đã được cấp lại lúc <strong>{formatDateTime(account.reset_at)}</strong>. Hãy đổi sang mã PIN
                  riêng ngay khi đăng nhập.
                </span>
              </div>
            ) : null}
          </section>

          <section className="panel account-capabilities">
            <div className="panel-head">
              <div>
                <span className="eyebrow">
                  <ShieldCheck size={13} /> QUYỀN HẠN
                </span>
                <h3>Thẩm quyền được cấp</h3>
              </div>
              <span className="count-chip">{capabilities.length}</span>
            </div>
            <div className="capability-list">
              {capabilities.map(capability => (
                <div key={capability.code} className="capability-line">
                  <span className="capability-dot" />
                  <div>
                    <strong>{capability.name}</strong>
                    <span>{capability.description}</span>
                  </div>
                </div>
              ))}
              {capabilities.length === 0 ? (
                <p className="list-footnote">Chưa tải được danh sách quyền hạn. Vui lòng tải lại trang.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="account-column">
          <PinChangeView
            account={account}
            knownPin={knownPin}
            onChanged={onChanged}
            onReset={onReset}
            onLogout={onLogout}
          />
        </div>
      </div>
    </div>
  );
}
