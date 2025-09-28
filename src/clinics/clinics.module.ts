import { Module } from '@nestjs/common';
import { ClinicsService } from './clinics.service';
import { ClinicsController } from './clinics.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from './entities/clinic.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [ClinicsController],
  providers: [ClinicsService],
  exports: [ClinicsService],
})
export class ClinicsModule {}
