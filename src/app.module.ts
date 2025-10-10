import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ConfigModule } from '@nestjs/config';
import { ClinicsModule } from './clinics/clinics.module';
import { DentalCatalogModule } from './dental-catalog/dental-catalog.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { NotificationsModule } from './notifications/notifications.module';
import configuration from './_shared/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: configuration().db.uri,
        dbName: configuration().db.name,
      }),
    }),
    AuthModule,
    UsersModule,
    ClinicsModule,
    DentalCatalogModule,
    AppointmentsModule,
    NotificationsModule,
    RtNotifModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
