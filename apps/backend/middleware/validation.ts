import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

export const validateBody = <T>(
  schema: ZodType<T>,
) => {
  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'Datos de entrada inválidos.',
        details: result.error.flatten(),
      });
      return;
    }

    req.body = result.data;
    next();
  };
};
