import { MockSheetsAdapter } from '../../repositories/mock-sheets.adapter.js';
import { EVRoute, EVRouteStop } from '@ubm/shared';

export class EVRouteService {
  constructor(private readonly repo: MockSheetsAdapter) {}

  // ============================================================
  // ROUTES
  // ============================================================

  async createRoute(input: Omit<EVRoute, 'route_id' | 'created_at' | 'updated_at' | 'version'>): Promise<EVRoute> {
    return this.repo.createEVRoute(input as Partial<EVRoute>);
  }

  async updateRoute(routeId: string, input: Partial<Omit<EVRoute, 'route_id' | 'created_at' | 'version'>>): Promise<EVRoute | null> {
    try {
      return await this.repo.updateEVRoute(routeId, input as Partial<EVRoute>);
    } catch (err: any) {
      if (String(err?.message || '').startsWith('ROUTE_NOT_FOUND')) return null;
      throw err;
    }
  }

  async deleteRoute(routeId: string): Promise<boolean> {
    // Check if any stops/shifts reference this route (repo cũng kiểm lại khi ghi).
    if (this.repo.evRouteStops.some(s => s.route_id === routeId)) {
      throw new Error('ROUTE_HAS_STOPS: Không thể xóa lộ trình đang có điểm dừng');
    }
    if (this.repo.evShifts.some(s => s.route_id === routeId)) {
      throw new Error('ROUTE_HAS_SHIFTS: Không thể xóa lộ trình đang có ca vận chuyển');
    }
    return this.repo.deleteEVRoute(routeId);
  }

  async getRoute(routeId: string): Promise<EVRoute | null> {
    return this.repo.evRoutes.find(r => r.route_id === routeId) || null;
  }

  async listRoutes(filters?: { isActive?: boolean }): Promise<EVRoute[]> {
    let routes = this.repo.evRoutes;
    if (filters?.isActive !== undefined) {
      routes = routes.filter(r => r.is_active === filters.isActive);
    }
    return routes.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getActiveRoute(): Promise<EVRoute | null> {
    return this.repo.evRoutes.find(r => r.is_active) || null;
  }

  // ============================================================
  // ROUTE STOPS
  // ============================================================

  async createRouteStop(input: Omit<EVRouteStop, 'stop_id' | 'created_at' | 'updated_at' | 'version'>): Promise<EVRouteStop> {
    // Validate route exists
    const route = await this.getRoute(input.route_id);
    if (!route) throw new Error('ROUTE_NOT_FOUND');
    return this.repo.createEVRouteStop(input as Partial<EVRouteStop>);
  }

  async updateRouteStop(stopId: string, input: Partial<Omit<EVRouteStop, 'stop_id' | 'created_at' | 'version'>>): Promise<EVRouteStop | null> {
    try {
      return await this.repo.updateEVRouteStop(stopId, input as Partial<EVRouteStop>);
    } catch (err: any) {
      if (String(err?.message || '').startsWith('STOP_NOT_FOUND')) return null;
      throw err;
    }
  }

  async deleteRouteStop(stopId: string): Promise<boolean> {
    // Check if any checkins reference this stop
    const hasCheckins = this.repo.evShiftCheckins.some(c => c.stop_id === stopId);
    if (hasCheckins) {
      throw new Error('STOP_HAS_CHECKINS: Không thể xóa điểm dừng đã có check-in');
    }
    return this.repo.deleteEVRouteStop(stopId);
  }

  async getRouteStop(stopId: string): Promise<EVRouteStop | null> {
    return this.repo.evRouteStops.find(s => s.stop_id === stopId) || null;
  }

  async listRouteStops(routeId: string): Promise<EVRouteStop[]> {
    return this.repo.evRouteStops
      .filter(s => s.route_id === routeId)
      .sort((a, b) => a.stop_order - b.stop_order);
  }

  async getMandatoryStops(routeId: string): Promise<EVRouteStop[]> {
    return (await this.listRouteStops(routeId)).filter(s => s.is_mandatory);
  }
}