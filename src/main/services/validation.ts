import { AppError } from './AppError';

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INVALID_ARGUMENT', `${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function requireStringField(value: unknown, field: string): string {
  const record = requireRecord(value, 'Request');
  const fieldValue = record[field];

  if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
    throw new AppError('INVALID_ARGUMENT', `${field} is required.`);
  }

  return fieldValue.trim();
}

export function optionalStringField(value: unknown, field: string): string | undefined {
  const record = requireRecord(value, 'Request');
  const fieldValue = record[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== 'string') {
    throw new AppError('INVALID_ARGUMENT', `${field} must be a string.`);
  }

  return fieldValue.trim() || undefined;
}
