import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Injectable()
export class AppService {
  constructor(private readonly db: DatabaseService) {}

  async saude(): Promise<{ ok: boolean; bd: boolean }> {
    if (!this.db.enabled) return { ok: true, bd: false };
    try {
      await this.db.query('SELECT 1');
      return { ok: true, bd: true };
    } catch {
      return { ok: true, bd: false };
    }
  }
}
