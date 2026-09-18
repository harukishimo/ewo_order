export type Size = 'S' | 'M' | 'L' | 'custom';
export type Style = 'abstract' | 'landscape' | 'botanical' | 'other';
export type TaskStatus = 'queued' | 'needs_review' | 'in_progress' | 'completed' | 'cancelled';
export interface Preferences {
  size: Size | null;
  style: Style | null;
  budgetJpy: number | null;
  budgetAnswered: boolean;
  desiredDate: string | null;
  desiredDateAnswered: boolean;
  notes: string;
}
export const emptyPreferences: Preferences = {
  size: null,
  style: null,
  budgetJpy: null,
  budgetAnswered: false,
  desiredDate: null,
  desiredDateAnswered: false,
  notes: '',
};
export interface ChoiceCandidate<T extends string> {
  value: T | null;
  confidence: number;
}
export interface ConsultationEvaluation {
  provider: 'mock' | 'jev';
  size: ChoiceCandidate<Size>;
  style: ChoiceCandidate<Style>;
  needsReview: boolean;
  changeRequested: boolean;
  questionVersion: string;
}
export interface PriorityEvaluation {
  provider: 'mock' | 'jev';
  urgency: number;
  complexity: number;
  confidence: number;
  questionVersion: string;
}
export interface Message {
  id: string;
  sender: 'customer' | 'assistant';
  body: string;
  createdAt: string;
  clientMessageId?: string;
}
export interface Consultation {
  id: string;
  customerId: string;
  status: 'collecting' | 'ready_for_review' | 'ordered' | 'needs_review';
  preferences: Preferences;
  revision: number;
  messages: Message[];
  candidate: ConsultationEvaluation | null;
  createdAt: string;
  orderId?: string;
}
export interface Quote {
  id: string;
  consultationId: string;
  revision: number;
  spec: Preferences;
  amountJpy: number;
  expiresAt: string;
}
export interface Order {
  contactEmail: string | null;
  id: string;
  orderNumber: string;
  customerId: string;
  consultationId: string;
  quoteId: string;
  spec: Preferences;
  amountJpy: number;
  desiredDate: string | null;
  approvedAt: string;
  status: 'accepted' | 'cancelled';
  task: Task | null;
}
export interface Task {
  id: string;
  orderId: string;
  status: TaskStatus;
  version: number;
  evaluationStatus: 'pending' | 'succeeded' | 'failed';
  evaluation: PriorityEvaluation | null;
  priorityScore: number;
  manualPriority: number | null;
  overrideReason: string | null;
  createdAt: string;
}
export interface TaskEvent {
  id: string;
  eventType: string;
  createdAt: string;
  actorId: string;
  details: string;
}
export interface AdminTask extends Task {
  order: Omit<Order, 'task'>;
  events: TaskEvent[];
}
export interface Viewer {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  mode: 'demo' | 'supabase';
  isAnonymous?: boolean;
}
export interface SessionData {
  viewer: Viewer | null;
  demoAvailable: boolean;
  jevMode: 'mock' | 'jev';
}
export type ApiResponse<T> =
  { data: T } | { error: { code: string; message: string; retryable: boolean } };
export const sizeLabels: Record<Size, string> = {
  S: 'S · 20 × 20 cm',
  M: 'M · 30 × 40 cm',
  L: 'L · 50 × 60 cm',
  custom: 'サイズを相談',
};
export const styleLabels: Record<Style, string> = {
  abstract: '抽象画',
  landscape: '風景画',
  botanical: '植物',
  other: 'テイストを相談',
};
export const statusLabels: Record<TaskStatus, string> = {
  queued: '制作待ち',
  needs_review: '要確認',
  in_progress: '制作中',
  completed: '制作完了',
  cancelled: 'キャンセル',
};
