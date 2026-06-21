import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { parsePagePagination } from '../middleware/validate';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const pagination = parsePagePagination(req, res);
    if (!pagination) return;
    const { page, limitNum } = pagination;

    const [proposals, total] = await Promise.all([
      prisma.proposal.findMany({
        skip: (page - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.proposal.count(),
    ]);

    res.json({
      data: proposals,
      meta: { total, page, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    logger.error(req, 'Error fetching proposals', error);
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { votes: true },
    });

    if (!proposal) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Proposal not found',
        requestId: req.requestId,
      });
      return;
    }

    res.json(proposal);
  } catch (error) {
    logger.error(req, 'Error fetching proposal', error);
    next(error);
  }
});

router.get('/:id/votes', async (req, res, next) => {
  try {
    const { id } = req.params;

    const pagination = parsePagePagination(req, res);
    if (!pagination) return;
    const { page, limitNum } = pagination;

    const [votes, total] = await Promise.all([
      prisma.vote.findMany({
        where: { proposalId: id },
        skip: (page - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.vote.count({ where: { proposalId: id } }),
    ]);

    res.json({
      data: votes,
      meta: { total, page, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    logger.error(req, 'Error fetching votes', error);
    next(error);
  }
});

export default router;
