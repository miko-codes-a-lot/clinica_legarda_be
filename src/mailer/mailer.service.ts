import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import configuration from 'src/_shared/configuration';

@Injectable()
export class MailerService {
  private oAuth2Client: InstanceType<typeof google.auth.OAuth2>;

  constructor() {
    const { clientId, clientSecret, refreshToken } = configuration().gmail;
    this.oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
    this.oAuth2Client.setCredentials({ refresh_token: refreshToken });
  }

  async sendOtp(to: string, code: string): Promise<void> {
    const { from } = configuration().gmail;

    const subject = 'Login OTP - Clinica Legarda';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1976d2, #63a4ff); padding: 32px 40px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Clinica Legarda</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
              <h2 style="margin: 0 0 8px; color: #333333; font-size: 20px; font-weight: 600;">Login Verification</h2>
              <p style="margin: 0 0 24px; color: #666666; font-size: 14px; line-height: 1.5;">Use the code below to verify your identity. This code is valid for <strong>5 minutes</strong>.</p>
              <!-- OTP Code Box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 0 0 24px;">
                    <div style="display: inline-block; background-color: #f5f5f5; border: 2px solid #1976d2; border-radius: 8px; padding: 16px 32px;">
                      <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #1976d2;">${code}</span>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; color: #666666; font-size: 13px; line-height: 1.5;">If you did not request this code, you can safely ignore this email. Someone may have entered your email address by mistake.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center;">
              <p style="margin: 0 0 4px; color: #999999; font-size: 12px;">Clinica Legarda</p>
              <p style="margin: 0; color: #999999; font-size: 11px;">This is an automated message. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const rawMessage = this.buildRawMessage(from!, to, subject, html);
    const gmail = google.gmail({ version: 'v1', auth: this.oAuth2Client });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage },
    });
  }

  private buildRawMessage(
    from: string,
    to: string,
    subject: string,
    html: string,
  ): string {
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ].join('\r\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
