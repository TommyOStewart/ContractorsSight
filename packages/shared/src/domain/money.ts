import { z } from "zod";

/**
 * Money is stored as integer cents (bigint `*_cents` columns). LLM tools take decimal
 * dollars because that is what people say out loud; convert at the boundary with
 * `dollarsToCents`, never by hand.
 */
export const dollarsSchema = (description: string) =>
  z.number().nonnegative().max(10_000_000).meta({ description: `${description} In dollars, e.g. 42.5.` });

export function dollarsToCents(dollars: number): number {
  // Shift the decimal point in the string form: 19.995 * 100 is 1999.4999… in floating point.
  return Math.round(Number(`${dollars}e2`));
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}
