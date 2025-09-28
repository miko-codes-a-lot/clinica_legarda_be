import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { OperatingHour } from "src/_shared/entities/operating-hour";

export type ClinicDocument = HydratedDocument<Clinic>;

@Schema({
  collection: 'clinics',
})
export class Clinic {
  @Prop()
  name: string

  @Prop()
  address: string

  @Prop()
  mobileNumber: string

  @Prop()
  emailAddress: string

  @Prop()
  operatingHours: OperatingHour[]

  // dentists: User[]
}

export const ClinicSchema = SchemaFactory.createForClass(Clinic)
