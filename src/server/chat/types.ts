import type { Consultation, ConsultationEvaluation, Message, Viewer } from '@/contracts';
export interface ChatTurn {
  expectedRevision: number;
  clientMessageId: string;
  message: string;
  replies: Message[];
  candidate: ConsultationEvaluation | null;
  pendingProposal: NonNullable<Consultation['pendingProposal']> | null;
  acceptedProposalId: string | null;
}
export interface ChatStore {
  getConsultation(viewer: Viewer, id: string): Promise<Consultation>;
  saveChatTurn(viewer: Viewer, id: string, input: ChatTurn): Promise<Consultation>;
}
