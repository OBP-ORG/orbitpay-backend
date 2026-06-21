import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { requireStellarAddress } from '../middleware/validate';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { beneficiary } = req.query;

    if (!beneficiary) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'beneficiary query parameter is required',
        requestId: req.requestId,
      });
      return;
    }

    if (!requireStellarAddress(String(beneficiary), 'beneficiary', req, res)) return;

    const schedules = await prisma.vestingSchedule.findMany({
      where: { beneficiary: String(beneficiary) },
    });

    res.json(schedules);
  } catch (error) {
    logger.error(req, 'Error fetching vesting schedules', error);
    next(error);
  }
});

router.get('/:id/progress', async (req, res, next) => {
  try {
    const { id } = req.params;

    const schedule = await prisma.vestingSchedule.findUnique({ where: { id: String(id) } });

    if (!schedule) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Vesting schedule not found',
        requestId: req.requestId,
      });
      return;
    }

    const now = new Date();
    const totalDuration = schedule.endTime.getTime() - schedule.startTime.getTime();
    const elapsed = now.getTime() - schedule.startTime.getTime();

    // progress is a display ratio (0–1), not a stored value — floating-point is fine here
    const progress = Math.min(1, Math.max(0, totalDuration > 0 ? elapsed / totalDuration : 0));

    // Multiply using Decimal to avoid floating-point error in the accounting result
    const vestedAmount = schedule.amount.mul(new Prisma.Decimal(progress));

    // Amounts serialised as strings to prevent JSON precision loss
    res.json({
      scheduleId: id,
      totalAmount: schedule.amount.toFixed(),
      vestedAmount: vestedAmount.toFixed(),
      progressPercentage: progress * 100,
    });
  } catch (error) {
    logger.error(req, 'Error fetching vesting progress', error);
    next(error);
  }
});

export default router;
