/** Result of a server action behind a form. Shared by server and client. */
export type FormState = {
  ok?: string;
  errors?: Record<string, string>;
  /** Changes on every submit so the client can react to a new result. */
  at?: number;
};

/** Turns an extension error body ({field: message | [message]}) into form errors. */
export function errorsFrom(body: unknown, fallback = 'This did not work. Try again.'): Record<string, string> {
  const errors: Record<string, string> = {};
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      errors[key === 'detail' || key === 'non_field_errors' ? 'form' : key] = Array.isArray(value)
        ? String(value[0])
        : String(value);
    }
  }
  return Object.keys(errors).length ? errors : { form: fallback };
}
