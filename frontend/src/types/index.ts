export interface Problem {
  id: string; title: string; difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  examples: { input: string; output: string; explanation?: string }[];
  testCases: { input: string; expectedOutput: string; hidden: boolean }[];
  tags: string[]; timeLimit: number; memoryLimit: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface CreateProblemRequest {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  examples: { input: string; output: string; explanation?: string }[];
  testCases: { input: string; expectedOutput: string; hidden: boolean }[];
  tags: string[];
  timeLimit: number;
  memoryLimit: number;
}

export interface UpdateProblemRequest extends Partial<CreateProblemRequest> {
  id: string;
}

export interface DifficultyTag {
  value: 'easy' | 'medium' | 'hard';
  label: string;
  color: string;
  bgColor: string;
}

export const DIFFICULTY_TAGS: DifficultyTag[] = [
  { value: 'easy', label: '简单', color: '#4caf50', bgColor: 'rgba(76, 175, 80, 0.15)' },
  { value: 'medium', label: '中等', color: '#ff9800', bgColor: 'rgba(255, 152, 0, 0.15)' },
  { value: 'hard', label: '困难', color: '#f44336', bgColor: 'rgba(244, 67, 54, 0.15)' },
];

export const getDifficultyTag = (difficulty: string): DifficultyTag => {
  return DIFFICULTY_TAGS.find(t => t.value === difficulty) || DIFFICULTY_TAGS[0];
};

export interface Submission {
  id: string; problemId: string; language: string; code: string;
  status: 'pending' | 'running' | 'accepted' | 'wrong_answer' | 'time_limit' | 'runtime_error';
  runtime?: number; memory?: number;
  testResults: { passed: boolean; input: string; expected: string; actual?: string }[];
  submittedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'INTERVIEWER' | 'CANDIDATE';
  createdAt: string;
}

export interface CandidateInvitation {
  id: string;
  roomId: string;
  candidateName: string;
  candidateEmail: string;
  inviteToken: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'JOINED' | 'LEFT';
  joinedAt?: string;
  createdAt: string;
}

export interface ParticipantStatus {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  userRole: 'INTERVIEWER' | 'CANDIDATE';
  isOnline: boolean;
  lastHeartbeat: string;
  joinedAt: string;
}

export interface InterviewRoom {
  id: string;
  roomCode: string;
  title: string;
  problemId: string;
  interviewerId: string;
  candidateId: string;
  status: 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  endedAt?: string;
  startedAt?: string;
  code: string;
  language: string;
  chatMessages: ChatMessage[];
}

export interface ChatMessage {
  id: string; senderId: string; senderName: string;
  content: string; timestamp: string;
}

export interface ScoreCard {
  problemSolving: number; codeQuality: number;
  communication: number; overall: number; notes: string;
}

export interface CreateRoomRequest {
  title: string;
  problemId: string;
  interviewerId: string;
  interviewerName: string;
}

export interface InviteCandidateRequest {
  roomId: string;
  candidateName: string;
  candidateEmail: string;
}

export interface CreateRoomResponse {
  room: InterviewRoom;
  participant: ParticipantStatus;
}

/** 批量管理房间状态的目标动作 */
export type BatchRoomAction = 'COMPLETED' | 'CANCELLED' | 'WAITING';

export interface BatchRoomStatusItem {
  roomId: string;
  targetStatus: BatchRoomAction;
}

export interface BatchRoomStatusRequest {
  items: BatchRoomStatusItem[];
}

export interface BatchRoomStatusItemResult {
  roomId: string;
  targetStatus: BatchRoomAction;
  success: boolean;
  message: string;
  room: InterviewRoom | null;
}

export interface BatchRoomStatusResponse {
  action: BatchRoomAction;
  total: number;
  successCount: number;
  failedCount: number;
  results: BatchRoomStatusItemResult[];
}

/** 可参与批量管理的房间状态：等待中、已完成 */
export const BATCHABLE_ROOM_STATUSES: InterviewRoom['status'][] = ['WAITING', 'COMPLETED'];

export const BATCH_ROOM_ACTION_LABELS: Record<BatchRoomAction, string> = {
  COMPLETED: '收进已结束',
  CANCELLED: '取消',
  WAITING: '恢复为等待中',
};

/**
 * 批量管理允许的状态流转：
 * 等待中 -> 已结束 / 已取消；已完成 -> 等待中（恢复）。
 */
export const isBatchTransitionAllowed = (
  currentStatus: InterviewRoom['status'],
  targetStatus: BatchRoomAction
): boolean => {
  if (targetStatus === 'COMPLETED' || targetStatus === 'CANCELLED') {
    return currentStatus === 'WAITING';
  }
  if (targetStatus === 'WAITING') {
    return currentStatus === 'COMPLETED';
  }
  return false;
};

export interface LanguageConfig {
  value: string;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  defaultCode: string;
}

export const DEFAULT_CODE_TEMPLATES: Record<string, string> = {
  javascript: `/**
 * @param {string} s
 * @return {boolean}
 */
function solution(s) {
  // Write your code here
  
  return true;
}

// Test cases
console.log(solution("test"));
`,
  typescript: `/**
 * @param s - The input string
 * @returns Whether the string is valid
 */
function solution(s: string): boolean {
  // Write your code here
  
  return true;
}

// Test cases
console.log(solution("test"));
`,
  python: `def solution(s: str) -> bool:
    """
    :param s: The input string
    :return: Whether the string is valid
    """
    # Write your code here
    
    return True


# Test cases
if __name__ == "__main__":
    print(solution("test"))
`,
  java: `public class Solution {
    /**
     * @param s The input string
     * @return Whether the string is valid
     */
    public boolean solution(String s) {
        // Write your code here
        
        return true;
    }
    
    public static void main(String[] args) {
        Solution sol = new Solution();
        System.out.println(sol.solution("test"));
    }
}
`,
  go: `package main

import "fmt"

// solution checks if the input string is valid
func solution(s string) bool {
	// Write your code here
	
	return true
}

func main() {
	fmt.Println(solution("test"))
}
`,
};

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  { value: 'javascript', label: 'JavaScript', icon: 'JS', color: '#f7df1e', bgColor: 'rgba(247, 223, 30, 0.15)', borderColor: '#f7df1e', defaultCode: DEFAULT_CODE_TEMPLATES.javascript },
  { value: 'typescript', label: 'TypeScript', icon: 'TS', color: '#3178c6', bgColor: 'rgba(49, 120, 198, 0.15)', borderColor: '#3178c6', defaultCode: DEFAULT_CODE_TEMPLATES.typescript },
  { value: 'python', label: 'Python', icon: 'PY', color: '#3776ab', bgColor: 'rgba(55, 118, 171, 0.15)', borderColor: '#3776ab', defaultCode: DEFAULT_CODE_TEMPLATES.python },
  { value: 'java', label: 'Java', icon: 'JV', color: '#007396', bgColor: 'rgba(0, 115, 150, 0.15)', borderColor: '#007396', defaultCode: DEFAULT_CODE_TEMPLATES.java },
  { value: 'go', label: 'Go', icon: 'GO', color: '#00add8', bgColor: 'rgba(0, 173, 216, 0.15)', borderColor: '#00add8', defaultCode: DEFAULT_CODE_TEMPLATES.go },
];

export const getDefaultCodeByLanguage = (language: string): string => {
  return DEFAULT_CODE_TEMPLATES[language] || DEFAULT_CODE_TEMPLATES.javascript;
};

export const getLanguageConfig = (value: string): LanguageConfig => {
  return LANGUAGE_CONFIGS.find(l => l.value === value) || LANGUAGE_CONFIGS[0];
};

export interface JoinRoomResponse {
  participant: ParticipantStatus;
  room: InterviewRoom;
  message?: string;
}

export interface RoomStatusConfig {
  value: InterviewRoom['status'];
  label: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const ROOM_STATUS_CONFIGS: RoomStatusConfig[] = [
  {
    value: 'WAITING',
    label: '等待中',
    description: '等待面试官开始面试',
    icon: '⏳',
    color: '#ff9800',
    bgColor: 'rgba(255, 152, 0, 0.15)',
    borderColor: '#ff9800',
  },
  {
    value: 'ACTIVE',
    label: '进行中',
    description: '面试正在进行',
    icon: '▶️',
    color: '#4caf50',
    bgColor: 'rgba(76, 175, 80, 0.15)',
    borderColor: '#4caf50',
  },
  {
    value: 'COMPLETED',
    label: '已结束',
    description: '面试已结束',
    icon: '✅',
    color: '#2196f3',
    bgColor: 'rgba(33, 150, 243, 0.15)',
    borderColor: '#2196f3',
  },
  {
    value: 'CANCELLED',
    label: '已取消',
    description: '面试已取消',
    icon: '❌',
    color: '#f44336',
    bgColor: 'rgba(244, 67, 54, 0.15)',
    borderColor: '#f44336',
  },
];

export const getRoomStatusConfig = (status: string): RoomStatusConfig => {
  return ROOM_STATUS_CONFIGS.find(s => s.value === status) || ROOM_STATUS_CONFIGS[0];
};

export const formatDuration = (startTime: string, endTime?: string): string => {
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  }
  return `${seconds}秒`;
};

export const formatTime = (dateString: string): string => {
  return new Date(dateString).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};
