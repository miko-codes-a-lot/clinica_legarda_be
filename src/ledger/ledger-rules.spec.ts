import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertMinorMoney, assertNewPayment, assertRecordedDate, chargeBalance, installmentAllocation, validateInstallments } from './ledger-rules';

describe('manual ledger and installment business rules', () => {
  it('stores only positive safe integer centavos', () => {
    expect(() => assertMinorMoney(1)).not.toThrow();
    expect(() => assertMinorMoney(100001)).not.toThrow();
    for (const amount of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => assertMinorMoney(amount)).toThrow(BadRequestException);
  });
  it('calculates outstanding amounts from surviving manual payments', () => {
    expect(chargeBalance(100000, [{ amount: 10000 }, { amount: 5000, voidedAt: new Date() }])).toBe(90000);
  });
  it('rejects overpayment without rounding or silently creating credit', () => {
    expect(() => assertNewPayment(90000, 90000)).not.toThrow();
    expect(() => assertNewPayment(90000, 90001)).toThrow(ConflictException);
    expect(() => assertNewPayment(0, 1)).toThrow(ConflictException);
    expect(() => chargeBalance(100, [{ amount: 101 }])).toThrow(ConflictException);
  });
  it('rejects unsafe accumulated arithmetic', () => {
    expect(() => chargeBalance(Number.MAX_SAFE_INTEGER, [{ amount: Number.MAX_SAFE_INTEGER }, { amount: 1 }])).toThrow(BadRequestException);
  });
  const items = () => [{ dueDate: '2026-10-01', amount: 20000 }, { dueDate: '2026-10-31', amount: 40000 }, { dueDate: '2026-11-30', amount: 40000 }];
  it('requires installment dates to increase and their exact sum to equal the charge', () => {
    expect(() => validateInstallments(100000, items())).not.toThrow();
    expect(() => validateInstallments(100001, items())).toThrow(BadRequestException);
    expect(() => validateInstallments(100000, [items()[1], items()[0], items()[2]])).toThrow(BadRequestException);
    expect(() => validateInstallments(100000, [{ dueDate: '2026-02-30', amount: 100000 }])).toThrow(BadRequestException);
    expect(() => validateInstallments(100000, [])).toThrow(BadRequestException);
  });
  it('allocates actual payments oldest due installment first', () => {
    const allocation = installmentAllocation(items(), 30000, '2026-10-03');
    expect(allocation.items.map(item => item.paid)).toEqual([20000, 10000, 0]);
    expect(allocation.items.map(item => item.remaining)).toEqual([0, 30000, 40000]);
    expect(allocation.overdue).toBe(0);
    expect(allocation.upcoming).toBe(70000);
  });
  it('derives overdue amounts and recomputes after payment voids', () => {
    const allocation = installmentAllocation(items(), 10000, '2026-10-03');
    expect(allocation.overdue).toBe(10000);
    expect(allocation.upcoming).toBe(80000);
    expect(installmentAllocation(items(), 0, '2026-11-01').overdue).toBe(60000);
  });
  it('accepts manually recorded past/today dates and rejects future or invalid dates', () => {
    expect(() => assertRecordedDate('2026-10-03', '2026-10-03')).not.toThrow();
    expect(() => assertRecordedDate('2026-01-01', '2026-10-03')).not.toThrow();
    expect(() => assertRecordedDate('2026-10-04', '2026-10-03')).toThrow(BadRequestException);
    expect(() => assertRecordedDate('2026-02-30', '2026-10-03')).toThrow(BadRequestException);
  });
});
