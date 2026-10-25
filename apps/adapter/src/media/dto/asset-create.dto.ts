/**
 * POST /admin/assets 的 JSON body DTO
 *
 * POST 同时支持 multipart/form-data（file 字段）和 application/json（url+name），
 * 因此该 DTO 仅描述 JSON 形态；multipart 形态由控制器上的 @ApiBody schema.oneOf 描述。
 */
import { ApiProperty } from '@nestjs/swagger';

export class AssetCreateFromLinkDto {
  @ApiProperty({ description: '素材链接（http/https）' })
  url!: string;

  @ApiProperty({ description: '素材名称' })
  name!: string;
}
