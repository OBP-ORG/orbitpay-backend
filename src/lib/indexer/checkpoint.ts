import { prisma } from '../prisma';

export const getCheckpoint = async (): Promise<number | null> => {
  const state = await prisma.indexerState.findUnique({
    where: { id: 'singleton' }
  });
  return state ? state.lastLedger : null;
};
