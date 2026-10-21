import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DocsController } from './docs.controller.js';
import { OpenApiService } from './openapi.service.js';

@Module({
  imports: [DiscoveryModule],
  controllers: [DocsController],
  providers: [OpenApiService],
})
export class DocsModule {}
