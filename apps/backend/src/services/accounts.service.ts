import { Server } from 'socket.io';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

/**
 * Quản lý tài khoản nhân viên — chỉ còn PIN (HR cấp/reset).
 * Đã bỏ hoàn toàn luồng kích hoạt/khóa tài khoản.
 */
export class AccountsService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async getAccount(id: string) {
    return this.repo.getAccountById(id);
  }
}
