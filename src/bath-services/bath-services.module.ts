import { Module } from '@nestjs/common';
import { BathServicesController } from './bath-services.controller';
import { BathServicesService } from './bath-services.service';

@Module({
  controllers: [BathServicesController],
  providers: [BathServicesService],
})
export class BathServicesModule {}
