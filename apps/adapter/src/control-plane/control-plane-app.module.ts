import { Global, Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ControlPlaneHealthController } from './control-plane-health.controller.js';

/** 独立控制面的 ConfigService provider（值在 main 启动前注入静态单例） */
@Global()
@Module({
  providers: [{ provide: ConfigService, useFactory: () => ConfigService.instance }],
  exports: [ConfigService],
})
class ControlPlaneConfigModule {}

@Module({
  imports: [ControlPlaneConfigModule, PlatformModule.forRoot()],
  controllers: [ControlPlaneHealthController],
})
export class ControlPlaneAppModule {}
