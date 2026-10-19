import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';
import { ClaudeService } from './ia/claude.service.js';

@Injectable()
export class AppService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ia: ClaudeService,
  ) {}

  async saude(): Promise<{ ok: boolean; bd: boolean; ia: boolean }> {
    const ia = this.ia.disponivel;
    if (!this.db.enabled) return { ok: true, bd: false, ia };
    try {
      await this.db.query('SELECT 1');
      return { ok: true, bd: true, ia };
    } catch {
      return { ok: true, bd: false, ia };
    }
  }
}
