import { BadRequestException, ConflictException } from '@nestjs/common';

export interface InstallmentItem { dueDate: string; amount: number; }
export function assertMinorMoney(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Amounts must be positive integer PHP centavos.');
}
export function sumMoney(values: readonly number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value))
      throw new BadRequestException('The monetary total exceeds the supported amount.');
    return total + value;
  }, 0);
}
export function chargeBalance(amount: number, payments: readonly { amount: number; voidedAt?: Date }[]): number {
  assertMinorMoney(amount);
  const amounts = payments.filter(payment => !payment.voidedAt).map(payment => { assertMinorMoney(payment.amount); return payment.amount; });
  const paid = sumMoney(amounts);
  if (paid > amount) throw new ConflictException('Recorded payments exceed this charge.');
  return amount - paid;
}
export function assertNewPayment(balance: number, amount: number): void {
  assertMinorMoney(amount);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new BadRequestException('The charge balance is unavailable.');
  if (amount > balance) throw new ConflictException('This payment exceeds the outstanding charge balance.');
}
export function assertCalendarDate(value: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException('Enter a valid calendar date as YYYY-MM-DD.');
}
export function validateInstallments(charge: number, items: readonly InstallmentItem[]): void {
  assertMinorMoney(charge);
  if (!items.length || items.length > 120) throw new BadRequestException('Enter between 1 and 120 installments.');
  let previous = '';
  for (const item of items) {
    assertCalendarDate(item.dueDate); assertMinorMoney(item.amount);
    if (item.dueDate <= previous) throw new BadRequestException('Installment dates must be unique and increasing.');
    previous = item.dueDate;
  }
  if (sumMoney(items.map(item => item.amount)) !== charge) throw new BadRequestException('Installments must total the full charge exactly.');
}
export function installmentAllocation(items: readonly InstallmentItem[], paid: number, day: string) {
  assertCalendarDate(day);
  const total = sumMoney(items.map(item => item.amount));
  validateInstallments(total, items);
  if (!Number.isSafeInteger(paid) || paid < 0 || paid > total) throw new ConflictException('The installment payment total is invalid.');
  let available = paid;
  const allocated = items.map(item => {
    const amountPaid = Math.min(available, item.amount); available -= amountPaid;
    return { ...item, paid: amountPaid, remaining: item.amount - amountPaid };
  });
  return { items: allocated, overdue: sumMoney(allocated.filter(item => item.dueDate < day).map(item => item.remaining)),
    upcoming: sumMoney(allocated.filter(item => item.dueDate >= day).map(item => item.remaining)),
  };
}
export function assertRecordedDate(date: string, today: string): void {
  assertCalendarDate(date); assertCalendarDate(today);
  if (date > today) throw new BadRequestException('A manually recorded charge or payment cannot be dated in the future.');
}
