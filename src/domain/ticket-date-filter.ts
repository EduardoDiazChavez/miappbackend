import { z } from "zod";

const dateTimeSchema = z.string().datetime({ offset: true });

export function parseTicketDateRange(dateFrom: unknown, dateTo: unknown) {
  const dateFromResult = dateFrom === undefined ? undefined : dateTimeSchema.safeParse(dateFrom);
  const dateToResult = dateTo === undefined ? undefined : dateTimeSchema.safeParse(dateTo);
  if ((dateFromResult && !dateFromResult.success) || (dateToResult && !dateToResult.success)) {
    return { error: "El rango de fechas indicado no es válido." };
  }

  const start = dateFromResult?.success ? new Date(dateFromResult.data) : undefined;
  const end = dateToResult?.success ? new Date(dateToResult.data) : undefined;
  if (start && end && start >= end) {
    return { error: "La fecha inicial no puede ser posterior o igual a la fecha final." };
  }

  const createdAt: Record<string, Date> = {};
  if (start) createdAt.$gte = start;
  if (end) createdAt.$lt = end;
  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
}
