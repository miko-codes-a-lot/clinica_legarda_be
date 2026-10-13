import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import {
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotService } from './chatbot.service';

interface ProviderReply {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: object }
  >;
  stop_reason: string;
}

const create = jest.fn<
  Promise<ProviderReply>,
  [MessageCreateParamsNonStreaming]
>();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class {
    messages = { create };
  },
}));

describe('Chatbot provider contract', () => {
  let service: ChatbotService;

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'A helpful reply.' }],
      stop_reason: 'end_turn',
    });
    service = new ChatbotService(
      new ConfigService({ anthropic: { apiKey: 'test-key' } }),
    );
  });

  function emittedPrompt(): string {
    const system = create.mock.calls[0][0].system;
    if (typeof system !== 'string')
      throw new Error('Expected a text system prompt');
    return system;
  }

  it('supplies conservative toothache and loose-braces guidance instead of blanket clinical refusal', async () => {
    await service.reply({
      history: [],
      message: 'can you give me tips what to do when my braces fell off',
    });
    const prompt = emittedPrompt();
    expect(prompt).toContain('orthodontic wax');
    expect(prompt).toContain('warm salt water');
    expect(prompt).toContain('soft foods');
    expect(prompt).toContain('difficulty breathing or swallowing');
    expect(prompt).toContain('Do not diagnose');
    expect(prompt).toContain('Do not prescribe');
    expect(prompt).not.toContain('Direct clinical questions to a dentist.');
    expect(prompt).not.toContain(
      'Answer only using the clinic information below.',
    );
  });

  it('requires usable booking and contact links while deferring current hours to the contact page', async () => {
    await service.reply({
      history: [],
      message: 'where to an book appointment',
    });
    const prompt = emittedPrompt();
    expect(prompt).toContain(
      'ALWAYS include [book an appointment](/app/appointment)',
    );
    expect(prompt).toContain('[contact the clinic](/app/contact-us)');
    expect(prompt).toContain('Check Contact Us for current branch schedules.');
    expect(prompt).toContain('Do not use bold');
    expect(prompt).toContain('verified account');
  });

  it('keeps the configured Haiku model and sends the original transcript in order', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: ' First paragraph. ' },
        { type: 'tool_use', id: 'tool-test', name: 'unused', input: {} },
        { type: 'text', text: 'Second paragraph. ' },
      ],
      stop_reason: 'end_turn',
    });
    const result = await service.reply({
      history: [
        { role: 'user', content: 'Can I book?' },
        {
          role: 'assistant',
          content: '[book an appointment](/app/appointment)',
        },
      ],
      message: 'What if my tooth hurts?',
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'Can I book?' },
        {
          role: 'assistant',
          content: '[book an appointment](/app/appointment)',
        },
        { role: 'user', content: 'What if my tooth hurts?' },
      ],
    });
    expect(result).toBe('First paragraph. \nSecond paragraph.');
  });

  it('marks an incomplete provider reply without adding content', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Partial reply' }],
      stop_reason: 'max_tokens',
    });
    await expect(
      service.reply({ history: [], message: 'Tell me about braces' }),
    ).resolves.toBe('Partial reply…');
  });

  it('returns a configuration failure without contacting the provider', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      service = new ChatbotService(new ConfigService());
      await expect(
        service.reply({ history: [], message: 'Can I book?' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(create).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('maps provider failures to the stable public error', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      create.mockRejectedValue(new Error('Provider unavailable'));
      await expect(
        service.reply({ history: [], message: 'Can I book?' }),
      ).rejects.toEqual(
        new InternalServerErrorException('Chatbot temporarily unavailable'),
      );
    } finally {
      log.mockRestore();
    }
  });
});
