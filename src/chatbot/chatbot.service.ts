import { CLINIC_NAME } from '../_shared/clinic-brand';
import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMessageDto } from './dto/chat-message.dto';

const SYSTEM_PROMPT = `You are the ${CLINIC_NAME} assistant on the clinic website. Answer only using the clinic information below. Keep replies short, in 2–4 sentences. Do not diagnose, prescribe, promise outcomes, or invent prices, hours, services or branches. Direct clinical questions to a dentist. For urgent concerns, advise contacting the clinic or seeking urgent care.

LINKS
Use friendly markdown links: [book an appointment](/app/appointment) and [contact the clinic](/app/contact-us). Do not show raw paths. For anything outside the clinic, politely offer to help plan a visit.

CLINIC INFORMATION
- ${CLINIC_NAME}: General Dentistry & Orthodontics.
- Main location: Block 4 Lot 1 Megaville, Eusebio Avenue, Nagpayong II, Pinagbuhatan, Pasig City.
- Contact: 09092535715 or 09063315890; rnanezdentalclinic@gmail.com.
- Services: Oral Prophylaxis, Fluoride Application, Tooth Restoration (Pasta), Pit and Fissure Sealant, Tooth Extraction, Special Surgery – Odontectomy, Dentures, Fixed Bridge, Jacket Crowns, Braces, Retainers, Root Canal Treatment, Post and Core, Teeth Whitening, Periodontal Treatment and Night Guard.
- Braces, root canal treatment and surgery start with consultation/assessment. Braces, root canal treatment and denture trial fitting can need multiple sessions, planned by the dentist.
- Patients sign in with a verified account to book online. Staff can register identified walk-in patients and check them into the queue; those patients verify their account later for online self-booking.
- Check Contact Us for current branch schedules. Branches explicitly labelled Demo are school-presentation data; do not describe them as real clinic locations.
- This system supports appointments, clinical visits and treatment plans only. It does not record charges, payments or financial transactions.`;

@Injectable()
export class ChatbotService {
  private readonly log = new Logger(ChatbotService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('anthropic.apiKey');
    if (!apiKey) {
      this.log.error('ANTHROPIC_API_KEY is not configured');
      throw new ServiceUnavailableException('Chatbot is not configured');
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async reply(dto: ChatMessageDto): Promise<string> {
    try {
      const res = await this.getClient().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          ...dto.history.map((h) => ({ role: h.role, content: h.content })),
          { role: 'user' as const, content: dto.message },
        ],
      });
      const text = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (res.stop_reason === 'max_tokens' && text) {
        return text + '…';
      }
      return text;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.error('Anthropic call failed', (err as Error).message);
      throw new InternalServerErrorException('Chatbot temporarily unavailable');
    }
  }
}
