/**
 * Asset 响应 DTO
 *
 * 与 asset.entity.ts 的 Asset 行结构一一对应。
 * 独立 class 是因为 swagger 只能从 class 的 @ApiProperty 反射出 schema。
 */
import { ApiProperty } from '@nestjs/swagger';

/** media_assets 表行 */
export class AssetDto {
  @ApiProperty({ description: '素材 id（uuid）', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: '素材名称', example: '产品介绍图' })
  name!: string;

  @ApiProperty({ description: '来源类型：upload 上传 / link 外链', enum: ['upload', 'link'] })
  source!: 'upload' | 'link';

  @ApiProperty({ description: 'MIME 类型', example: 'image/jpeg' })
  mimetype!: string;

  @ApiProperty({ description: '字节数；外链素材为 0', example: 10240 })
  sizeBytes!: number;

  @ApiProperty({ description: '外链地址；上传素材为 null', type: 'string', nullable: true })
  url!: string | null;

  @ApiProperty({ description: '创建时间（ISO 8601）', example: '2026-10-16T09:30:00.000Z' })
  createdAt!: string;
}

/** POST /admin/assets · 201 */
export class AssetCreateResponseDto {
  @ApiProperty({ description: '是否成功', example: true })
  success!: boolean;

  @ApiProperty({ type: AssetDto })
  asset!: AssetDto;
}

/** GET /admin/assets · 200 */
export class AssetListResponseDto {
  @ApiProperty({ description: '是否成功', example: true })
  success!: boolean;

  @ApiProperty({ description: '总条数', example: 3 })
  total!: number;

  @ApiProperty({ description: '本次每页数量', example: 20 })
  limit!: number;

  @ApiProperty({ description: '本次偏移量', example: 0 })
  offset!: number;

  @ApiProperty({ type: [AssetDto] })
  assets!: AssetDto[];
}

/** GET /admin/assets/:id · 200 */
export class AssetGetResponseDto {
  @ApiProperty({ description: '是否成功', example: true })
  success!: boolean;

  @ApiProperty({ type: AssetDto })
  asset!: AssetDto;
}

/** DELETE /admin/assets/:id · 200 */
export class AssetDeleteResponseDto {
  @ApiProperty({ description: '是否成功', example: true })
  success!: boolean;

  @ApiProperty({ description: '是否已删除', example: true })
  deleted!: boolean;
}
