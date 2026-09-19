import { create } from 'zustand';
import { Problem, Submission, InterviewRoom, User, CandidateInvitation, ParticipantStatus, BatchRoomAction, getDefaultCodeByLanguage } from '../types';

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  runtime?: number;
  memory?: number;
  testResults?: { passed: boolean; input: string; expected: string; actual?: string }[];
}

export interface ExecutionHistoryItem {
  id: string;
  type: 'run' | 'submit';
  result: ExecutionResult;
  timestamp: string;
  language: string;
  passedCount: number;
  totalCount: number;
  runtime?: number;
  memory?: number;
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface StatusChangeNotification {
  id: string;
  oldStatus: InterviewRoom['status'];
  newStatus: InterviewRoom['status'];
  timestamp: string;
}

/** 批量操作中单条房间的处理结果（含快照，便于跨打开列表持久展示） */
export interface BatchRoomResultItem {
  roomId: string;
  roomTitle: string;
  roomCode: string;
  targetStatus: BatchRoomAction;
  success: boolean;
  message: string;
  timestamp: string;
}

/** 最近一次批量操作的完整结果，持久化到 localStorage，下次打开列表仍可见 */
export interface LastBatchResult {
  id: string;
  action: BatchRoomAction;
  total: number;
  successCount: number;
  failedCount: number;
  items: BatchRoomResultItem[];
  timestamp: string;
}

const LAST_BATCH_RESULT_KEY = 'code_interview_last_batch_result';

const loadLastBatchResult = (): LastBatchResult | null => {
  try {
    const stored = localStorage.getItem(LAST_BATCH_RESULT_KEY);
    return stored ? (JSON.parse(stored) as LastBatchResult) : null;
  } catch {
    return null;
  }
};

const persistLastBatchResult = (result: LastBatchResult | null) => {
  try {
    if (result) {
      localStorage.setItem(LAST_BATCH_RESULT_KEY, JSON.stringify(result));
    } else {
      localStorage.removeItem(LAST_BATCH_RESULT_KEY);
    }
  } catch {
    // 本地存储不可用时静默忽略，不影响批量操作本身
  }
};

interface InterviewState {
  problems: Problem[];
  currentProblem: Problem | null;
  submissions: Submission[];
  deprecatedRoom: InterviewRoom | null;
  room: InterviewRoom | null;
  code: string;
  originalCode: string;
  language: string;
  isRunning: boolean;
  isSubmitting: boolean;
  lastRunResult: ExecutionResult | null;
  lastSubmissionResult: ExecutionResult | null;
  executionHistory: ExecutionHistoryItem[];
  currentUser: User | null;
  myRooms: InterviewRoom[];
  currentRoom: InterviewRoom | null;
  invitations: CandidateInvitation[];
  participants: ParticipantStatus[];
  isConnected: boolean;
  statusChangeNotification: StatusChangeNotification | null;
  lastBatchResult: LastBatchResult | null;
  setProblem: (p: Problem) => void;
  setCode: (code: string) => void;
  setLanguage: (lang: string) => void;
  setIsRunning: (running: boolean) => void;
  setIsSubmitting: (submitting: boolean) => void;
  setLastRunResult: (result: ExecutionResult | null) => void;
  setLastSubmissionResult: (result: ExecutionResult | null) => void;
  addExecutionHistory: (item: ExecutionHistoryItem) => void;
  clearExecutionHistory: () => void;
  resetOriginalCode: () => void;
  addSubmission: (s: Submission) => void;
  setRoom: (room: InterviewRoom) => void;
  setCurrentUser: (user: User) => void;
  setMyRooms: (rooms: InterviewRoom[]) => void;
  /** 用已成功变更的房间快照合并列表；未成功条目保持原样，可单独再执行 */
  applyRoomStatusUpdates: (updatedRooms: InterviewRoom[]) => void;
  setLastBatchResult: (result: LastBatchResult | null) => void;
  /** 从持久化的批量结果中移除某个条目（单独重试成功后调用） */
  removeBatchResultItem: (roomId: string) => void;
  setCurrentRoom: (room: InterviewRoom | null) => void;
  setInvitations: (invitations: CandidateInvitation[]) => void;
  setParticipants: (participants: ParticipantStatus[]) => void;
  addInvitation: (invitation: CandidateInvitation) => void;
  updateInvitationStatus: (invitationId: string, status: string) => void;
  updateParticipant: (participant: ParticipantStatus) => void;
  setIsConnected: (connected: boolean) => void;
  setStatusChangeNotification: (notification: StatusChangeNotification | null) => void;
  resetRoom: () => void;
  setProblems: (problems: Problem[]) => void;
  addProblem: (problem: Problem) => void;
  updateProblem: (problem: Problem) => void;
  removeProblem: (problemId: string) => void;
  updateExecutionHistory: (id: string, updates: Partial<ExecutionHistoryItem>) => void;
}

export const useInterviewStore = create<InterviewState>((set) => ({
  problems: [], currentProblem: null, submissions: [], deprecatedRoom: null, room: null,
  code: getDefaultCodeByLanguage('javascript'), originalCode: getDefaultCodeByLanguage('javascript'), language: 'javascript',
  isRunning: false, isSubmitting: false, lastRunResult: null, lastSubmissionResult: null,
  executionHistory: [],
  currentUser: null, myRooms: [], currentRoom: null, invitations: [], participants: [], isConnected: false,
  statusChangeNotification: null,
  lastBatchResult: loadLastBatchResult(),
  setProblem: (p) => set({ currentProblem: p }),
  setCode: (code) => set({ code }),
  setLanguage: (lang) => {
    const defaultCode = getDefaultCodeByLanguage(lang);
    set({
      language: lang,
      code: defaultCode,
      originalCode: defaultCode,
      lastRunResult: null,
      lastSubmissionResult: null,
      executionHistory: [],
    });
  },
  setIsRunning: (running) => set({ isRunning: running }),
  setIsSubmitting: (submitting) => set({ isSubmitting: submitting }),
  setLastRunResult: (result) => set({ lastRunResult: result }),
  setLastSubmissionResult: (result) => set({ lastSubmissionResult: result }),
  addExecutionHistory: (item) => set((state) => ({
    executionHistory: [item, ...state.executionHistory].slice(0, 20),
  })),
  clearExecutionHistory: () => set({ executionHistory: [] }),
  resetOriginalCode: () => set({ originalCode: useInterviewStore.getState().code }),
  addSubmission: (s) => set({ submissions: [s, ...useInterviewStore.getState().submissions] }),
  setRoom: (room) => set({ deprecatedRoom: room, room, currentRoom: room }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setMyRooms: (rooms) => set({ myRooms: rooms }),
  applyRoomStatusUpdates: (updatedRooms) => set((state) => {
    const updatesById = new Map(updatedRooms.map((r) => [r.id, r]));
    return {
      myRooms: state.myRooms.map((room) => updatesById.get(room.id) ?? room),
    };
  }),
  setLastBatchResult: (result) => {
    persistLastBatchResult(result);
    set({ lastBatchResult: result });
  },
  removeBatchResultItem: (roomId) => {
    const current = useInterviewStore.getState().lastBatchResult;
    if (!current) return;
    const items = current.items.filter((item) => item.roomId !== roomId);
    const successCount = items.filter((item) => item.success).length;
    const failedCount = items.length - successCount;
    const next: LastBatchResult | null = items.length === 0
      ? null
      : { ...current, items, total: items.length, successCount, failedCount };
    persistLastBatchResult(next);
    set({ lastBatchResult: next });
  },
  setCurrentRoom: (room) => set((state) => {
    const oldRoom = state.currentRoom;
    if (oldRoom && room && oldRoom.status !== room.status) {
      const notification: StatusChangeNotification = {
        id: `status-change-${Date.now()}`,
        oldStatus: oldRoom.status,
        newStatus: room.status,
        timestamp: new Date().toISOString(),
      };
      return {
        currentRoom: room,
        deprecatedRoom: room,
        room,
        statusChangeNotification: notification,
      };
    }
    return { currentRoom: room, deprecatedRoom: room, room };
  }),
  setInvitations: (invitations) => set({ invitations }),
  setParticipants: (participants) => set({ participants }),
  addInvitation: (invitation) => set((state) => ({ invitations: [...state.invitations, invitation] })),
  updateInvitationStatus: (invitationId, status) => set((state) => ({
    invitations: state.invitations.map((inv) =>
      inv.id === invitationId ? { ...inv, status: status as CandidateInvitation['status'] } : inv
    ),
  })),
  updateParticipant: (participant) => set((state) => {
    const exists = state.participants.some((p) => p.userId === participant.userId);
    if (exists) {
      return {
        participants: state.participants.map((p) =>
          p.userId === participant.userId ? participant : p
        ),
      };
    }
    return { participants: [...state.participants, participant] };
  }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setStatusChangeNotification: (notification) => set({ statusChangeNotification: notification }),
  resetRoom: () => set({
    currentRoom: null, deprecatedRoom: null, room: null,
    currentProblem: null,
    invitations: [], participants: [], isConnected: false,
    executionHistory: [],
    lastRunResult: null,
    lastSubmissionResult: null,
    statusChangeNotification: null,
  }),
  setProblems: (problems) => set({ problems }),
  addProblem: (problem) => set((state) => ({ problems: [problem, ...state.problems] })),
  updateProblem: (problem) => set((state) => ({
    problems: state.problems.map((p) => p.id === problem.id ? problem : p),
  })),
  removeProblem: (problemId) => set((state) => ({
    problems: state.problems.filter((p) => p.id !== problemId),
  })),
  updateExecutionHistory: (id, updates) => set((state) => ({
    executionHistory: state.executionHistory.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    ),
  })),
}));
