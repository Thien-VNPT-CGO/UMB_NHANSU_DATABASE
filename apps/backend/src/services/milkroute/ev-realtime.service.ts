import { Server as SocketIOServer, Socket } from 'socket.io';
import { EVWSPayload, EVLiveShiftSummary, EVSLAWarningPayload, EVGPSUpdatePayload } from '@ubm/shared';

export class EVRealtimeService {
  private io: SocketIOServer | null = null;
  private driverSockets = new Map<string, Set<string>>(); // driverId -> Set<socketId>
  private shiftRooms = new Map<string, Set<string>>(); // shiftId -> Set<socketId>
  private adminSockets = new Set<string>();

  setIO(io: SocketIOServer) {
    this.io = io;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      console.log(`[EVRealtime] Client connected: ${socket.id}`);

      // Authenticate and join rooms
      socket.on('ev:auth', (data: { token: string; role: string; driverId?: string }) => {
        // Validate token (simplified - in production use JWT verify)
        const { role, driverId } = data;
        
        if (role === 'DRIVER' && driverId) {
          // Join driver room
          if (!this.driverSockets.has(driverId)) {
            this.driverSockets.set(driverId, new Set());
          }
          this.driverSockets.get(driverId)!.add(socket.id);
          socket.join(`driver:${driverId}`);
          
          // Join current shift room
          socket.emit('ev:auth:success', { driverId });
        } else if (['ADMIN', 'HR', 'FINANCE', 'DIRECTOR', 'FLEET_MANAGER'].includes(role)) {
          // Join admin room
          this.adminSockets.add(socket.id);
          socket.join('admin:live');
          socket.emit('ev:auth:success', { role });
        }
      });

      // Join shift room
      socket.on('ev:join:shift', (data: { shiftId: string }) => {
        const { shiftId } = data;
        if (!this.shiftRooms.has(shiftId)) {
          this.shiftRooms.set(shiftId, new Set());
        }
        this.shiftRooms.get(shiftId)!.add(socket.id);
        socket.join(`shift:${shiftId}`);
      });

      // Leave shift room
      socket.on('ev:leave:shift', (data: { shiftId: string }) => {
        const { shiftId } = data;
        const sockets = this.shiftRooms.get(shiftId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) this.shiftRooms.delete(shiftId);
        }
        socket.leave(`shift:${shiftId}`);
      });

      // Driver GPS update
      socket.on('ev:gps:update', (data: EVGPSUpdatePayload & { shiftId: string; driverId: string }) => {
        this.broadcastGPSUpdate(data.shiftId, data.driverId, data);
      });

      // Disconnect
      socket.on('disconnect', () => {
        console.log(`[EVRealtime] Client disconnected: ${socket.id}`);
        // Clean up
        for (const [driverId, sockets] of this.driverSockets.entries()) {
          sockets.delete(socket.id);
          if (sockets.size === 0) this.driverSockets.delete(driverId);
        }
        for (const [shiftId, sockets] of this.shiftRooms.entries()) {
          sockets.delete(socket.id);
          if (sockets.size === 0) this.shiftRooms.delete(shiftId);
        }
        this.adminSockets.delete(socket.id);
      });
    });
  }

  /** Broadcast GPS update to admin map and shift room */
  broadcastGPSUpdate(shiftId: string, driverId: string, gps: EVGPSUpdatePayload) {
    if (!this.io) return;

    const payload: EVWSPayload<EVGPSUpdatePayload> = {
      event: 'ev:live:gps:update',
      timestamp: new Date().toISOString(),
      data: gps,
      shiftId,
      driverId,
    };

    // Admin live map
    this.io.to('admin:live').emit('ev:live:gps:update', payload);
    
    // Specific shift room
    this.io.to(`shift:${shiftId}`).emit('ev:live:gps:update', payload);
    
    // Driver's own room (for confirmation)
    this.io.to(`driver:${driverId}`).emit('ev:live:gps:update', payload);
  }

  /** Broadcast shift started */
  broadcastShiftStarted(shift: EVLiveShiftSummary) {
    if (!this.io) return;

    const payload: EVWSPayload<EVLiveShiftSummary> = {
      event: 'ev:live:shift:started',
      timestamp: new Date().toISOString(),
      data: shift,
      shiftId: shift.shiftId,
      driverId: shift.driverId,
      vehicleId: shift.vehicleId,
    };

    this.io.to('admin:live').emit('ev:live:shift:started', payload);
    this.io.to(`driver:${shift.driverId}`).emit('ev:live:shift:started', payload);
    this.io.to(`shift:${shift.shiftId}`).emit('ev:live:shift:started', payload);
  }

  /** Broadcast check-in at stop */
  broadcastCheckin(shiftId: string, driverId: string, checkinData: {
    stopId: string;
    stopOrder: number;
    stopName: string;
    checkedInAt: string;
    isLate: boolean;
    lateMinutes: number;
    penaltyAmount: number;
  }) {
    if (!this.io) return;

    const payload: EVWSPayload<any> = {
      event: 'ev:live:shift:checkin',
      timestamp: new Date().toISOString(),
      data: checkinData,
      shiftId,
      driverId,
    };

    this.io.to('admin:live').emit('ev:live:shift:checkin', payload);
    this.io.to(`driver:${driverId}`).emit('ev:live:shift:checkin', payload);
    this.io.to(`shift:${shiftId}`).emit('ev:live:shift:checkin', payload);
  }

  /** Broadcast shift ended */
  broadcastShiftEnded(shiftId: string, driverId: string, summary: {
    totalDistance: number;
    totalDuration: number;
    penaltyPoints: number;
    penaltyAmount: number;
    netPay: number;
  }) {
    if (!this.io) return;

    const payload: EVWSPayload<any> = {
      event: 'ev:live:shift:ended',
      timestamp: new Date().toISOString(),
      data: summary,
      shiftId,
      driverId,
    };

    this.io.to('admin:live').emit('ev:live:shift:ended', payload);
    this.io.to(`driver:${driverId}`).emit('ev:live:shift:ended', payload);
    this.io.to(`shift:${shiftId}`).emit('ev:live:shift:ended', payload);
  }

  /** Broadcast SLA warning */
  broadcastSLAWarning(warning: EVSLAWarningPayload) {
    if (!this.io) return;

    const payload: EVWSPayload<EVSLAWarningPayload> = {
      event: 'ev:live:sla:warning',
      timestamp: new Date().toISOString(),
      data: warning,
      shiftId: warning.shiftId,
      driverId: warning.driverId,
    };

    // Driver gets push notification + in-app
    this.io.to(`driver:${warning.driverId}`).emit('ev:live:sla:warning', payload);
    
    // Admin sees on map
    this.io.to('admin:live').emit('ev:live:sla:warning', payload);
    
    // Shift room
    this.io.to(`shift:${warning.shiftId}`).emit('ev:live:sla:warning', payload);
  }

  /** Broadcast SLA violated */
  broadcastSLAViolated(shiftId: string, driverId: string, data: {
    stopName: string;
    lateMinutes: number;
    penaltyAmount: number;
  }) {
    if (!this.io) return;

    const payload: EVWSPayload<any> = {
      event: 'ev:live:sla:violated',
      timestamp: new Date().toISOString(),
      data,
      shiftId,
      driverId,
    };

    this.io.to('admin:live').emit('ev:live:sla:violated', payload);
    this.io.to(`driver:${driverId}`).emit('ev:live:sla:violated', payload);
    this.io.to(`shift:${shiftId}`).emit('ev:live:sla:violated', payload);
  }

  /** Broadcast charging status change (status = trạng thái THẬT của phiếu) */
  broadcastChargingStatus(
    ticketId: string,
    shiftId: string,
    driverId: string,
    status: 'PENDING_HR' | 'PENDING_DIRECTOR' | 'APPROVED' | 'CHARGING' | 'USED' | 'COMPLETED' | 'REJECTED',
    extra?: any,
  ) {
    if (!this.io) return;

    const payload: EVWSPayload<any> = {
      event: 'ev:live:ticket:status',
      timestamp: new Date().toISOString(),
      data: { ticketId, status, ...extra },
      shiftId,
      driverId,
    };

    this.io.to('admin:live').emit('ev:live:ticket:status', payload);
    this.io.to(`driver:${driverId}`).emit('ev:live:ticket:status', payload);
    this.io.to(`shift:${shiftId}`).emit('ev:live:ticket:status', payload);
    
    // HR room for pending approvals
    if (status === 'APPROVED' || status === 'REJECTED') {
      this.io.to('hr:charging').emit('ev:live:ticket:status', payload);
    }
    // Director room
    if (status === 'APPROVED' || status === 'REJECTED') {
      this.io.to('director:charging').emit('ev:live:ticket:status', payload);
    }
  }

  /**
   * Broadcast toạ độ trạm sạc vừa được tài xế gửi lúc bắt đầu sạc.
   * Trạm sạc không cố định → mỗi lần sạc có thể đổi vị trí; Admin Live Map và
   * chính tài xế nhận ngay toạ độ mới (không chờ vòng poll).
   */
  broadcastChargingStationUpdated(data: {
    ticketId: string;
    shiftId: string;
    driverId: string;
    routeId: string;
    stopId?: string;
    stopName?: string;
    latitude: number;
    longitude: number;
    address?: string;
  }) {
    if (!this.io) return;

    const payload: EVWSPayload<any> = {
      event: 'ev:live:charging-station',
      timestamp: new Date().toISOString(),
      data,
      shiftId: data.shiftId,
      driverId: data.driverId,
    };

    this.io.to('admin:live').emit('ev:live:charging-station', payload);
    this.io.to(`driver:${data.driverId}`).emit('ev:live:charging-station', payload);
    this.io.to(`shift:${data.shiftId}`).emit('ev:live:charging-station', payload);
  }

  /**
   * Broadcast lộ trình của một ngày vừa được duyệt thay đổi.
   * Admin Live Map + app tài xế nhận ngay danh sách điểm dừng mới.
   */
  broadcastRouteChanged(data: {
    requestId: string;
    routeId: string;
    effectiveFrom: string;
    effectiveTo: string;
    productName?: string;
    approvedBy?: string;
  }) {
    if (!this.io) return;
    const payload: EVWSPayload<any> = {
      event: 'ev:live:route-changed',
      timestamp: new Date().toISOString(),
      data,
    };
    this.io.to('admin:live').emit('ev:live:route-changed', payload);
    this.io.emit('ev:live:route-changed', payload);
  }

  /** Broadcast payroll updated */
  broadcastPayrollUpdated(driverId: string, payrollData: any) {
    if (!this.io) return;

    const payload: EVWSPayload<any> = {
      event: 'ev:live:payroll:updated',
      timestamp: new Date().toISOString(),
      data: payrollData,
      driverId,
    };

    this.io.to(`driver:${driverId}`).emit('ev:live:payroll:updated', payload);
    this.io.to('finance:payroll').emit('ev:live:payroll:updated', payload);
    this.io.to('admin:live').emit('ev:live:payroll:updated', payload);
  }

  /** Get connected drivers count */
  getConnectedDriversCount(): number {
    return this.driverSockets.size;
  }

  /** Get connected admins count */
  getConnectedAdminsCount(): number {
    return this.adminSockets.size;
  }
}

// Singleton instance
export const evRealtimeService = new EVRealtimeService();