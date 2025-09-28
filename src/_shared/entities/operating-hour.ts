import { Prop, Schema } from '@nestjs/mongoose'

@Schema({ _id: false })
export class OperatingHour {
  @Prop()
  day: string

  @Prop()
  startTime: string

  @Prop()
  endTime: string
}
