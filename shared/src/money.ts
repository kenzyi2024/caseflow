/**
 * Money is always handled as integer cents to avoid floating-point drift
 * (0.1 + 0.2 !== 0.3). Convert at the edges only. See ADR-0003.
 */
export type Cents = number;

export const dollarsToCents = (dollars: number): Cents => Math.round(dollars * 100);

export const centsToDollars = (cents: Cents): number => cents / 100;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatCents = (cents: Cents): string => usd.format(cents / 100);

/** Round up to the next whole dollar (SNAP rounds the household contribution up). */
export const ceilToDollar = (cents: Cents): Cents => Math.ceil(cents / 100) * 100;
