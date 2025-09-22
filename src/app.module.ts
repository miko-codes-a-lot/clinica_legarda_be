import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // MongooseModule.forRoot(
    //   'mongodb+srv://codecrafters:bh223366.@clinicalegarda.d7awdx.mongodb.net/?retryWrites=true&w=majority&appName=ClinicaLegarda',
    // ),
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
