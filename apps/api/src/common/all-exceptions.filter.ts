import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from "@nestjs/common";
import { AlertService } from "./alert.service.js";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Inject(AlertService) private readonly alerts: AlertService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { send: (body: unknown) => void };
    }>();
    const request = ctx.getRequest<{
      method?: string;
      url?: string;
    }>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? exception.message
        : "Internal server error";

    this.logger.error(
      {
        method: request.method,
        url: request.url,
        statusCode,
        error: exception instanceof Error ? exception.message : String(exception),
      },
      "Unhandled exception",
    );

    if (statusCode >= 500) {
      void this.alerts
        .sendOpsAlert("API server error", {
          method: request.method,
          url: request.url,
          error: exception instanceof Error ? exception.message : String(exception),
        })
        .catch(() => undefined);
    }

    response.status(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? "Internal Server Error" : message,
      message,
    });
  }
}
