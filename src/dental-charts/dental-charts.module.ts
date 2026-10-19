import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CareModule } from '../care/care.module';
import { PatientRecordChangesModule } from '../patient-record-changes/patient-record-changes.module';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalChart, DentalChartSchema, DentalChartVersion, DentalChartVersionSchema } from './entities/dental-chart.entity';
import { DentalChartsService } from './dental-charts.service';
import { DentalChartsController } from './dental-charts.controller';
@Module({ imports: [CareModule, PatientRecordChangesModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }, { name: Clinic.name, schema: ClinicSchema }, { name: DentalChart.name, schema: DentalChartSchema }, { name: DentalChartVersion.name, schema: DentalChartVersionSchema }])], providers: [DentalChartsService], controllers: [DentalChartsController] })
export class DentalChartsModule {}
