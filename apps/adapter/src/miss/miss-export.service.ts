/** MissExportService */
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import type { Workbook, Worksheet } from 'exceljs';
import { ConfigService } from '../config/config.service.js';
import { maskPII } from '@cs-bot/shared';

@Injectable()
export class MissExportService {
  constructor(_config: ConfigService) {}

  async queryRecords(days = 90): Promise<any[]> {
    const pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL });
    try {
      const result = await pool.query(
        `SELECT trace_id, chat_id, user_id, question, score, engine, created_at
         FROM miss_record
         WHERE created_at >= now() - interval '${days} days'
         ORDER BY created_at DESC
         LIMIT 50000`,
      );
      return result.rows;
    } finally {
      await pool.end();
    }
  }

  buildStream(): { addRows: (rows: any[]) => void; end: () => void } {
    let writer: any = null;
    let sheet: any = null;
    return {
      addRows(rows: any[]) {
        if (!sheet) return;
        for (const row of rows) {
          sheet.addRow({
            traceId: row.trace_id,
            chatId: row.chat_id,
            userId: maskPII(row.user_id, 'userid'),
            question: row.question,
            score: row.score,
            engine: row.engine,
            createdAt: row.created_at,
          });
        }
      },
      end() {
        try { writer?.commit(); } catch { /* */ }
      },
    };
  }
}
