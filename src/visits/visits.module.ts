import { Module } from '@nestjs/common';
import { LiveModule } from 'src/live/live.module';
import { RoomOpsController } from './room-ops.controller';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [LiveModule],
  controllers: [VisitsController, RoomOpsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
