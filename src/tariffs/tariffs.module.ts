import { Module } from '@nestjs/common';
import { TariffsController } from './tariffs.controller';
import { TariffsService } from './tariffs.service';

@Module({
  controllers: [TariffsController],
  providers: [TariffsService],
})
export class TariffsModule {}
