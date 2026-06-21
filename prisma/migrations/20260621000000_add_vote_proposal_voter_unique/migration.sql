-- CreateIndex
CREATE UNIQUE INDEX "proposal_votes_proposal_id_voter_key" ON "proposal_votes"("proposal_id", "voter");
