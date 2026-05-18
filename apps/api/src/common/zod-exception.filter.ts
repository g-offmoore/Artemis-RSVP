import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { ZodError } from "zod";

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const issues = error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join(".") : "body",
      message: issue.message,
    }));

    response.status(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: "Validation failed",
      issues,
    });
  }
}
