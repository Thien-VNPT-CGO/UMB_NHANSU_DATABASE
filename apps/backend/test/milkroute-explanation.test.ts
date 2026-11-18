import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { EVRouteService } from '../src/services/milkroute/ev-route.service.js';
import { EVExplanationService } from '../src/services/milkroute/ev-explanation.service.js';
import { EVPayrollService } from '../src/services/milkroute/ev-payroll.service.js';
import { deleteExplanationPhotos } from '../src/services/milkroute/ev-explanation-photo.store.js';
import { DEFAULT_EV_PAYROLL_CONFIG } from '@ubm/shared';

/**
 * Phiếu giải trình lỗi tài xế:
 *  - Quên bấm xác nhận (is_missed) → duyệt xong điểm thành hoàn thành.
 *  - Trễ giờ/SLA (is_late) → duyệt xong xóa cờ trễ + trừ lại điểm phạt của ca.
 *  - Cả hai trường hợp duyệt xong đều không còn bị trừ tiền khi chạy bảng lương.
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const todayVN = () => new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
const DRIVER_ID = 'EMP_DRIVER_EXP';
const PHOTO_DATA_URL = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function setup() {
  const repo = new MockSheetsAdapter();
  repo.employees.push({
    employee_id: DRIVER_ID,
    employee_code: 'UBM_EVEXP',
    full_name: 'Tài xế Giải Trình',
    employment_status: 'OFFICIAL',
    group: 'XUONG',
    default_branch_id: 'XUONG_SX',
  } as any);

  const route = await repo.createEVRoute({ name: 'Tuyến giải trình', is_active: true } as any);
  const stops = [];
  for (let i = 1; i <= 3; i++) {
    stops.push(await repo.createEVRouteStop({
      route_id: route.route_id,
      stop_order: i,
      name: i === 1 ? 'Xưởng' : i === 2 ? 'Cửa hàng CH130' : 'Về xưởng',
      latitude: 10.8 + i / 1000,
      longitude: 106.6 + i / 1000,
      geofence_radius_m: 100,
      sla_minutes: 30,
      stop_type: i === 1 ? 'START' : i === 3 ? 'END' : 'DELIVERY',
      is_mandatory: true,
    } as any));
  }

  const vehicle = await repo.createEVVehicle({
    license_plate: '29H-888.88',
    assigned_driver_id: DRIVER_ID,
    status: 'ACTIVE',
  } as any);

  const shift = await repo.createEVShift({
    route_id: route.route_id,
    driver_id: DRIVER_ID,
    vehicle_id: vehicle.vehicle_id,
    shift_date: todayVN(),
    planned_start_at: `${todayVN()}T08:00:00+07:00`,
    planned_end_at: `${todayVN()}T14:00:00+07:00`,
    work_day_index: 1,
    status: 'COMPLETED',
    actual_start_at: `${todayVN()}T08:00:00+07:00`,
    actual_end_at: `${todayVN()}T13:00:00+07:00`,
    penalty_points: 1,
    created_by: 'TEST',
  } as any);

  // Điểm 1 đúng giờ, điểm 2 trễ 15 phút (đã cộng 1 điểm phạt cho ca),
  // điểm 3 bị đánh dấu bỏ lọt khi kết thúc ca.
  await repo.createEVShiftCheckin({
    shift_id: shift.shift_id,
    stop_id: stops[0].stop_id,
    stop_order: 1,
    stop_name: stops[0].name,
    checked_in_at: `${todayVN()}T08:05:00+07:00`,
    is_late: false,
  } as any);
  await repo.createEVShiftCheckin({
    shift_id: shift.shift_id,
    stop_id: stops[1].stop_id,
    stop_order: 2,
    stop_name: stops[1].name,
    checked_in_at: `${todayVN()}T09:20:00+07:00`,
    sla_minutes: 30,
    actual_travel_min: 45,
    is_late: true,
    late_minutes: 15,
  } as any);
  await repo.createEVShiftCheckin({
    shift_id: shift.shift_id,
    stop_id: stops[2].stop_id,
    stop_order: 3,
    stop_name: stops[2].name,
    is_late: true,
    late_minutes: 0,
    is_missed: true,
  } as any);

  const routes = new EVRouteService(repo);
  const explanations = new EVExplanationService(repo, routes);
  const payroll = new EVPayrollService(repo, undefined, routes);

  return { repo, route, stops, shift, routes, explanations, payroll };
}

const createTicket = async (service: EVExplanationService, shift: any, stopIds: string[]) => {
  return service.createTicket(DRIVER_ID, {
    reason: 'Xe kẹt đường và điện thoại mất mạng, có ảnh bằng chứng kèm theo.',
    items: stopIds.map(stop_id => ({ shift_id: shift.shift_id, stop_id })),
    photos: [{ data_url: PHOTO_DATA_URL, mime_type: 'image/png', name: 'bang-chung.png' }],
  });
};

test('Candidate gồm cả lỗi trễ giờ và quên chấm, kèm số phút + tiền phạt', async () => {
  const { stops, explanations } = await setup();
  const candidates = await explanations.listCandidates(DRIVER_ID);

  assert.equal(candidates.length, 2);
  const late = candidates.find(c => c.stop_id === stops[1].stop_id);
  const missed = candidates.find(c => c.stop_id === stops[2].stop_id);
  assert.equal(late?.issue_type, 'LATE_SLA');
  assert.equal(late?.late_minutes, 15);
  assert.equal(missed?.issue_type, 'MISSED_CHECKIN');

  const latePenalty = Math.round(DEFAULT_EV_PAYROLL_CONFIG.standard_daily_rate
    * DEFAULT_EV_PAYROLL_CONFIG.penalty_per_late_sla.standard);
  const missedPenalty = Math.round(DEFAULT_EV_PAYROLL_CONFIG.standard_daily_rate
    * DEFAULT_EV_PAYROLL_CONFIG.penalty_per_missed_checkin.standard);
  assert.equal(late?.penalty_amount, latePenalty);
  assert.equal(missed?.penalty_amount, missedPenalty);
});

test('Tạo phiếu cho lỗi trễ giờ + quên chấm: lưu loại lỗi và tổng tiền đền bù', async () => {
  const { shift, stops, explanations } = await setup();
  const ticket = await createTicket(explanations, shift, [stops[1].stop_id, stops[2].stop_id]);
  try {
    assert.equal(ticket.status, 'PENDING');
    assert.equal(ticket.items.length, 2);
    const late = ticket.items.find(i => i.stop_id === stops[1].stop_id);
    const missed = ticket.items.find(i => i.stop_id === stops[2].stop_id);
    assert.equal(late?.issue_type, 'LATE_SLA');
    assert.equal(late?.late_minutes, 15);
    assert.equal(missed?.issue_type, 'MISSED_CHECKIN');
    assert.ok(Number(ticket.total_penalty_amount) > 0);
    // Đã có phiếu PENDING → không còn hiện lại trong danh sách chờ.
    assert.equal((await explanations.listCandidates(DRIVER_ID)).length, 0);
  } finally {
    deleteExplanationPhotos(ticket.ticket_id);
  }
});

test('Duyệt phiếu: xóa phạt trễ giờ + hoàn thành điểm bỏ lọt, bảng lương không còn phạt', async () => {
  const { repo, shift, stops, explanations, payroll } = await setup();
  const ticket = await createTicket(explanations, shift, [stops[1].stop_id, stops[2].stop_id]);
  try {
    await explanations.approve(ticket.ticket_id, 'FIN_1', 'Kế toán', 'Đã kiểm tra ảnh');

    const lateCheckin = repo.evShiftCheckins.find(c => c.stop_id === stops[1].stop_id)!;
    const missedCheckin = repo.evShiftCheckins.find(c => c.stop_id === stops[2].stop_id)!;
    assert.equal(lateCheckin.is_late, false);
    assert.equal(lateCheckin.late_minutes, 0);
    assert.equal(missedCheckin.is_missed, false);
    assert.equal(missedCheckin.is_late, false);

    const updatedShift = repo.evShifts.find(s => s.shift_id === shift.shift_id)!;
    assert.equal(updatedShift.penalty_points, 0, 'trừ lại điểm phạt đã cộng khi check-in trễ');

    const result = await payroll.calculateDriverPayroll(DRIVER_ID, shift.shift_date.slice(0, 7));
    assert.equal(result.total_penalty_amount, 0);
    assert.equal(result.penalty_breakdown.missed_checkins, 0);
    assert.equal(result.penalty_breakdown.late_sla, 0);

    assert.equal((await explanations.listCandidates(DRIVER_ID)).length, 0);
  } finally {
    deleteExplanationPhotos(ticket.ticket_id);
  }
});

test('Điểm bỏ lọt không bị phạt chồng thêm phạt trễ giờ', async () => {
  const { shift, payroll } = await setup();
  const result = await payroll.calculateDriverPayroll(DRIVER_ID, shift.shift_date.slice(0, 7));

  const missedPenalty = Math.round(DEFAULT_EV_PAYROLL_CONFIG.standard_daily_rate
    * DEFAULT_EV_PAYROLL_CONFIG.penalty_per_missed_checkin.standard);
  const latePenalty = Math.round(DEFAULT_EV_PAYROLL_CONFIG.standard_daily_rate
    * DEFAULT_EV_PAYROLL_CONFIG.penalty_per_late_sla.standard);
  // 1 điểm bỏ lọt + 1 điểm trễ thật → chỉ 2 khoản, không cộng trễ cho điểm bỏ lọt.
  assert.equal(result.penalty_breakdown.missed_checkins, 1);
  assert.equal(result.penalty_breakdown.late_sla, 1);
  assert.equal(result.total_penalty_amount, missedPenalty + latePenalty);
});

test('Từ chối phiếu: giữ nguyên phạt trễ giờ và lỗi hiện lại để giải trình', async () => {
  const { repo, shift, stops, explanations } = await setup();
  const ticket = await createTicket(explanations, shift, [stops[1].stop_id]);
  try {
    await explanations.reject(ticket.ticket_id, 'FIN_1', 'Kế toán', 'Ảnh không rõ');
    const lateCheckin = repo.evShiftCheckins.find(c => c.stop_id === stops[1].stop_id)!;
    assert.equal(lateCheckin.is_late, true, 'từ chối không xóa phạt');
    const candidates = await explanations.listCandidates(DRIVER_ID);
    assert.ok(candidates.some(c => c.stop_id === stops[1].stop_id && c.issue_type === 'LATE_SLA'));
  } finally {
    deleteExplanationPhotos(ticket.ticket_id);
  }
});
