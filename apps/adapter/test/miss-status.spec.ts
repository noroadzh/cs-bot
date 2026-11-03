/**
 * PATCH /admin/miss/:id — 未命中状态更新
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MissController } from '../src/admin/miss.controller.js';

describe('MissController.updateStatus', () => {
  const exportService = {} as any;
  let updateStatus: jest.MockedFunction<(id: number, status: 0 | 1 | 2) => Promise<boolean>>;
  let controller: MissController;

  beforeEach(() => {
    updateStatus = jest.fn<(id: number, status: 0 | 1 | 2) => Promise<boolean>>();
    controller = new MissController(exportService, { updateStatus } as any);
  });

  it('status=1 → 调用 MissService 并返回', async () => {
    updateStatus.mockResolvedValue(true);
    const res = await controller.updateStatus(42, { status: 1 });
    expect(updateStatus).toHaveBeenCalledWith(42, 1);
    expect(res).toEqual({ id: 42, status: 1 });
  });

  it('非法 status → 400', async () => {
    await expect(controller.updateStatus(1, { status: 9 })).rejects.toBeInstanceOf(BadRequestException);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('记录不存在 → 404', async () => {
    updateStatus.mockResolvedValue(false);
    await expect(controller.updateStatus(99, { status: 2 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
