import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { parsePagination, requireStellarAddress } from '../middleware/validate';

const router = Router();

// GET /api/streams?sender={addr} or ?recipient={addr}
router.get('/streams', async (req, res, next) => {
  try {
    const { sender, recipient } = req.query;

    if (!sender && !recipient) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'At least one of sender or recipient query parameters is required',
        requestId: req.requestId,
      });
      return;
    }

    if (sender && !requireStellarAddress(String(sender), 'sender', req, res)) return;
    if (recipient && !requireStellarAddress(String(recipient), 'recipient', req, res)) return;

    const pagination = parsePagination(req, res);
    if (!pagination) return;
    const { take, skip, cursorId } = pagination;

    const where: Record<string, string> = {};
    if (sender) where.sender = String(sender);
    if (recipient) where.recipient = String(recipient);

    const streams = await prisma.stream.findMany({
      where,
      take,
      skip,
      cursor: cursorId ? { id: cursorId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { claimHistory: true } } },
    });

    const nextCursor =
      streams.length === take ? streams[streams.length - 1]!.id : null;

    res.json({ data: streams, nextCursor });
  } catch (error) {
    logger.error(req, 'Error fetching streams', error);
    next(error);
  }
});

// GET /api/streams/:id
router.get('/streams/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const stream = await prisma.stream.findUnique({
      where: { id },
      include: { claimHistory: { orderBy: { timestamp: 'desc' } } },
    });

    if (!stream) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Stream not found',
        requestId: req.requestId,
      });
      return;
    }

    res.json(stream);
  } catch (error) {
    logger.error(req, 'Error fetching stream detail', error);
    next(error);
  }
});

// GET /api/treasury/:addr/events
router.get('/treasury/:addr/events', async (req, res, next) => {
  try {
    const { addr } = req.params;

    if (!requireStellarAddress(addr, 'addr', req, res)) return;

    const pagination = parsePagination(req, res);
    if (!pagination) return;
    const { take, skip, cursorId } = pagination;

    const events = await prisma.treasuryEvent.findMany({
      where: { treasuryAddress: addr },
      take,
      skip,
      cursor: cursorId ? { id: cursorId } : undefined,
      orderBy: { timestamp: 'desc' },
    });

    const nextCursor =
      events.length === take ? events[events.length - 1]!.id : null;

    res.json({ data: events, nextCursor });
  } catch (error) {
    logger.error(req, 'Error fetching treasury events', error);
    next(error);
  }
});

export default router;
