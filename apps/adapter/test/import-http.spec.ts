import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ImportController } from '../src/import/import.controller.js';
import { ImportJobService } from '../src/import/import-job.service.js';
import { AdminGuard } from '../src/admin/admin.guard.js';

describe('ImportController HTTP', () => {
  let app: any;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [
        { provide: ImportJobService, useValue: { startParse: async (id: string) => ({ id, status: 'uploaded' }) } },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('POST /admin/import-jobs/:id/parse returns 202', async () => {
    const res = await request(app.getHttpServer()).post('/admin/import-jobs/j1/parse');
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('uploaded');
  });
});
