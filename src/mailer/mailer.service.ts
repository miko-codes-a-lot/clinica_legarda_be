import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import configuration from 'src/_shared/configuration';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter;

  constructor() {
    const smtp = configuration().smtp;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });
  }

  async sendOtp(to: string, code: string): Promise<void> {
    const smtp = configuration().smtp;
    await this.transporter.sendMail({
      from: smtp.from,
      to,
      subject: 'Your Login Verification Code - Clinica Legarda',
      html: `
        <h2>Login Verification</h2>
        <p>Your one-time verification code is:</p>
        <h1 style="letter-spacing: 8px; font-size: 36px;">${code}</h1>
        <p>This code expires in 5 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    });
  }
}
