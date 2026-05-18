import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
})
export class AppModule {}