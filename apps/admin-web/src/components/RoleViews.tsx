import React, { useState } from 'react';
import {
  Users,
  Calendar,
  Clock,
  DollarSign,
  Megaphone,
  Shield,
  Bell,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  Plus,
  Send,
  Building2,
  ChevronRight,
  Database,
  Lock,
  Unlock,
  Settings,
  HardDrive,
  Activity,
  Sliders,
  FileCheck,
  Search,
  Filter,
  RefreshCw,
  Info,
  UserCheck,
  Store,
  FileText,
  CreditCard,
  Radio,
  FileSpreadsheet,
  Award,
  Sparkles,
  MapPin,
  Camera,
  RadioTower,
  Eye,
  QrCode,
  MessageSquare,
  Bot,
  Smartphone,
} from 'lucide-react';
import { getDisplayBranch } from '../App';

interface RoleViewsProps {
  activeTab: string;
  currentUser: any;
  allEmployees: any[];
  activationDataList: any[];
  candidates: any[];
  shifts: any[];
  leaves: any[];
  payrollRuns: any[];
  branches: any[];
  systemNotifications: any[];
  showToast: (msg: string) => void;
  openNewEmpModal: () => void;
  openBroadcastModal: () => void;
}

export const RoleViews: React.FC<RoleViewsProps> = ({
  activeTab,
  currentUser,
  allEmployees,
  activationDataList,
  candidates,
  shifts,
  leaves,
  payrollRuns,
  branches,
  systemNotifications,
  showToast,
  openNewEmpModal,
  openBroadcastModal,
}) => {
  const branchScope = currentUser?.branchScope || '*';
  const branchName = branchScope === '*' ? 'Toàn Hệ Thống' : getDisplayBranch(branchScope);

  // Filters for HR Schedule
  const [scheduleBranchFilter, setScheduleBranchFilter] = useState('ALL');
  const [scheduleStageFilter, setScheduleStageFilter] = useState('ALL');
  const [selectedRealtimeModal, setSelectedRealtimeModal] = useState<any>(null);

  // Zalo Personal QR & Bot State for HR
  const [zaloConnected, setZaloConnected] = useState(true);
  const [selectedZaloMsg, setSelectedZaloMsg] = useState<any>(null);
  const [autoZaloBotEnabled, setAutoZaloBotEnabled] = useState(true);

  // Filter employees for Store
  const storeEmployees = allEmployees.filter(
    (e) => branchScope === '*' || e.default_branch_id === branchScope || e.branch_id === branchScope
  );

  // =========================================================================
  // HR VIEWS (15 TABS)
  // =========================================================================
  if (activeTab === 'hr-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>1. Dashboard Quản Trị Nhân Sự (HR)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Vận hành tuyển dụng, thử việc, đánh giá chính thức, lịch làm việc và chấm công</p>
          </div>
          <button className="btn-primary" onClick={openNewEmpModal} style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> Tiếp Nhận Ứng Viên / Thêm NV Mới
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ỨNG VIÊN MỚI TUYỂN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>{candidates.length || 8}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Cần xếp lịch phỏng vấn</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NHÂN VIÊN THỬ VIỆC</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>
              {allEmployees.filter((e) => e.employment_status === 'PROBATION').length || 6}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Chu kỳ thử việc 12 ngày</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHÍNH THỨC ĐẠT CHUẨN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>
              {allEmployees.filter((e) => e.employment_status === 'OFFICIAL').length || 24}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đang hoạt động trên 4 CN</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>YÊU CẦU CẦN DUYỆT</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#D97706', marginTop: '6px' }}>{leaves.length || 3}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đơn OFF & Đổi ca đang chờ</div>
          </div>
        </div>

        {/* Action List Table */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '14px' }}>
            Nhiệm Vụ HR Cần Xử Lý Ngay Hôm Nay
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Hạng Mục</th>
                <th style={{ padding: '12px 20px' }}>Đối Tượng / Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian</th>
                <th style={{ padding: '12px 20px' }}>Hành Động</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700, color: '#2563EB' }}>Phỏng Vấn Mới</td>
                <td style={{ padding: '14px 20px' }}>Nguyễn Thu Trang (Vị trí Barista)</td>
                <td style={{ padding: '14px 20px' }}>Chi Nhánh 130</td>
                <td style={{ padding: '14px 20px' }}>14:30 Chiều nay (Google Meet)</td>
                <td style={{ padding: '14px 20px' }}><button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast('Mở phòng phỏng vấn Meet')}>Bắt Đầu Phỏng Vấn</button></td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>Xét Chuyển Chính Thức</td>
                <td style={{ padding: '14px 20px' }}>Nguyễn Văn An (UBM_NV0482)</td>
                <td style={{ padding: '14px 20px' }}>Chi Nhánh 130</td>
                <td style={{ padding: '14px 20px' }}>Đạt 9.2/10 bài TEST đầu ra</td>
                <td style={{ padding: '14px 20px' }}><button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast('Đã ký quyết định chuyển chính thức cho NV An!')}>Ký Quyết Định</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-candidates') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>2. Danh Sách Ứng Viên Mới (Google Forms)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Dữ liệu tự động đồng bộ từ FROM_NHAN_VIEN về trang tính tuyển dụng</p>
          </div>
          <button className="btn-primary" onClick={() => showToast('Đã đồng bộ ứng viên từ Google Sheets')}>Đồng Bộ Sheets</button>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Số Điện Thoại</th>
                <th style={{ padding: '12px 20px' }}>Vị Trí Ứng Tuyển</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh Mong Muốn</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Phạm Hải Yến', phone: '0981234567', pos: 'Nhân viên Pha chế', branch: 'CN130', status: 'CHỜ PHỎNG VẤN' },
                { name: 'Đỗ Minh Quân', phone: '0977889900', pos: 'Nhân viên Bán hàng', branch: 'CN120', status: 'MỚI ỨNG TUYỂN' },
                { name: 'Vũ Thị Lan', phone: '0912334455', pos: 'Nhân viên Phụ kho', branch: 'Xưởng Củ Chi', status: 'ĐÃ DUYỆT HỒ SƠ' },
              ].map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: 700 }}>{c.name}</td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{c.phone}</td>
                  <td style={{ padding: '14px 20px' }}>{c.pos}</td>
                  <td style={{ padding: '14px 20px' }}>{c.branch}</td>
                  <td style={{ padding: '14px 20px' }}><span className="badge badge-brand">{c.status}</span></td>
                  <td style={{ padding: '14px 20px' }}>
                    <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast(`Tạo lịch phỏng vấn cho ${c.name}`)}>Tạo Phỏng Vấn</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-interviews') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Quản Lý Lịch Phỏng Vấn & BOT Zalo Cá Nhân</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Tích hợp Zalo cá nhân của HR qua mã QR, BOT hệ thống tự động sinh link Google Meet và tự động gửi thư mời kèm lịch hẹn đến Zalo ứng viên
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#0068FF' }}
            onClick={() => showToast('Đang làm mới phiên kết nối Zalo cá nhân của HR...')}
          >
            <Smartphone size={16} />
            Phiên Zalo: Trần Thị Mai (Đang Kết Nối)
          </button>
        </div>

        {/* ========================================================================= */}
        {/* KHUNG TÍCH HỢP ZALO CÁ NHÂN CỦA HR (QUÉT MÃ QR & KÍCH HOẠT BOT TỰ ĐỘNG) */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '2px solid #0068FF',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}>
          <div style={{
            backgroundColor: '#0068FF',
            color: '#FFF',
            padding: '12px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, fontSize: '14px' }}>
              <QrCode size={20} color="#FFF" />
              TÍCH HỢP ZALO CÁ NHÂN CỦA HR (QUÉT QR ĐĂNG NHẬP & KÍCH HOẠT BOT GỬI THƯ MỜI)
            </div>
            <span style={{
              backgroundColor: '#10B981',
              color: '#FFF',
              fontSize: '11px',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '999px',
            }}>
              ● BOT ZALO CÁ NHÂN ĐANG HOẠT ĐỘNG
            </span>
          </div>

          <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px' }}>
            {/* CỘT TRÁI: MÃ QR QUÉT ZALO CÁ NHÂN & THÔNG TIN TÀI KHOẢN HR */}
            <div style={{
              backgroundColor: '#F8FAFC',
              border: '1.5px dashed #0068FF',
              borderRadius: '10px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0068FF', marginBottom: '10px', textTransform: 'uppercase' }}>
                Mã QR Đăng Nhập Zalo Cá Nhân HR
              </div>

              {/* MÔ PHỎNG QR CODE ZALO SẮC NÉT */}
              <div style={{
                width: '150px',
                height: '150px',
                backgroundColor: '#FFF',
                border: '2px solid #E2E8F0',
                borderRadius: '8px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                position: 'relative',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '4px',
                  width: '100%',
                  height: '100%',
                }}>
                  {[...Array(25)].map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: (idx % 2 === 0 || idx % 5 === 0 || idx === 12) ? '#0F172A' : '#E2E8F0',
                        borderRadius: '2px',
                      }}
                    />
                  ))}
                </div>
                {/* Logo Zalo giữa QR */}
                <div style={{
                  position: 'absolute',
                  backgroundColor: '#0068FF',
                  color: '#FFF',
                  fontSize: '11px',
                  fontWeight: 900,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }}>
                  Zalo
                </div>
              </div>

              <div style={{ marginTop: '12px', width: '100%' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A' }}>
                  Trần Thị Mai (HR Lead)
                </div>
                <div style={{ fontSize: '12px', color: '#0068FF', fontWeight: 600 }}>
                  Zalo: 0989.234.888
                </div>
                <div style={{
                  marginTop: '8px',
                  backgroundColor: '#DCFCE7',
                  border: '1px solid #86EFAC',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  fontSize: '11px',
                  color: '#166534',
                  fontWeight: 700,
                }}>
                  ✓ Đã Quét QR & Kết Nối Thành Công
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1, fontSize: '11px', padding: '6px' }}
                    onClick={() => showToast('Mã QR Zalo đã được làm mới. Vui lòng quét lại trên điện thoại!')}
                  >
                    Quét Lại QR
                  </button>
                  <button
                    className="btn-outline"
                    style={{ flex: 1, fontSize: '11px', padding: '6px', color: '#DC2626' }}
                    onClick={() => showToast('Đã đăng xuất phiên Zalo cá nhân!')}
                  >
                    Đăng Xuất
                  </button>
                </div>
              </div>
            </div>

            {/* CỘT PHẢI: CƠ CHẾ BOT TỰ ĐỘNG SINH GOOGLE MEET & GỬI QUA ZALO CÁ NHÂN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '8px',
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Bot size={18} color="#0068FF" />
                  <strong style={{ fontSize: '13px', color: '#1E40AF', textTransform: 'uppercase' }}>
                    Cơ Chế Hoạt Động Của BOT Hệ Thống:
                  </strong>
                </div>
                <div style={{ fontSize: '12px', color: '#1E3A8A', lineHeight: '1.6' }}>
                  1. <strong>Tự động sinh Google Meet:</strong> Khi HR tạo lịch phỏng vấn, hệ thống tự động gọi API sinh phòng họp Google Meet bảo mật riêng biệt.<br />
                  2. <strong>Liên kết Zalo cá nhân của HR:</strong> BOT tự động kích hoạt phiên Zalo cá nhân <strong>Trần Thị Mai (0989.234.888)</strong> mà HR đã quét QR đăng nhập trước đó.<br />
                  3. <strong>Bắn tin nhắn thư mời chuyên nghiệp:</strong> BOT tự động gửi tin nhắn trang trọng kèm lịch hẹn, link Google Meet và hướng dẫn phỏng vấn trực tiếp đến Zalo của ứng viên mà HR không cần thao tác thủ công.
                </div>
              </div>

              {/* XEM TRƯỚC MẪU TIN NHẮN ZALO BOT TỰ ĐỘNG GỬI */}
              <div style={{
                backgroundColor: '#F1F5F9',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MessageSquare size={15} color="#0068FF" />
                    Xem Trước Mẫu Tin Nhắn Zalo BOT Tự Động Bắn Đi:
                  </div>
                  <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>
                    Gửi từ: Zalo Trần Thị Mai (0989.234.888)
                  </span>
                </div>

                <div style={{
                  backgroundColor: '#FFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: '#1E293B',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}>
                  <strong style={{ color: '#0068FF' }}>[ỤM BÒ MILK] THƯ MỜI PHỎNG VẤN VỊ TRÍ NHÂN VIÊN PHA CHẾ</strong><br />
                  Chào bạn <strong>Phạm Hải Yến</strong>,<br />
                  Phòng Nhân Sự Ụm Bò Milk trân trọng mời bạn tham gia buổi phỏng vấn trực tuyến:<br />
                  🕒 <strong>Thời gian:</strong> 14:30 - Thứ Năm, 24/09/2026 (Thời lượng: 30 phút)<br />
                  📍 <strong>Chi nhánh tuyển dụng:</strong> CN130 - Cách Mạng Tháng 8, Q.3, TP.HCM<br />
                  🔗 <strong>Link phòng họp Google Meet:</strong> <span style={{ color: '#0068FF', textDecoration: 'underline' }}>https://meet.google.com/ubm-interview-130</span><br />
                  👤 <strong>Người phỏng vấn:</strong> Trần Thị Mai (HR Lead - Zalo này)<br />
                  📌 <em>Lưu ý: Bạn vui lòng vào trước 5 phút và chuẩn bị trang phục lịch sự nhé.</em><br />
                  <span style={{ fontSize: '11px', color: '#64748B', display: 'block', marginTop: '6px' }}>
                    ✓✓ Đã gửi tự động qua Zalo cá nhân của HR lúc 14:31:05 [Đã nhận]
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* FORM TẠO LỊCH PHỎNG VẤN & PHÁT LỆNH BOT ZALO */}
        {/* ========================================================================= */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1.5px solid #2563EB',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}>
          <div style={{
            backgroundColor: '#1E40AF',
            color: '#FFF',
            padding: '12px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
              <Calendar size={18} color="#93C5FD" />
              THIẾT LẬP LỊCH PHỎNG VẤN ỨNG VIÊN MỚI (TÍCH HỢP BOT ZALO CÁ NHÂN)
            </div>
            <span style={{ fontSize: '11px', backgroundColor: '#3B82F6', padding: '3px 8px', borderRadius: '4px' }}>
              Quy chuẩn 30 phút / ca
            </span>
          </div>

          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Chọn ứng viên mới:</label>
                <select style={{ width: '100%' }} defaultValue="Phạm Hải Yến">
                  <option value="Phạm Hải Yến">Phạm Hải Yến (0981234567) - Pha chế</option>
                  <option value="Nguyễn Thu Trang">Nguyễn Thu Trang (0912345678) - Thu ngân</option>
                  <option value="Trần Đình Trọng">Trần Đình Trọng (0933445566) - Phục vụ</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Chi nhánh tuyển dụng:</label>
                <select style={{ width: '100%' }} defaultValue="CN130">
                  <option value="CN130">CN130 - Cách Mạng Tháng 8</option>
                  <option value="CN120">CN120 - Điện Biên Phủ</option>
                  <option value="CN261">CN261 - Võ Văn Ngân</option>
                  <option value="CN111">CN111 - Phan Đăng Lưu</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Thời gian phỏng vấn:</label>
                <input type="datetime-local" defaultValue="2026-09-24T14:30" style={{ width: '100%' }} />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Hình thức phỏng vấn:</label>
                <select style={{ width: '100%' }} defaultValue="ONLINE">
                  <option value="ONLINE">Google Meet Trực Tuyến (BOT tự sinh)</option>
                  <option value="OFFLINE">Trực Tiếp Tại Cửa Hàng</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr', gap: '14px', alignItems: 'center' }}>
              <div style={{
                fontSize: '12px',
                color: '#1E40AF',
                backgroundColor: '#EFF6FF',
                padding: '10px 14px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <Bot size={18} color="#0068FF" />
                <span>
                  ☑️ <strong>Kích hoạt BOT tự động:</strong> Tự động sinh link Google Meet + Dùng Zalo cá nhân của HR (Trần Thị Mai) để gửi thư mời phỏng vấn đến Zalo ứng viên!
                </span>
              </div>
              <button
                className="btn-primary"
                style={{
                  backgroundColor: '#0068FF',
                  padding: '11px',
                  fontWeight: 800,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
                onClick={() => showToast('🚀 BOT đã sinh link Meet và tự động gửi thư mời phỏng vấn từ Zalo cá nhân của HR (Trần Thị Mai) đến ứng viên Phạm Hải Yến (0981234567)!')}
              >
                <Send size={16} />
                Tạo Lịch & BOT Bắn Tin Zalo Cá Nhân
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* DANH SÁCH LỊCH PHỎNG VẤN & TRẠNG THÁI GỬI QUA ZALO CÁ NHÂN */}
        {/* ========================================================================= */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Lịch Phỏng Vấn Tuyển Dụng Đã Lên Lịch & Trạng Thái Gửi Zalo</strong>
            <span className="badge" style={{ backgroundColor: '#EFF6FF', color: '#0068FF', fontWeight: 800 }}>
              ĐÃ ĐỒNG BỘ BOT ZALO CÁ NHÂN
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Ứng Viên</th>
                <th style={{ padding: '12px 20px' }}>Vị Trí & Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian</th>
                <th style={{ padding: '12px 20px' }}>Google Meet Sinh Tự Động</th>
                <th style={{ padding: '12px 20px' }}>Kênh Gửi Zalo Cá Nhân</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#F8FAFC' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Phạm Hải Yến
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>0981234567 • Zalo: Yến Trang</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong>Nhân viên Pha chế</strong>
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>CN130 - Cách Mạng Tháng 8</div>
                </td>
                <td style={{ padding: '14px 20px', fontWeight: 700, color: '#DC2626' }}>
                  14:30 - 24/09/2026
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Thời lượng: 30 phút</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <a
                    href="https://meet.google.com/ubm-interview-130"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#0068FF', textDecoration: 'none', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    meet.google.com/ubm-interview-130
                  </a>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{
                    backgroundColor: '#EFF6FF',
                    color: '#0068FF',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 800,
                    border: '1px solid #BFDBFE',
                  }}>
                    💬 Zalo Cá Nhân Mai (0989.234.888)
                  </span>
                  <div style={{ fontSize: '11px', color: '#059669', marginTop: '3px' }}>✓ BOT đã gửi lúc 14:31</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#DBEAFE', color: '#1E40AF', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                    ĐÃ GỬI ZALO & MEET
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '11px', backgroundColor: '#0068FF' }} onClick={() => showToast('Mở phòng Google Meet phỏng vấn')}>
                      Vào Meet
                    </button>
                    <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#059669' }} onClick={() => showToast('Đã đánh giá ĐẠT! Chuyển hồ sơ ứng viên sang Thử việc 12 ngày')}>
                      Duyệt Thử Việc
                    </button>
                  </div>
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Nguyễn Thu Trang
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>0912345678 • Zalo: Thu Trang</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong>Thu ngân & Bán hàng</strong>
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>CN120 - Điện Biên Phủ</div>
                </td>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  10:00 - 25/09/2026
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Thời lượng: 30 phút</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <a
                    href="https://meet.google.com/ubm-interview-120"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#0068FF', textDecoration: 'none', fontWeight: 700 }}
                  >
                    meet.google.com/ubm-interview-120
                  </a>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{
                    backgroundColor: '#EFF6FF',
                    color: '#0068FF',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 800,
                    border: '1px solid #BFDBFE',
                  }}>
                    💬 Zalo Cá Nhân Mai (0989.234.888)
                  </span>
                  <div style={{ fontSize: '11px', color: '#059669', marginTop: '3px' }}>✓ BOT đã gửi lúc 09:15</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                    CHỜ PHỎNG VẤN
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', color: '#059669' }} onClick={() => showToast('Duyệt đạt phỏng vấn')}>
                    Đánh Giá
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-probation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Quản Lý Nhân Viên Thử Việc (12 Ngày)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Theo dõi 12 ngày thử việc (7 làm / 5 OFF) và kết quả làm bài TEST</p>
          </div>
          <button className="btn-primary" onClick={openNewEmpModal}>+ Thêm NV Thử Việc</button>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Tiến Độ Thử Việc</th>
                <th style={{ padding: '12px 20px' }}>Điểm Bài TEST</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {allEmployees.filter((e) => e.employment_status === 'PROBATION').map((emp, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{emp.employee_code}</td>
                  <td style={{ padding: '14px 20px', fontWeight: 700 }}>{emp.full_name}</td>
                  <td style={{ padding: '14px 20px' }}>{getDisplayBranch(emp.default_branch_id)}</td>
                  <td style={{ padding: '14px 20px' }}>Ngày 6/12 (4 ca làm, 2 OFF)</td>
                  <td style={{ padding: '14px 20px' }}><span className="badge badge-success">9.2 / 10 (Đạt)</span></td>
                  <td style={{ padding: '14px 20px' }}>
                    <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast(`Đã đề xuất chuyển chính thức cho ${emp.full_name}`)}>Đề Xuất Chính Thức</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-official') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Danh Sách Nhân Viên Chính Thức</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>SĐT</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Mức Lương Giờ</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              {allEmployees.filter((e) => e.employment_status === 'OFFICIAL').map((emp, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{emp.employee_code}</td>
                  <td style={{ padding: '14px 20px', fontWeight: 700 }}>{emp.full_name}</td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{emp.phone_normalized}</td>
                  <td style={{ padding: '14px 20px' }}>{getDisplayBranch(emp.default_branch_id)}</td>
                  <td style={{ padding: '14px 20px', fontWeight: 700, color: '#10B981' }}>25.000 đ/h</td>
                  <td style={{ padding: '14px 20px' }}><span className="badge badge-success">CHÍNH THỨC</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-conversion') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Xét Duyệt & Quyết Định Chuyển Chính Thức</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>Nhân sự đủ điều kiện chuyển chính thức:</div>
          <div style={{ padding: '12px', backgroundColor: '#FDF2F8', border: '1px solid #F472B6', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Nguyễn Văn An (UBM_NV0482)</strong> • Điểm TEST: 9.2/10 • Ngày công: 7/7 ca • Đi trễ: 0 lần
            </div>
            <button className="btn-primary" onClick={() => showToast('Đã ban hành Quyết định Chuyển Chính Thức! Lương áp dụng 25.000 đ/h')}>
              Ký Quyết Định (Effective 01/10/2026)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-schedule') {
    // Schedule mock data with Probation & Official employees
    const scheduleItems = [
      {
        empId: 'EMP_001',
        empCode: 'UBM_NV0482',
        name: 'Nguyễn Văn An',
        stage: 'PROBATION',
        branch: 'CN130',
        t2: { shift: 'Ca 1 (07-12)', status: 'COMPLETED', time: '06:55' },
        t3: { shift: 'Ca 1 (07-12)', status: 'CHECKED_IN', time: '06:55:12', gps: '38m', uniform: true, badge: true, isToday: true },
        t4: { shift: 'Ca 2 (12-18)', status: 'UPCOMING' },
        t5: { shift: 'Nghỉ OFF', status: 'OFF' },
        t6: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
        t7: { shift: 'Nghỉ OFF', status: 'OFF' },
        cn: { shift: 'Ca 2 (12-18)', status: 'UPCOMING' },
      },
      {
        empId: 'EMP_002',
        empCode: 'UBM_NV1205',
        name: 'Trần Thị Bình',
        stage: 'OFFICIAL',
        branch: 'CN130',
        t2: { shift: 'Ca 1 (07-12)', status: 'COMPLETED', time: '06:58' },
        t3: { shift: 'Ca 1 (07-12)', status: 'CHECKED_IN', time: '06:58:30', gps: '42m', uniform: true, badge: true, isToday: true },
        t4: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
        t5: { shift: 'Nghỉ OFF', status: 'OFF' },
        t6: { shift: 'Ca 2 (12-18)', status: 'UPCOMING' },
        t7: { shift: 'Ca 2 (12-18)', status: 'UPCOMING' },
        cn: { shift: 'Nghỉ OFF', status: 'OFF' },
      },
      {
        empId: 'EMP_003',
        empCode: 'UBM_NV8312',
        name: 'Lê Hoàng Cúc',
        stage: 'OFFICIAL',
        branch: 'CN130',
        t2: { shift: 'Ca 2 (12-18)', status: 'COMPLETED', time: '11:55' },
        t3: { shift: 'Ca 2 (12-18)', status: 'PENDING', isToday: true },
        t4: { shift: 'Nghỉ OFF', status: 'OFF' },
        t5: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
        t6: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
        t7: { shift: 'Nghỉ OFF', status: 'OFF' },
        cn: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
      },
      {
        empId: 'EMP_004',
        empCode: 'UBM_NV5541',
        name: 'Phạm Đức Dũng',
        stage: 'OFFICIAL',
        branch: 'CN130',
        t2: { shift: 'Ca 3 (18-23)', status: 'COMPLETED', time: '17:50' },
        t3: { shift: 'Ca 3 (18-23)', status: 'PENDING', isToday: true },
        t4: { shift: 'Ca 2 (12-18)', status: 'UPCOMING' },
        t5: { shift: 'Ca 2 (Nhận thay)', status: 'BONUS_SWAP', bonus: '+30.000đ', note: 'HR điều phối nhận thay cho NV A' },
        t6: { shift: 'Nghỉ OFF', status: 'OFF' },
        t7: { shift: 'Ca 3 (18-23)', status: 'UPCOMING' },
        cn: { shift: 'Nghỉ OFF', status: 'OFF' },
      },
      {
        empId: 'EMP_005',
        empCode: 'UBM_NV9921',
        name: 'Hoàng Minh Khang',
        stage: 'PROBATION',
        branch: 'CN120',
        t2: { shift: 'Ca 1 (07-12)', status: 'COMPLETED', time: '06:50' },
        t3: { shift: 'Nghỉ OFF', status: 'OFF', isToday: true },
        t4: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
        t5: { shift: 'Ca 1 (07-12)', status: 'UPCOMING' },
        t6: { shift: 'Nghỉ OFF', status: 'OFF' },
        t7: { shift: 'Ca 2 (12-18)', status: 'UPCOMING' },
        cn: { shift: 'Nghỉ OFF', status: 'OFF' },
      },
    ];

    const filteredSchedule = scheduleItems.filter((item) => {
      const matchBranch = scheduleBranchFilter === 'ALL' || item.branch === scheduleBranchFilter;
      const matchStage = scheduleStageFilter === 'ALL' || item.stage === scheduleStageFilter;
      return matchBranch && matchStage;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Top Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
                7. Lịch Làm Việc Tuần & Giám Sát Điểm Danh Realtime
              </h1>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: '#DFF5E8',
                color: '#065F46',
                fontSize: '11px',
                fontWeight: 700,
                border: '1px solid #A7F3D0',
              }}>
                <RadioTower size={14} style={{ animation: 'pulse 1.5s infinite' }} />
                Socket.IO: Tự Động Điểm Danh Realtime
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
              Hiển thị phân loại Nhân viên Thử việc (Chu kỳ 12 ngày) & Chính thức. Tự động cập nhật trạng thái khi nhân viên điểm danh trên Cổng Nhân Viên.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn-primary"
              style={{ backgroundColor: '#10B981', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
              onClick={() => showToast('🟢 Socket.IO: Đã đồng bộ realtime 100% dữ liệu điểm danh từ Cổng Nhân Viên!')}
            >
              <RefreshCw size={14} /> Tải Lại Realtime
            </button>
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
              onClick={() => showToast('Đã phát hành lịch tuần PUBLISHED cho toàn hệ thống!')}
            >
              <CheckCircle size={14} /> Phát Hành Lịch (PUBLISH)
            </button>
          </div>
        </div>

        {/* Realtime Socket Live Notification Banner */}
        <div style={{
          backgroundColor: '#ECFDF5',
          border: '1.5px solid #10B981',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#10B981',
              boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.25)',
              animation: 'pulse 1.2s infinite',
            }} />
            <div style={{ fontSize: '13px', color: '#065F46' }}>
              <strong>TỰ ĐỘNG ĐIỂM DANH REALTIME:</strong> Vừa nhận tín hiệu check-in từ Cổng Nhân Viên:
              <strong style={{ color: '#047857', marginLeft: '6px' }}>Nguyễn Văn An (UBM_NV0482)</strong> lúc <strong>06:55:12</strong> tại <strong>CN130</strong> | GPS: <strong>38m (&lt;300m)</strong> | Đồng phục: <strong>Áo hồng + Bảng tên [✓ HỢP LỆ]</strong>.
            </div>
          </div>

          <button
            onClick={() => setSelectedRealtimeModal(scheduleItems[0])}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#10B981',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Eye size={14} /> Xem Bằng Chứng
          </button>
        </div>

        {/* Filter Controls & Guide Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--surface)',
          padding: '12px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {/* Filter by Branch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Chi nhánh:</span>
              <select
                value={scheduleBranchFilter}
                onChange={(e) => setScheduleBranchFilter(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '12px', minHeight: '34px', borderRadius: '6px' }}
              >
                <option value="ALL">Tất Cả Chi Nhánh</option>
                <option value="CN130">Chi Nhánh 130</option>
                <option value="CN120">Chi Nhánh 120</option>
                <option value="CN261">Chi Nhánh 261</option>
                <option value="CN111">Chi Nhánh 111</option>
              </select>
            </div>

            {/* Filter by Stage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Loại nhân sự:</span>
              <select
                value={scheduleStageFilter}
                onChange={(e) => setScheduleStageFilter(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '12px', minHeight: '34px', borderRadius: '6px' }}
              >
                <option value="ALL">Tất Cả (Thử việc & Chính thức)</option>
                <option value="PROBATION">🌸 Nhân Viên Thử Việc (12 ngày)</option>
                <option value="OFFICIAL">💼 Nhân Viên Chính Thức</option>
              </select>
            </div>
          </div>

          {/* Guide Legends */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#047857' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} /> Đã Check-in Realtime
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#B45309' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} /> Chưa Check-in (Chờ ca)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#2563EB' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2563EB' }} /> 🤝 Ca nhận thay (+30.000đ)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#9CA3AF' }} /> Nghỉ OFF
            </span>
          </div>
        </div>

        {/* Main Weekly Schedule Grid Table */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', minWidth: '190px' }}>NHÂN VIÊN / VAI TRÒ</th>
                <th style={{ padding: '12px 10px', minWidth: '140px' }}>THỨ 2 (22/09)</th>
                <th style={{ padding: '12px 10px', minWidth: '160px', backgroundColor: '#FEF2F2', borderLeft: '2px solid #F87171', borderRight: '2px solid #F87171' }}>
                  <div style={{ color: '#DC2626', fontWeight: 800 }}>THỨ 3 (HÔM NAY 23/09)</div>
                  <div style={{ fontSize: '10px', color: '#B91C1C' }}>GIÁM SÁT REALTIME</div>
                </th>
                <th style={{ padding: '12px 10px', minWidth: '140px' }}>THỨ 4 (24/09)</th>
                <th style={{ padding: '12px 10px', minWidth: '140px' }}>THỨ 5 (25/09)</th>
                <th style={{ padding: '12px 10px', minWidth: '140px' }}>THỨ 6 (26/09)</th>
                <th style={{ padding: '12px 10px', minWidth: '140px' }}>THỨ 7 (27/09)</th>
                <th style={{ padding: '12px 10px', minWidth: '140px' }}>CHỦ NHẬT (28/09)</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchedule.map((emp) => (
                <tr key={emp.empId} style={{ borderBottom: '1px solid var(--border)' }}>
                  {/* Employee Info Column */}
                  <td style={{ padding: '12px 16px', verticalAlign: 'top', backgroundColor: '#FCFBF9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`badge ${emp.stage === 'PROBATION' ? 'badge-brand' : 'badge-success'}`} style={{ fontSize: '10px' }}>
                        {emp.stage === 'PROBATION' ? '🌸 THỬ VIỆC' : '💼 CHÍNH THỨC'}
                      </span>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--brand)' }}>{emp.empCode}</span>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--text)', marginTop: '4px' }}>
                      {emp.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {getDisplayBranch(emp.branch)}
                    </div>
                    {emp.stage === 'PROBATION' && (
                      <div style={{ fontSize: '10px', color: '#D97706', fontWeight: 700, marginTop: '2px' }}>
                        Chu kỳ 12 ngày (7 làm / 5 OFF)
                      </div>
                    )}
                  </td>

                  {/* Day Columns */}
                  {[
                    { key: 't2', data: emp.t2 },
                    { key: 't3', data: emp.t3, isToday: true },
                    { key: 't4', data: emp.t4 },
                    { key: 't5', data: emp.t5 },
                    { key: 't6', data: emp.t6 },
                    { key: 't7', data: emp.t7 },
                    { key: 'cn', data: emp.cn },
                  ].map((cell, cIdx) => {
                    const d = cell.data as any;
                    const isCheckedIn = d.status === 'CHECKED_IN';
                    const isPending = d.status === 'PENDING';
                    const isOff = d.status === 'OFF';
                    const isBonusSwap = d.status === 'BONUS_SWAP';

                    return (
                      <td
                        key={cIdx}
                        style={{
                          padding: '10px 8px',
                          verticalAlign: 'top',
                          textAlign: 'center',
                          backgroundColor: cell.isToday ? '#FFFBFB' : isOff ? '#F9FAFB' : '#FFFFFF',
                          borderLeft: cell.isToday ? '2px solid #FCA5A5' : undefined,
                          borderRight: cell.isToday ? '2px solid #FCA5A5' : undefined,
                        }}
                      >
                        <div style={{
                          padding: '8px',
                          borderRadius: '8px',
                          backgroundColor: isCheckedIn
                            ? '#ECFDF5'
                            : isPending
                            ? '#FEF3C7'
                            : isBonusSwap
                            ? '#EFF6FF'
                            : isOff
                            ? '#F3F4F6'
                            : '#FAFAFA',
                          border: isCheckedIn
                            ? '1.5px solid #10B981'
                            : isPending
                            ? '1.5px solid #F59E0B'
                            : isBonusSwap
                            ? '1.5px solid #3B82F6'
                            : '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                          boxShadow: isCheckedIn ? '0 2px 6px rgba(16, 185, 129, 0.15)' : undefined,
                        }}>
                          {/* Shift Name */}
                          <div style={{ fontWeight: 700, fontSize: '11px', color: isOff ? '#9CA3AF' : 'var(--text)' }}>
                            {d.shift}
                          </div>

                          {/* Realtime Attendance Status Badge */}
                          {isCheckedIn && (
                            <div style={{ marginTop: '2px' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: '#10B981',
                                color: '#FFF',
                                fontSize: '10px',
                                fontWeight: 800,
                              }}>
                                <CheckCircle size={10} /> ĐÃ CHECK-IN {d.time}
                              </span>
                              <div style={{ fontSize: '10px', color: '#047857', fontWeight: 600, marginTop: '2px' }}>
                                ✓ {d.gps} • Áo hồng + Bảng tên
                              </div>
                              <button
                                onClick={() => setSelectedRealtimeModal(emp)}
                                style={{
                                  marginTop: '4px',
                                  fontSize: '9.5px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#FFFFFF',
                                  border: '1px solid #10B981',
                                  color: '#047857',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                Xem Chi Tiết GPS & Ảnh
                              </button>
                            </div>
                          )}

                          {isPending && cell.isToday && (
                            <div style={{ marginTop: '2px' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: '#F59E0B',
                                color: '#FFF',
                                fontSize: '10px',
                                fontWeight: 800,
                              }}>
                                <Clock size={10} /> CHƯA CHECK-IN
                              </span>
                              <div style={{ fontSize: '9.5px', color: '#B45309', marginTop: '2px' }}>
                                Đang chờ giờ vào ca
                              </div>
                            </div>
                          )}

                          {isBonusSwap && (
                            <div style={{ marginTop: '2px' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: '#2563EB',
                                color: '#FFF',
                                fontSize: '10px',
                                fontWeight: 800,
                              }}>
                                🤝 +30.000đ PHỤ CẤP
                              </span>
                              <div style={{ fontSize: '9.5px', color: '#1E40AF', marginTop: '2px' }}>
                                {d.note}
                              </div>
                            </div>
                          )}

                          {isOff && (
                            <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 600 }}>
                              Nghỉ định kỳ
                            </div>
                          )}

                          {d.status === 'COMPLETED' && (
                            <div style={{ fontSize: '10px', color: '#059669', fontWeight: 600 }}>
                              ✓ Đã xong ca ({d.time})
                            </div>
                          )}

                          {d.status === 'UPCOMING' && (
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              Lịch đã duyệt
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* MODAL: XEM BẰNG CHỨNG ĐIỂM DANH REALTIME TỪ CỔNG NHÂN VIÊN */}
        {selectedRealtimeModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            padding: '20px',
          }}>
            <div style={{
              backgroundColor: 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              width: '480px',
              maxWidth: '95vw',
              padding: '24px',
              boxShadow: 'var(--shadow-modal)',
              border: '1.5px solid #10B981',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#DFF5E8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <CheckCircle size={20} color="#10B981" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>
                      Bằng Chứng Điểm Danh Realtime
                    </h3>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Dữ liệu nhận từ Cổng Nhân Viên qua Socket.IO Master
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRealtimeModal(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Detail Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nhân viên:</span>
                    <strong style={{ fontSize: '13px' }}>{selectedRealtimeModal.name} ({selectedRealtimeModal.empCode})</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Chi nhánh:</span>
                    <strong style={{ fontSize: '13px', color: 'var(--brand)' }}>{getDisplayBranch(selectedRealtimeModal.branch)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Thời gian check-in:</span>
                    <strong style={{ fontSize: '13px', color: '#10B981' }}>06:55:12 (Đúng giờ ca Sáng)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tọa độ GPS & Khoảng cách:</span>
                    <strong style={{ fontSize: '13px', color: '#10B981' }}>38 mét (Bán kính hợp lệ &lt; 300m)</strong>
                  </div>
                </div>

                {/* Uniform & Badge Visual Confirmation */}
                <div style={{
                  padding: '14px',
                  backgroundColor: '#FDF2F8',
                  borderRadius: '8px',
                  border: '1.5px solid #F472B6',
                  textAlign: 'center',
                }}>
                  <div style={{
                    width: '100%',
                    height: '140px',
                    borderRadius: '6px',
                    backgroundColor: '#E85D92',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFF',
                    boxShadow: 'inset 0 0 20px rgba(0,0,0,0.1)',
                    marginBottom: '10px',
                  }}>
                    <Camera size={32} style={{ marginBottom: '6px' }} />
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>ẢNH CHỤP ĐỒNG PHỤC ÁO HỒNG ỤM BÒ MILK</div>
                    <div style={{ fontSize: '11px', opacity: 0.9 }}>Bảng tên nhân viên: Đã xác thực hợp lệ</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', fontSize: '12px', fontWeight: 700, color: '#9D174D' }}>
                    <span>✓ Áo màu hồng chuẩn thương hiệu</span>
                    <span>✓ Đeo bảng tên rõ nét</span>
                  </div>
                </div>

                <button
                  className="btn-primary"
                  onClick={() => setSelectedRealtimeModal(null)}
                  style={{ width: '100%', marginTop: '6px' }}
                >
                  Đóng Hộp Thoại
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'hr-leave') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Phê Duyệt Đơn Nghỉ Phép (OFF)</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Ngày Nghỉ</th>
                <th style={{ padding: '12px 20px' }}>Lý Do</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>Trần Thị Bình</td>
                <td style={{ padding: '14px 20px' }}>Chi Nhánh 130</td>
                <td style={{ padding: '14px 20px' }}>25/09/2026</td>
                <td style={{ padding: '14px 20px' }}>Nghỉ tuần theo lịch cá nhân</td>
                <td style={{ padding: '14px 20px' }}>
                  <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => showToast('Đã duyệt đơn nghỉ phép')}>Duyệt Đơn</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-swap') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Giám Sát & Điều Phối Đổi Ca / Nhường Ca</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Theo dõi quy trình Tráo đổi ca (A ⇄ B) & Điều phối Nhường ca (+30.000đ/ca phụ cấp hỗ trợ) khi NV không tìm được người thay
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#2563EB' }}
            onClick={() => showToast('Phiếu điều phối ca nhường khẩn cấp đã được kích hoạt và gửi đến nhân viên chi nhánh!')}
          >
            <Sparkles size={16} />
            + Tạo Phiếu Điều Phối Nhường Ca (+30.000đ)
          </button>
        </div>

        {/* CHÍNH SÁCH +30.000Đ PHỤ CẤP KHI NHẬN LÀM THAY / NHƯỜNG CA */}
        <div style={{
          backgroundColor: '#EFF6FF',
          border: '1.5px solid #3B82F6',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Sparkles size={18} color="#2563EB" />
            <strong style={{ fontSize: '14px', color: '#1E40AF', textTransform: 'uppercase' }}>
              CHÍNH SÁCH ĐIỀU PHỐI NHƯỜNG CA CỦA HR (+30.000đ/CA HỖ TRỢ):
            </strong>
          </div>
          <div style={{ fontSize: '13px', color: '#1E3A8A', lineHeight: '1.6' }}>
            Nếu <strong>Nhân viên A không tìm được người thay/nhường ca</strong>, HR sẽ tạo phiếu và gửi yêu cầu điều phối đến <strong>toàn bộ nhân viên trong chi nhánh đó</strong>. Nhân viên nào bấm nhận ca làm thay cho A (sẽ làm 2 ca/ngày nếu ngày đó nhân viên đã có ca làm việc) ➔ <strong>Hệ thống tự động ghi nhận +30.000đ/ca phụ cấp hỗ trợ</strong> (tự động cộng thẳng vào Bảng Lương Finance và hiển thị trên Cổng Webapp Nhân Viên của bạn đó).
          </div>
        </div>

        {/* KHUNG QUY TRÌNH HR TẠO PHIẾU & GỬI ĐIỀU PHỐI ĐẾN NHÂN VIÊN CHI NHÁNH */}
        <div style={{
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-md)',
          border: '1.5px solid #2563EB',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}>
          <div style={{
            backgroundColor: '#1E40AF',
            color: '#FFF',
            padding: '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <RadioTower size={20} color="#93C5FD" />
              <strong style={{ fontSize: '15px' }}>
                PHIẾU ĐIỀU PHỐI NHƯỜNG CA KHẨN CẤP CỦA HR (MÃ: UBM_DP0924_01)
              </strong>
            </div>
            <span style={{
              backgroundColor: '#10B981',
              color: '#FFF',
              fontSize: '11px',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '999px',
            }}>
              ĐANG PHÁT LỆNH REALTIME
            </span>
          </div>

          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* BƯỚC 1: THÔNG TIN NHÂN VIÊN A XIN NHƯỜNG CA */}
            <div style={{
              backgroundColor: '#F8FAFC',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '14px 16px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '8px' }}>
                Bước 1: Thông Tin Nhân Viên A Cần Nhường Ca (Không tìm được người thay)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', fontSize: '13px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Nhân viên xin nhường:</div>
                  <strong style={{ color: '#0F172A' }}>Nguyễn Văn An (UBM_NV0482)</strong>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chi nhánh công tác:</div>
                  <strong style={{ color: '#2563EB' }}>CN130 - Cách Mạng Tháng 8</strong>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ca làm cần nhường:</div>
                  <strong style={{ color: '#DC2626' }}>Ca 2: Chiều (12:00 - 17:00) [24/09]</strong>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mức phụ cấp tự động:</div>
                  <strong style={{ color: '#059669', fontSize: '14px' }}>+30.000đ / ca hỗ trợ</strong>
                </div>
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748B' }}>
                <strong>Lý do của NV A:</strong> Bận việc đột xuất gia đình, đã đăng tìm tráo ca trong nhóm nhưng không có ai đổi được. Yêu cầu HR hỗ trợ điều phối toàn chi nhánh.
              </div>
            </div>

            {/* BƯỚC 2: PHẠM VI GỬI THÔNG BÁO ĐẾN NHÂN VIÊN TRONG CHI NHÁNH */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#1E293B', textTransform: 'uppercase' }}>
                    Bước 2: Danh Sách Nhân Viên Thuộc Chi Nhánh CN130 Nhận Phiếu Điều Phối
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Hệ thống tự động lọc 100% nhân sự thuộc <strong>Chi nhánh CN130</strong> (không gửi sang chi nhánh khác). Hiển thị rõ ai sẽ làm 2 ca/ngày nếu nhận.
                  </div>
                </div>
                <span className="badge" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF', fontWeight: 700 }}>
                  4 Nhân Viên Trong Chi Nhánh CN130
                </span>
              </div>

              <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F1F5F9', textAlign: 'left', color: '#475569', textTransform: 'uppercase', fontSize: '11px' }}>
                      <th style={{ padding: '10px 14px' }}>Nhân Viên Nhận Thông Báo</th>
                      <th style={{ padding: '10px 14px' }}>Chi Nhánh</th>
                      <th style={{ padding: '10px 14px' }}>Ca Làm Hiện Tại (Ngày 24/09)</th>
                      <th style={{ padding: '10px 14px' }}>Tác Động Khi Nhận Ca Của A</th>
                      <th style={{ padding: '10px 14px' }}>Kênh Phát Lệnh</th>
                      <th style={{ padding: '10px 14px' }}>Trạng Thái Tiếp Nhận</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#F0FDF4' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0F172A' }}>
                        Trần Thị Bình <span style={{ fontSize: '11px', color: '#64748B' }}>(UBM_NV0015 - 0903333444)</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#2563EB' }}>CN130</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className="badge badge-brand">Ca 1: Sáng (07:00 - 12:00)</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: '#059669', fontWeight: 800 }}>⚡ SẼ LÀM 2 CA/NGÀY</span> (Sáng + Chiều)<br />
                        <strong style={{ color: '#059669' }}>+30.000đ Phụ Cấp Hỗ Trợ</strong>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B' }}>
                        Webapp + Socket + SMS
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          backgroundColor: '#10B981',
                          color: '#FFF',
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: '4px',
                        }}>
                          ✓ ĐÃ BẤM NHẬN CA (08:35:12)
                        </span>
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0F172A' }}>
                        Lê Văn Cường <span style={{ fontSize: '11px', color: '#64748B' }}>(UBM_NV0102 - 0904555666)</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#2563EB' }}>CN130</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className="badge" style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}>Nghỉ OFF</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        Làm 1 ca Chiều (Đổi từ OFF sang làm)<br />
                        <strong style={{ color: '#059669' }}>+30.000đ Phụ Cấp Hỗ Trợ</strong>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B' }}>
                        Webapp + Socket + SMS
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: '#64748B', fontSize: '11px' }}>Đã nhận thông báo</span>
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0F172A' }}>
                        Hoàng Thị Dung <span style={{ fontSize: '11px', color: '#64748B' }}>(UBM_NV0218 - 0905777888)</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#2563EB' }}>CN130</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className="badge badge-brand">Ca 3: Tối (17:00 - 22:00)</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: '#059669', fontWeight: 800 }}>⚡ SẼ LÀM 2 CA/NGÀY</span> (Chiều + Tối)<br />
                        <strong style={{ color: '#059669' }}>+30.000đ Phụ Cấp Hỗ Trợ</strong>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B' }}>
                        Webapp + Socket + SMS
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: '#64748B', fontSize: '11px' }}>Đã nhận thông báo</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0F172A' }}>
                        Phạm Đức Dũng <span style={{ fontSize: '11px', color: '#64748B' }}>(UBM_NV0334 - 0906999000)</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#2563EB' }}>CN130</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className="badge" style={{ backgroundColor: '#F1F5F9', color: '#64748B' }}>Nghỉ OFF</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        Làm 1 ca Chiều (Đổi từ OFF sang làm)<br />
                        <strong style={{ color: '#059669' }}>+30.000đ Phụ Cấp Hỗ Trợ</strong>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748B' }}>
                        Webapp + Socket + SMS
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: '#64748B', fontSize: '11px' }}>Đã nhận thông báo</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* BƯỚC 3: KẾT QUẢ TIẾP NHẬN & TỰ ĐỘNG HẠCH TOÁN FINANCE VÀ CỔNG NHÂN VIÊN */}
            <div style={{
              backgroundColor: '#ECFDF5',
              border: '1.5px solid #10B981',
              borderRadius: '8px',
              padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <CheckCircle size={20} color="#059669" />
                <strong style={{ fontSize: '14px', color: '#065F46' }}>
                  KẾT QUẢ ĐIỀU PHỐI: TRẦN THỊ BÌNH ĐÃ NHẬN CA THAY THÀNH CÔNG!
                </strong>
              </div>
              <div style={{ fontSize: '13px', color: '#047857', lineHeight: '1.6' }}>
                • <strong>Phân bổ ca làm việc:</strong> Nhân viên Trần Thị Bình nhận thêm <strong>Ca 2: Chiều (12:00 - 17:00) ngày 24/09</strong> ➔ Bình thực hiện <strong>LÀM 2 CA/NGÀY</strong> (Ca 1 Sáng + Ca 2 Chiều).<br />
                • <strong>Tự động hạch toán Lương Finance:</strong> Hệ thống tự động ghi nhận thêm <strong>+30.000đ phụ cấp hỗ trợ làm thay</strong> vào Bảng tính lương Tháng 09/2026 của Trần Thị Bình.<br />
                • <strong>Cập nhật Cổng Nhân Viên:</strong> Webapp của Bình tự động cập nhật lịch 2 ca và cộng +30.000đ vào mục <strong>Lương AI</strong>.<br />
                • <strong>Nhân viên Nguyễn Văn An:</strong> Ca Chiều ngày 24/09 đã chuyển thành <em>"Đã nhường ca thành công cho Trần Thị Bình"</em>.
              </div>
              <div style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                <button
                  className="btn-primary"
                  style={{ backgroundColor: '#059669', fontSize: '12px', padding: '8px 14px' }}
                  onClick={() => showToast('Đã xác nhận chốt phiếu điều phối và khóa ca làm việc thành công!')}
                >
                  ✓ Xác Nhận Chốt Phiếu Điều Phối
                </button>
                <button
                  className="btn-outline"
                  style={{ fontSize: '12px', padding: '8px 14px' }}
                  onClick={() => showToast('Đang chuyển hướng sang Bảng Lương Finance để đối soát phụ cấp 30.000đ...')}
                >
                  Xem Tại Bảng Lương Finance
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CÁC PHIẾU TRÁO ĐỔI CA THÔNG THƯỜNG (A <-> B) */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '16px 20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-brand">Hình thức 1: Tráo đổi ca trực tiếp (A ⇄ B)</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Cùng Chi Nhánh 130</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: '14px', marginTop: '6px' }}>
                Lê Văn Cường (Ca 1) ⇄ Phạm Đức Dũng (Ca 2) ngày 26/09
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Trạng thái: 2 nhân viên đã tự thỏa thuận và bấm đồng ý ➔ Đang chờ HR phê duyệt cuối.
              </div>
            </div>
            <button className="btn-primary" onClick={() => showToast('HR đã duyệt hoàn tất! Lịch làm việc được tự động cập nhật.')}>
              Phê Duyệt Tráo Đổi
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-emergency') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Xử Lý Nghỉ Đột Xuất & Khẩn Cấp</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Tiếp nhận ca báo nghỉ khẩn cấp (ốm đau, sự cố gia đình) và kích hoạt giải pháp bù khuyết nhân sự tức thì
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#DC2626' }}
            onClick={() => showToast('Đang phát lệnh cảnh báo nhân sự thiếu hụt khẩn cấp đến Cửa Hàng Trưởng và HR!')}
          >
            <AlertTriangle size={16} />
            + Báo Cáo Sự Cố Nhân Sự Khẩn Cấp
          </button>
        </div>

        {/* QUY TRÌNH XỬ LÝ NGHỈ KHẨN CẤP */}
        <div style={{
          backgroundColor: '#FFF7ED',
          border: '1.5px solid #EA580C',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <AlertTriangle size={18} color="#C2410C" />
            <strong style={{ fontSize: '14px', color: '#9A3412', textTransform: 'uppercase' }}>
              QUY TRÌNH BÙ KHUYẾT NHÂN SỰ KHI CÓ CA NGHỈ ĐỘT XUẤT:
            </strong>
          </div>
          <div style={{ fontSize: '13px', color: '#7C2D12', lineHeight: '1.6' }}>
            1. Nhân viên gửi đơn báo nghỉ khẩn cấp kèm lý do & chứng từ qua <strong>Cổng Nhân Viên (Webapp Mobile)</strong>.<br />
            2. Hệ thống phát cảnh báo đỏ Realtime đến <strong>Cửa Hàng Trưởng</strong> và <strong>HR</strong>.<br />
            3. HR duyệt đơn nghỉ có phép và kích hoạt <strong>Chính sách Điều Phối Nhường Ca (+30.000đ Phụ Cấp Hỗ Trợ)</strong> cho toàn bộ nhân viên trong chi nhánh đó để đảm bảo ca làm không bị gián đoạn.
          </div>
        </div>

        {/* DANH SÁCH CA BÁO NGHỈ KHẨN CẤP ĐANG CẦN XỬ LÝ */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Danh Sách Yêu Cầu Nghỉ Khẩn Cấp Cần Bù Khuyết Nhân Sự</strong>
            <span className="badge" style={{ backgroundColor: '#FEE2E2', color: '#DC2626', fontWeight: 800 }}>1 Ca Cần Bù Khuyết Gấp</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh & Ca Làm</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian Báo Nghỉ</th>
                <th style={{ padding: '12px 20px' }}>Lý Do & Chứng Từ</th>
                <th style={{ padding: '12px 20px' }}>Tình Trạng Nhân Sự Ca</th>
                <th style={{ padding: '12px 20px' }}>Giải Pháp Xử Lý Của HR</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: '#FEF2F2' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Hoàng Thị Dung
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>UBM_NV0218 • 0905777888</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong style={{ color: '#DC2626' }}>Ca 3: Tối (17:00 - 22:00)</strong>
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>CN130 - Cách Mạng Tháng 8</div>
                </td>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  24/09/2026 (Hôm nay)
                  <div style={{ fontSize: '11px', color: '#64748B' }}>Báo trước ca 4 tiếng</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ color: '#991B1B', fontWeight: 600 }}>Sốt cao 39.5°C đột xuất</div>
                  <div style={{ fontSize: '11px', color: '#059669', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => showToast('Mở xem ảnh giấy khám bệnh viện')}>
                    📄 Xem Giấy Khám Bệnh Viện [✓ Hợp Lệ]
                  </div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#DC2626', color: '#FFF', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    🔴 THIẾU 1 NHÂN SỰ
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                      className="btn-primary"
                      style={{ padding: '6px 10px', fontSize: '11px', backgroundColor: '#2563EB' }}
                      onClick={() => showToast('Đã phát lệnh điều phối nhường ca (+30.000đ phụ cấp) đến toàn bộ nhân viên CN130!')}
                    >
                      🚀 Phát Lệnh Nhường Ca (+30k Phụ Cấp)
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '11px', color: '#059669' }}
                      onClick={() => showToast('Đã duyệt nghỉ có phép! Không trừ điểm chuyên cần.')}
                    >
                      ✓ Duyệt Nghỉ Có Phép
                    </button>
                  </div>
                </td>
              </tr>

              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Vũ Hoàng Long
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>UBM_NV0512 • 0911223344</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong>Ca 1: Sáng (07:00 - 12:00)</strong>
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>CN120 - Điện Biên Phủ</div>
                </td>
                <td style={{ padding: '14px 20px' }}>23/09/2026</td>
                <td style={{ padding: '14px 20px' }}>
                  Sự cố xe hỏng trên đường đi làm
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#DCFCE7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                    🟢 ĐÃ BÙ KHUYẾT
                  </span>
                  <div style={{ fontSize: '11px', color: '#15803D' }}>Lê Văn Cường nhận thay (+30k)</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ color: '#64748B', fontSize: '12px' }}>✓ Đã đóng ca xử lý</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-attendance') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>11. Bảng Chấm Công Thời Gian Thực</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Giám sát check-in, check-out, hình ảnh áo hồng + bảng tên, tọa độ GPS</p>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh</th>
                <th style={{ padding: '12px 20px' }}>Check-in</th>
                <th style={{ padding: '12px 20px' }}>Check-out</th>
                <th style={{ padding: '12px 20px' }}>GPS & Ảnh Áo Hồng</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>Nguyễn Văn An</td>
                <td style={{ padding: '14px 20px' }}>CN130</td>
                <td style={{ padding: '14px 20px' }}>06:55</td>
                <td style={{ padding: '14px 20px' }}>12:02</td>
                <td style={{ padding: '14px 20px', color: 'var(--brand)', fontWeight: 600 }}>38m • Áo hồng + Bảng tên OK</td>
                <td style={{ padding: '14px 20px' }}><span className="badge badge-success">HỢP LỆ</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-adjustments') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>12. Bổ Sung & Điều Chỉnh Dữ Liệu Công</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Xử lý các trường hợp quên check-in/out hoặc sự cố GPS/Camera trên điện thoại</p>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Trần Thị Bình (CN130)</strong> • Lý do: Quên bấm check-in khi nhận bàn giao hàng sáng
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Giờ đề xuất: 07:00 - Cửa Hàng Trưởng đã xác nhận có mặt thực tế</div>
            </div>
            <button className="btn-primary" onClick={() => showToast('HR đã duyệt bổ sung công! Không sửa event gốc, ghi nhận adjustment có audit.')}>
              Duyệt Bổ Sung Công
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-tests') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>13. Quản Lý Ngân Hàng Câu Hỏi & Bài Thi TEST</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Bộ đề 25 câu hỏi trắc nghiệm đánh giá đầu ra thử việc (12 ngày) & sát hạch nghiệp vụ định kỳ Ụm Bò Milk V5.1
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => showToast('Mở cấu hình thời gian 480 giây & điểm đạt chuẩn')}
            >
              <Sliders size={16} />
              Cấu Hình Đề Thi
            </button>
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2563EB' }}
              onClick={() => showToast('Đã mở form thêm câu hỏi mới vào ngân hàng đề!')}
            >
              <Plus size={16} />
              + Thêm Câu Hỏi Mới
            </button>
          </div>
        </div>

        {/* THỐNG KÊ NGÂN HÀNG CÂU HỎI & QUY CHUẨN ĐỀ THI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG CÂU HỎI TRONG KHO</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>120 Câu</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>3 danh mục nghiệp vụ</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>QUY MÔ ĐỀ THI ĐẦU RA</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>25 Câu</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Thời gian: 480s (8 phút)</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ĐIỂM ĐẠT CHUẨN ĐẦU RA</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--success)', marginTop: '4px' }}>≥ 8.0 / 10</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Điều kiện chuyển chính thức</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỶ LỆ ĐẠT THỬ VIỆC</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669', marginTop: '4px' }}>95.8%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>23/24 nhân sự đạt lần đầu</div>
          </div>
        </div>

        {/* 3 DANH MỤC NGÂN HÀNG CÂU HỎI CHUẨN */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: '16px 20px' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>
            Phân Bổ Cấu Trúc Đề Thi 25 Câu Trắc Nghiệm:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: '#1E40AF' }}>1. Công Thức & Pha Chế Chuẩn</div>
              <div style={{ fontSize: '12px', color: '#1E3A8A', marginTop: '4px' }}>
                • Số lượng: <strong>10 câu (40%)</strong> trong đề<br />
                • Kho đề: 45 câu hỏi thực hành & định lượng
              </div>
            </div>
            <div style={{ backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: '#065F46' }}>2. Vệ Sinh ATTP & Bảo Quản</div>
              <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                • Số lượng: <strong>8 câu (32%)</strong> trong đề<br />
                • Kho đề: 40 câu hỏi bảo quản & date nguyên liệu
              </div>
            </div>
            <div style={{ backgroundColor: '#FDF2F8', border: '1px solid #FBCFE8', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontWeight: 800, fontSize: '13px', color: '#9D174D' }}>3. Chuẩn Dịch Vụ & Đồng Phục</div>
              <div style={{ fontSize: '12px', color: '#831843', marginTop: '4px' }}>
                • Số lượng: <strong>7 câu (28%)</strong> trong đề<br />
                • Kho đề: 35 câu hỏi áo hồng, bảng tên & chào khách
              </div>
            </div>
          </div>
        </div>

        {/* BẢNG THEO DÕI KẾT QUẢ THI TEST CỦA NHÂN VIÊN */}
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '14px' }}>Kết Quả Thi TEST Đầu Ra Gần Nhất (Nhân Viên Thử Việc)</strong>
            <span className="badge" style={{ backgroundColor: '#EFF6FF', color: '#2563EB', fontWeight: 700 }}>Đồng bộ tự động từ Cổng Nhân Viên</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Chi Nhánh & Giai Đoạn</th>
                <th style={{ padding: '12px 20px' }}>Điểm Bài TEST</th>
                <th style={{ padding: '12px 20px' }}>Số Câu Đúng</th>
                <th style={{ padding: '12px 20px' }}>Thời Gian Làm</th>
                <th style={{ padding: '12px 20px' }}>Kết Quả Đánh Giá</th>
                <th style={{ padding: '12px 20px' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Nguyễn Văn An
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>UBM_NV0482 • 0901111222</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  CN130 - Cách Mạng Tháng 8
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>Thử việc ngày 6/12</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong style={{ fontSize: '16px', color: '#059669' }}>9.2 / 10</strong>
                </td>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>23 / 25 câu đúng</td>
                <td style={{ padding: '14px 20px' }}>06:15 / 08:00</td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#DCFCE7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    🟢 ĐẠT CHUẨN ĐẦU RA
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '11px', backgroundColor: '#059669' }} onClick={() => showToast('Đã chuyển tiếp đề xuất ký hợp đồng chính thức!')}>
                    Đề Xuất Chính Thức
                  </button>
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Lê Hoàng Cúc
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>UBM_NV0389 • 0905555666</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  CN120 - Điện Biên Phủ
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>Thử việc ngày 10/12</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong style={{ fontSize: '16px', color: '#059669' }}>8.8 / 10</strong>
                </td>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>22 / 25 câu đúng</td>
                <td style={{ padding: '14px 20px' }}>07:10 / 08:00</td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#DCFCE7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    🟢 ĐẠT CHUẨN ĐẦU RA
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '11px', backgroundColor: '#059669' }} onClick={() => showToast('Đã chuyển tiếp đề xuất ký hợp đồng chính thức!')}>
                    Đề Xuất Chính Thức
                  </button>
                </td>
              </tr>
              <tr>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>
                  Trần Quốc Bảo
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>UBM_NV0611 • 0907777888</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  CN261 - Võ Văn Ngân
                  <div style={{ fontSize: '11px', color: '#2563EB' }}>Thử việc ngày 4/12</div>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <strong style={{ fontSize: '16px', color: '#DC2626' }}>7.6 / 10</strong>
                </td>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>19 / 25 câu đúng</td>
                <td style={{ padding: '14px 20px' }}>08:00 (Hết giờ)</td>
                <td style={{ padding: '14px 20px' }}>
                  <span style={{ backgroundColor: '#FEE2E2', color: '#DC2626', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    🔴 CHƯA ĐẠT (≥ 8.0)
                  </span>
                </td>
                <td style={{ padding: '14px 20px' }}>
                  <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', color: '#2563EB' }} onClick={() => showToast('Đã mở quyền cho làm bài thi lại lần 2!')}>
                    Cho Thi Lại Lần 2
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-reports') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>14. Báo Cáo Phân Tích Nhân Sự (HR Reports)</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỶ LỆ CHUYỂN CHÍNH THỨC</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--success)', marginTop: '4px' }}>94.2%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>16/17 nhân sự đạt chuẩn</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỔNG GIỜ LÀM VIỆC THÁNG</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand)', marginTop: '4px' }}>4.820h</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Toàn bộ 4 chi nhánh</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TỶ LỆ ĐI ĐÚNG GIỜ</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563EB', marginTop: '4px' }}>98.5%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Điểm danh GPS chuẩn &lt; 300m</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'hr-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>15. Trung Tâm Thông Báo Nghiệp Vụ HR</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ padding: '10px', backgroundColor: '#FDF2F8', borderRadius: '6px' }}>
              <strong>Lịch phỏng vấn mới:</strong> Ứng viên Nguyễn Thu Trang lúc 14:30
            </div>
            <div style={{ padding: '10px', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
              <strong>Yêu cầu chuyển chính thức:</strong> Nhân viên Nguyễn Văn An đã hoàn tất 12 ngày thử việc
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // STORE VIEWS (10 TABS - BOUND TO BRANCH SCOPE)
  // =========================================================================
  if (activeTab === 'store-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>
              1. Dashboard Vận Hành Chi Nhánh: <span style={{ color: 'var(--brand)' }}>{branchName}</span>
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Giám sát nhân sự, ca làm việc, điểm danh realtime trong phạm vi quản lý</p>
          </div>
          <span className="badge badge-brand" style={{ fontSize: '12px', padding: '6px 14px' }}>
            Phạm vi: {branchScope}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>NHÂN SỰ CHI NHÁNH</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>{storeEmployees.length || 8}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Thuộc {branchName}</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ĐANG CÓ MẶT CA NÀY</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>4 / 4</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đủ 100% định biên ca</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHƯA CHECK-IN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#10B981', marginTop: '6px' }}>0</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Không có nhân viên trễ</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>ĐƠN CHỜ DUYỆT</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#D97706', marginTop: '6px' }}>1</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đổi ca trong chi nhánh</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-employees') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>2. Danh Sách Nhân Viên Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Số Điện Thoại</th>
                <th style={{ padding: '12px 20px' }}>Giai Đoạn</th>
                <th style={{ padding: '12px 20px' }}>Ca Phụ Trách</th>
              </tr>
            </thead>
            <tbody>
              {storeEmployees.map((emp, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>{emp.employee_code}</td>
                  <td style={{ padding: '14px 20px', fontWeight: 700 }}>{emp.full_name}</td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{emp.phone_normalized}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <span className={`badge ${emp.employment_status === 'OFFICIAL' ? 'badge-success' : 'badge-brand'}`}>
                      {emp.employment_status}
                    </span>
                  </td>
                  <td style={{ padding: '14px 20px' }}>Ca Sáng (07:00 - 12:00)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-schedule') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Lịch Làm Việc Tuần Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>Tuần hiện tại (22/09 - 28/09/2026):</div>
          <div style={{ fontSize: '13px', color: 'var(--text)' }}>
            Ca 1 (07-12): 3 Barista • Ca 2 (12-18): 3 Barista • Ca 3 (18-23): 2 Nhân viên
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-off') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Duyệt OFF Hàng Tuần (Store Level)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Trần Thị Bình:</strong> Đăng ký nghỉ OFF ngày 25/09/2026 (Thứ 5)
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Định biên ca còn lại: 3 nhân viên (Đảm bảo tối thiểu 2)</div>
            </div>
            <button className="btn-primary" onClick={() => showToast('Cửa Hàng Trưởng đã duyệt đơn nghỉ OFF')}>Phê Duyệt Đơn</button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-swap') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Phê Duyệt Đổi Ca Làm Trong Chi Nhánh</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Yêu cầu đổi ca:</strong> NV A (Nguyễn Văn An) ⇄ NV B (Trần Thị Bình)
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đã có sự xác nhận của 2 nhân viên • Không bị chồng ca</div>
            </div>
            <button className="btn-primary" onClick={() => showToast('Cửa Hàng Trưởng đã duyệt đổi ca!')}>Duyệt Đổi Ca</button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-emergency') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Xử Lý Báo Nghỉ Đột Xuất Tại Chi Nhánh</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Không có trường hợp nghỉ đột xuất nào đang chờ xử lý tại {branchName}.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-realtime-att') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>7. Chấm Công Realtime Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Nhân Viên</th>
                <th style={{ padding: '12px 20px' }}>Giờ Vào</th>
                <th style={{ padding: '12px 20px' }}>GPS Bán Kính</th>
                <th style={{ padding: '12px 20px' }}>Kiểm Tra Đồng Phục</th>
                <th style={{ padding: '12px 20px' }}>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>Nguyễn Văn An</td>
                <td style={{ padding: '14px 20px' }}>06:55</td>
                <td style={{ padding: '14px 20px', color: '#10B981', fontWeight: 700 }}>38m (Chuẩn)</td>
                <td style={{ padding: '14px 20px', color: 'var(--brand)', fontWeight: 700 }}>Áo hồng + Bảng tên OK</td>
                <td style={{ padding: '14px 20px' }}><span className="badge badge-success">ĐANG LÀM VIỆC</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-confirm-att') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Xác Nhận Công Hợp Lệ Chuyển Sang Kế Toán</h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Cửa Hàng Trưởng xác nhận bảng công ngày trước khi chuyển sang Finance tính lương</p>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={() => showToast('Đã xác nhận dữ liệu công chi nhánh thành công!')}>
            Xác Nhận & Khóa Công Ngày Hôm Nay
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-reports') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Báo Cáo Vận Hành Chi Nhánh {branchName}</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Tổng số ca phục vụ: 42 ca/tuần • Tỷ lệ phủ ca: 100% • Tỷ lệ đi trễ: 0.8%</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'store-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Thông Báo Vận Hành Cửa Hàng</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '10px', backgroundColor: '#FDF2F8', borderRadius: '6px' }}>
            Nhắc nhở: Kiểm kê nguyên vật liệu sữa tươi cuối ngày tại {branchName}.
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FINANCE VIEWS (11 TABS)
  // =========================================================================
  if (activeTab === 'fin-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>1. Dashboard Quản Trị Tài Chính & Tính Lương</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>QUỸ LƯƠNG DỰ KIẾN KỲ NÀY</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>124.500.000 đ</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Toàn bộ 6 chi nhánh & trụ sở</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TỔNG GIỜ CÔNG ĐÃ KHÓA</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#10B981', marginTop: '6px' }}>4.820 Giờ</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Đã đối soát 100% hợp lệ</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>PHIẾU LƯƠNG ĐÃ PHÁT</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>32 / 32</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Bảo mật mã PIN cá nhân</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TRẠNG THÁI KỲ LƯƠNG</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#7C3AED', marginTop: '6px' }}>PUBLISHED</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Sẵn sàng thanh toán chi trả</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-timesheet') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>2. Bảng Chấm Công Tổng Hợp Toàn Công Ty</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Dữ liệu tổng hợp từ 4 chi nhánh cửa hàng + Xưởng sản xuất Củ Chi + Trụ sở chính.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-reconcile-att') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Đối Soát Dữ Liệu Công (Store & HR Verified)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={() => showToast('Đối soát công hoàn tất: Không phát hiện sai lệch dữ liệu!')}>
            Khởi Chạy Đối Soát Tự Động
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-payroll-periods') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Quản Lý Kỳ Lương (Payroll Cycles)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div>Kỳ lương hiện tại: <strong>Kỳ Tháng 09/2026 (01/09 - 30/09/2026)</strong></div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Quy trình: DRAFT ➔ RECONCILE ➔ APPROVED ➔ PUBLISHED ➔ PAID</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-calculate') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Tính Toán Bảng Lương (Formula Engine)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', marginBottom: '12px' }}>
            Công thức: (Tổng giờ công x Đơn giá 23k/25k) + Phụ cấp/Bonus - Khấu trừ hợp lệ
          </div>
          <button className="btn-primary" onClick={() => showToast('Đã tính toán bảng lương kỳ Tháng 09/2026 cho 32 nhân sự!')}>
            Tính Lương Toàn Bộ Nhân Sự
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-details') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Chi Tiết Bảng Lương Từng Nhân Viên</h1>
        <div style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 20px' }}>Mã NV</th>
                <th style={{ padding: '12px 20px' }}>Họ Và Tên</th>
                <th style={{ padding: '12px 20px' }}>Tổng Giờ</th>
                <th style={{ padding: '12px 20px' }}>Đơn Giá</th>
                <th style={{ padding: '12px 20px' }}>Thưởng / Phụ Cấp</th>
                <th style={{ padding: '12px 20px' }}>Thực Nhận</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--brand)' }}>UBM_NV0482</td>
                <td style={{ padding: '14px 20px', fontWeight: 700 }}>Nguyễn Văn An</td>
                <td style={{ padding: '14px 20px' }}>156h</td>
                <td style={{ padding: '14px 20px' }}>23.000 đ/h</td>
                <td style={{ padding: '14px 20px' }}>500.000 đ</td>
                <td style={{ padding: '14px 20px', fontWeight: 800, color: '#10B981' }}>4.088.000 đ</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-payslips') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>7. Phát Hành Phiếu Lương Cá Nhân (Bảo Mật PIN)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={() => showToast('Đã phát hành phiếu lương an toàn đến Cổng Nhân Viên!')}>
            Phát Hành Phiếu Lương (PUBLISH PAYSLIPS)
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-reconcile-payslips') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Đối Soát Phiếu Lương & Sai Lệch</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Khớp 100% giữa số tiền đã tính và tổng quỹ lương chi trả. Không có phiếu lỗi.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-payment') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Xác Nhận Chi Trả & Thanh Toán (PAID)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" style={{ backgroundColor: '#10B981' }} onClick={() => showToast('Đã xác nhận thanh toán thành công và đánh dấu PAID!')}>
            Xác Nhận Đã Thanh Toán Ngân Hàng (PAID)
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-reports') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>10. Báo Cáo Tài Chính Chi Phí Lương (Finance Reports)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Báo cáo chi phí nhân sự theo 4 chi nhánh, khối sản xuất và khối văn phòng.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'fin-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>11. Thông Báo Tài Chính & Kỳ Lương</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '10px', backgroundColor: '#EFF6FF', borderRadius: '6px' }}>
            Nhắc nhở: Toàn bộ bảng chấm công tháng 09 đã được Store xác nhận. Sẵn sàng khóa sổ.
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // MARKETING VIEWS (9 TABS)
  // =========================================================================
  if (activeTab === 'mkt-dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>1. Dashboard Truyền Thông Nội Bộ (MKT)</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phát thanh bản tin, quản lý chiến dịch truyền thông và thông báo đến nhân sự</p>
          </div>
          <button className="btn-primary" onClick={openBroadcastModal}>+ Soạn Bản Tin Mới</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TIN ĐÃ PHÁT</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--brand)', marginTop: '6px' }}>14</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Toàn bộ thông báo qua Socket/Sheets</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>CHIẾN DỊCH ĐANG CHẠY</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563EB', marginTop: '6px' }}>2</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Chiến dịch Văn hóa & Đồng phục hồng</div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', padding: '18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>TỶ LỆ TIẾP CẬN</div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--success)', marginTop: '6px' }}>100%</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Realtime Socket tới Cổng Nhân Viên</div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-create-broadcast') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>2. Tạo & Soạn Thảo Thông Báo Mới</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <button className="btn-primary" onClick={openBroadcastModal}>Mở Trình Soạn Thảo Thông Báo</button>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-audiences') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>3. Quản Lý Nhóm Người Nhận (Audiences)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <strong>Toàn Công Ty</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tất cả 32 nhân sự</div>
            </div>
            <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <strong>Khối Cửa Hàng (Store)</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nhân viên 4 chi nhánh</div>
            </div>
            <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <strong>Khối Thử Việc</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nhân sự đang thử việc</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-schedule') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>4. Lịch Phát Thông Báo (Scheduled Broadcasts)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Lịch phát bản tin tuần: 08:00 Thứ Hai hàng tuần.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-sent-list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>5. Lịch Sử Bản Tin Đã Phát</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ padding: '10px', backgroundColor: '#FAFAFA', borderRadius: '6px', marginBottom: '8px' }}>
            <strong>Thông báo quy chuẩn điểm danh: Áo hồng + Bảng tên</strong> • Gửi lúc 08:00 23/09/2026 • Trạng thái: SENT
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-campaigns') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>6. Chiến Dịch Truyền Thông Nội Bộ (Campaigns)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div>Chiến dịch đang chạy: <strong>Tháng Văn Hóa Phục Vụ Nụ Cười Ụm Bò Milk</strong></div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-media') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>7. Kho Đa Phương Tiện Truyền Thông (Media Assets)</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Quản lý logo, banner thông báo và hình ảnh thương hiệu lưu trữ trên Google Drive.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-tracking') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>8. Theo Dõi Trạng Thái Gửi Tin Realtime</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', color: '#10B981', fontWeight: 700 }}>✓ Socket.IO Connected: 100% thiết bị nhận được thông báo ngay lập tức.</div>
        </div>
      </div>
    );
  }

  if (activeTab === 'mkt-notifications') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>9. Thông Báo Hệ Thống Marketing</h1>
        <div style={{ backgroundColor: 'var(--surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px' }}>Hạ tầng phát thanh Socket.IO và Google Sheets hoạt động bình thường.</div>
        </div>
      </div>
    );
  }

  return null;
};
