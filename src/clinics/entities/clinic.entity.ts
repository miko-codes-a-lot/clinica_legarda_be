import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { OperatingHour } from "src/_shared/entities/operating-hour";

export type ClinicDocument = HydratedDocument<Clinic>;

@Schema({
  collection: 'clinics',
})
export class Clinic {
  name: string
  address: string
  mobileNumber: string
  emailAddress: string
  operatingHours: OperatingHour[]
  // dentists: User[]
}

export const ClinicSchema = SchemaFactory.createForClass(Clinic)
