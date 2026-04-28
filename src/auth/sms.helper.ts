import axios from 'axios';

/**
 * Normalize a Philippine mobile number to the 639XXXXXXXXX format
 * required by Semaphore. Accepts: +639XXXXXXXXX, 639XXXXXXXXX, 09XXXXXXXXX, 9XXXXXXXXX.
 */
export function normalizeTo639(input: string): string {
  let value: string = input.trim();

  if (value.startsWith('+63')) {
    return value.substring(1);
  }
  if (value.startsWith('63')) {
    return value;
  }
  if (value.startsWith('0')) {
    value = value.substring(1);
  }
  if (!value.startsWith('9') || value.length !== 10) {
    throw new Error('Invalid Philippine mobile number format');
  }

  return `63${value}`;
}

/**
 * Send an SMS via the Semaphore PH gateway. Returns the message_id on success.
 * Reads SEMAPHORE_API_KEY and SEMAPHORE_SENDER_NAME from process.env.
 */
export async function sendViaSemaphore(
  mobileNumber: string,
  message: string,
): Promise<string> {
  const formattedNumber = normalizeTo639(mobileNumber);

  const response = await axios.post(
    'https://api.semaphore.co/api/v4/messages',
    new URLSearchParams({
      sendername: process.env.SEMAPHORE_SENDER_NAME as string,
      apikey: process.env.SEMAPHORE_API_KEY as string,
      number: formattedNumber,
      message,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    },
  );

  const result = response.data?.[0];
  if (!result || !result.message_id) {
    throw new Error('Semaphore did not return message_id');
  }

  return result.message_id;
}
