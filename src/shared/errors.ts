import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function errorBody(error: unknown) {
  if (error instanceof AppError)
    return {
      status: error.status,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  if (error instanceof ZodError)
    return {
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "输入内容不符合要求",
        details: error.issues,
      },
    };
  return {
    status: 500,
    error: { code: "INTERNAL_ERROR", message: "服务发生错误，请查看本地日志" },
  };
}
