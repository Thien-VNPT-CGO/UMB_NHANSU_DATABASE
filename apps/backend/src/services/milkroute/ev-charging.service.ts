import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVChargingTicket, EVShift, EVRouteStop } from '@ubm/shared';
import { EVRouteService } from './ev-route.service.js';

export class EVChargingService {
  constructor(
    private readonly repo: MockSheetsAdapter,
    private readonly routes?: EVRouteService,
  ) {}

  /** Điểm dừng hiệu lực của ca (áp phiếu đổi lộ trình nếu có). */
  private async stopsForShift(shift: EVShift): Promise<EVRouteStop[]> {
    if (this.routes) return this.routes.getEffectiveStopsForShift(shift);
    return this.repo.evRouteStops
      .filter(s => s.route_id === shift.route_id)
      .sort((a, b) => a.stop_order - b.stop_order);
  }

  /** Tạo phiếu sạc xe điện */
  async createChargingTicket(input: {
    shiftId: string;
    requestedDate: string;       // YYYY-MM-DD
    batteryLevelPct?: number;
    notes?: string;
  }): Promise<EVChargingTicket> {
    const shift = this.repo.evShifts.find(s => s.shift_id === input.shiftId);
    if (!shift) throw new Error('SHIFT_NOT_FOUND');
    if (shift.status === 'CANCELLED') throw new Error('SHIFT_CANCELLED: Ca đã bị hủy');

    const driver = this.repo.employees.find(e => e.employee_id === shift.driver_id);
    if (!driver) throw new Error('DRIVER_NOT_FOUND');

    // Lộ trình phải có điểm dừng (kể cả trạm sạc) thì phiếu mới có chỗ ghim GPS.
    const stops = await this.stopsForShift(shift);
    if (!stops.length) throw new Error('ROUTE_NOT_CONFIGURED: Lộ trình của ca chưa có điểm dừng');

    // Tài xế được tạo phiếu sạc bất kỳ lúc nào trong ca (không phải chờ giao
    // xong Văn phòng) — phiếu đi thẳng tới Giám đốc hoặc Kế toán duyệt.
    if (input.requestedDate < new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)) {
      throw new Error('DATE_IN_PAST: Ngày dự kiến sạc đã qua — chọn hôm nay hoặc ngày tới');
    }

    // Check if already has pending/approved ticket for this date
    const existingTicket = this.repo.evChargingTickets.find(t =>
      t.shift_id === input.shiftId &&
      t.requested_date === input.requestedDate &&
      ['PENDING_HR', 'PENDING_DIRECTOR', 'APPROVED'].includes(t.status)
    );
    if (existingTicket) throw new Error('TICKET_EXISTS: Đã có phiếu sạc cho ca này vào ngày này');

    // Ghi qua repo để persist xuống ev_charging_tickets.
    return this.repo.createEVChargingTicket({
      shift_id: input.shiftId,
      driver_id: shift.driver_id,
      requested_date: input.requestedDate,
      battery_level_pct: input.batteryLevelPct,
      notes: input.notes,
    });
  }

  /** HR duyệt phiếu sạc (Cấp 1) */
  async approveByHR(ticketId: string, hrId: string, notes?: string): Promise<EVChargingTicket | null> {
    const ticket = this.repo.evChargingTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return null;
    if (ticket.status !== 'PENDING_HR') throw new Error('INVALID_STATUS: Phiếu không ở trạng thái chờ HR duyệt');

    return this.repo.updateEVChargingTicket(ticketId, {
      status: 'PENDING_DIRECTOR',
      hr_approved_by: hrId,
      hr_approved_at: new Date().toISOString(),
      hr_notes: notes,
    });
  }

  /** HR từ chối phiếu sạc */
  async rejectByHR(ticketId: string, hrId: string, notes: string): Promise<EVChargingTicket | null> {
    const ticket = this.repo.evChargingTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return null;
    if (ticket.status !== 'PENDING_HR') throw new Error('INVALID_STATUS: Phiếu không ở trạng thái chờ HR duyệt');

    return this.repo.updateEVChargingTicket(ticketId, {
      status: 'REJECTED',
      hr_approved_by: hrId,
      hr_approved_at: new Date().toISOString(),
      hr_notes: notes,
    });
  }

  /** Giám đốc / Kế toán duyệt phiếu sạc (duyệt 1 cấp, bỏ bước HR).
   *  Nhận cả phiếu cũ còn kẹt ở PENDING_HR để duyệt thay HR. */
  async approveByDirector(ticketId: string, directorId: string, notes?: string): Promise<EVChargingTicket | null> {
    const ticket = this.repo.evChargingTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return null;
    if (!['PENDING_HR', 'PENDING_DIRECTOR'].includes(ticket.status)) {
      throw new Error('INVALID_STATUS: Phiếu không ở trạng thái chờ Giám đốc/Kế toán duyệt');
    }

    return this.repo.updateEVChargingTicket(ticketId, {
      status: 'APPROVED',
      director_approved_by: directorId,
      director_approved_at: new Date().toISOString(),
      director_notes: notes,
    });
  }

  /** Giám đốc / Kế toán từ chối phiếu sạc */
  async rejectByDirector(ticketId: string, directorId: string, notes: string): Promise<EVChargingTicket | null> {
    const ticket = this.repo.evChargingTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return null;
    if (!['PENDING_HR', 'PENDING_DIRECTOR'].includes(ticket.status)) {
      throw new Error('INVALID_STATUS: Phiếu không ở trạng thái chờ Giám đốc/Kế toán duyệt');
    }

    return this.repo.updateEVChargingTicket(ticketId, {
      status: 'REJECTED',
      director_approved_by: directorId,
      director_approved_at: new Date().toISOString(),
      director_notes: notes,
    });
  }

  /** Bắt đầu sạc - lock GPS */
  async startCharging(ticketId: string, location: { latitude: number; longitude: number; accuracy: number }): Promise<EVChargingTicket | null> {
    const ticket = this.repo.evChargingTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return null;
    if (ticket.status !== 'APPROVED') throw new Error('TICKET_NOT_APPROVED: Phiếu chưa được Giám đốc/Kế toán duyệt');
    if (ticket.charging_start_at) throw new Error('ALREADY_CHARGING: Đang sạc');

    // Validate date: chỉ được sạc trong ngày đăng ký (ngày Việt Nam UTC+7)
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    if (ticket.requested_date !== today) {
      throw new Error('INVALID_DATE: Phiếu chỉ có hiệu lực trong ngày đăng ký');
    }

    // Validate GPS accuracy (nới 120m: GPS điện thoại trong cabin/hầm hay sai số)
    if (location.accuracy > 120) {
      throw new Error(`GPS_ACCURACY_LOW: Độ chính xác GPS ±${Math.round(location.accuracy)}m quá thấp (yêu cầu ≤120m)`);
    }

    // Reverse geocode (optional - just store name if available)
    const stationName = await this.reverseGeocode(location.latitude, location.longitude);

    const updated = await this.repo.updateEVChargingTicket(ticketId, {
      charging_start_at: new Date().toISOString(),
      charging_latitude: location.latitude,
      charging_longitude: location.longitude,
      charging_station_name: stationName,
      status: 'USED', // Chuyển sang USED khi bắt đầu sạc
    });

    // Update shift status to CHARGING (ghi qua repo để persist)
    const shift = this.repo.evShifts.find(s => s.shift_id === ticket.shift_id);
    if (shift && shift.status === 'IN_PROGRESS') {
      await this.repo.updateEVShift(ticket.shift_id, { status: 'CHARGING' });
    }

    // TRẠM SẠC KHÔNG CỐ ĐỊNH: lưu toạ độ GPS tài xế gửi lúc bắt đầu sạc vào
    // điểm dừng CHARGING của lộ trình, để các ca sau đi đúng trạm sạc này và
    // Live Map hiển thị đúng vị trí. Lỗi cập nhật không được chặn việc sạc.
    if (shift?.route_id) {
      try {
        const chargingStops = this.repo.evRouteStops.filter(
          s => s.route_id === shift.route_id && s.stop_type === 'CHARGING',
        );
        for (const stop of chargingStops) {
          await this.repo.updateEVRouteStop(stop.stop_id, {
            latitude: location.latitude,
            longitude: location.longitude,
            address: stationName,
            notes: `Toạ độ trạm sạc cập nhật tự động từ GPS tài xế lúc ${new Date().toISOString()}`,
          });
        }
      } catch (err: any) {
        console.warn('[EVCharging] Không lưu được toạ độ trạm sạc:', err?.message || err);
      }
    }

    return updated;
  }

  /** Kết thúc sạc */
  async endCharging(ticketId: string): Promise<EVChargingTicket | null> {
    const ticket = this.repo.evChargingTickets.find(t => t.ticket_id === ticketId);
    if (!ticket) return null;
    if (!ticket.charging_start_at) throw new Error('NOT_CHARGING: Chưa bắt đầu sạc');
    if (ticket.charging_end_at) throw new Error('ALREADY_ENDED: Đã kết thúc sạc');

    const endAt = new Date().toISOString();
    const startAt = new Date(ticket.charging_start_at).getTime();
    const endTime = new Date(endAt).getTime();
    const durationMin = Math.round((endTime - startAt) / 60000);

    const updated = await this.repo.updateEVChargingTicket(ticketId, {
      charging_end_at: endAt,
      charging_duration_min: durationMin,
    });

    // Update shift status to RETURNING (về xưởng)
    const shift = this.repo.evShifts.find(s => s.shift_id === ticket.shift_id);
    if (shift && (shift.status === 'CHARGING' || shift.status === 'IN_PROGRESS')) {
      await this.repo.updateEVShift(ticket.shift_id, { status: 'RETURNING' });
    }

    return updated;
  }

  /** Lấy phiếu sạc theo ID */
  async getChargingTicket(ticketId: string): Promise<EVChargingTicket | null> {
    return this.repo.evChargingTickets.find(t => t.ticket_id === ticketId) || null;
  }

  /** Lấy phiếu sạc theo shift */
  async getChargingTicketsByShift(shiftId: string): Promise<EVChargingTicket[]> {
    return this.repo.evChargingTickets.filter(t => t.shift_id === shiftId);
  }

  /** Lấy phiếu sạc của tài xế */
  async getChargingTicketsByDriver(driverId: string, filters?: { status?: EVChargingTicket['status'] }): Promise<EVChargingTicket[]> {
    let tickets = this.repo.evChargingTickets.filter(t => t.driver_id === driverId);
    if (filters?.status) {
      tickets = tickets.filter(t => t.status === filters.status);
    }
    return tickets.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** Lấy tất cả phiếu sạc (Admin/HR/Director) */
  async listChargingTickets(filters?: {
    status?: EVChargingTicket['status'];
    driverId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<EVChargingTicket[]> {
    let tickets = this.repo.evChargingTickets;
    if (filters?.status) tickets = tickets.filter(t => t.status === filters.status);
    if (filters?.driverId) tickets = tickets.filter(t => t.driver_id === filters.driverId);
    if (filters?.dateFrom) tickets = tickets.filter(t => t.requested_date >= filters.dateFrom!);
    if (filters?.dateTo) tickets = tickets.filter(t => t.requested_date <= filters.dateTo!);
    return tickets.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** Lấy phiếu chờ duyệt HR */
  async getPendingHRTickets(): Promise<EVChargingTicket[]> {
    return this.repo.evChargingTickets.filter(t => t.status === 'PENDING_HR').sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /** Lấy phiếu chờ duyệt (Giám đốc/Kế toán). Gồm cả phiếu cũ còn kẹt ở
   *  PENDING_HR để duyệt thay bước HR đã bỏ. */
  async getPendingDirectorTickets(): Promise<EVChargingTicket[]> {
    return this.repo.evChargingTickets
      .filter(t => t.status === 'PENDING_DIRECTOR' || t.status === 'PENDING_HR')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /** Reverse geocode đơn giản (có thể tích hợp Google Maps API sau) */
  private async reverseGeocode(lat: number, lng: number): Promise<string> {
    // Placeholder - trong production dùng Google Maps Geocoding API
    return `Trạm sạc tại ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}