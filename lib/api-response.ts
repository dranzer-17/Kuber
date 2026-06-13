export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export const ok = <T>(data: T): Response =>
  Response.json({ success: true, data, error: null });

export const fail = (
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response =>
  Response.json(
    { success: false, data: null, error: { code, message, details } },
    { status }
  );
